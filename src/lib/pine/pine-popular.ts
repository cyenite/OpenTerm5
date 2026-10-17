import type { TradingViewScriptListing } from '../../../shared/tradingview';
import { Store } from '../store';
import { tradingViewScriptList, tradingViewScriptSource } from '../tradingview';
import { findTradingViewScript, importPineScript, showPineScripts } from './pine-scripts';

// Imports TradingView's popular open-source indicators in list order. It carries on with the
// dialog closed. The main process spaces the requests a second apart, so a thousand scripts take
// about twenty minutes. A script already imported at the same version costs no request, and nor
// does one that failed its checks at that version before (unless asked to try again), so a second
// run resumes a cancelled one cheaply.

export const popularCounts = [50, 100, 250, 500, 1000] as const;

export interface SkippedScript {
  url: string;
  name: string;
  reason: string;
}

export interface PopularImport {
  phase: 'listing' | 'importing' | 'done' | 'cancelled' | 'failed';
  // Scripts wanted, scripts found in the list, and scripts dealt with so far.
  count: number;
  listed: number;
  done: number;
  added: number;
  updated: number;
  unchanged: number;
  skipped: readonly SkippedScript[];
  error?: string;
  // TradingView asked for a pause; the import resumes on its own at this time.
  waitingUntil?: number;
}

export const popularImport = new Store<{ progress: PopularImport | null }>({ progress: null });

const PER_PAGE = 24;

// Scripts read and checked at once while the next source downloads.
const PARALLEL_CHECKS = 3;

// A 429 waits this long, at most this many times in a row.
const LIMIT_PAUSE_MS = 60_000;
const LIMIT_RETRIES = 5;

// Store updates come in batches of this many scripts, so menus and the dialog do not re-render
// a thousand times.
const SHOW_EVERY = 10;

let controller: AbortController | null = null;

// Scripts that failed their checks, by TradingView id: a script that cannot run at one version
// will not run on the next attempt either. Fetch failures are not kept; they may pass next time.
const SKIPPED_KEY = 'openterm.pine-skipped.v1';

type SkipRecord = Record<string, { version: number; reason: string }>;

function loadSkips(): SkipRecord {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? 'null');
    return value && typeof value === 'object' ? (value as SkipRecord) : {};
  } catch {
    return {};
  }
}

function saveSkips(skips: SkipRecord): void {
  try {
    localStorage.setItem(SKIPPED_KEY, JSON.stringify(skips));
  } catch {
    // Only costs requests on the next run.
  }
}

const isRunning = () => !!controller;

function update(patch: Partial<PopularImport>): void {
  popularImport.set((state) => (state.progress ? { progress: { ...state.progress, ...patch } } : state));
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

// A TradingView request, waiting out its rate limit (the main process words a 429 this way).
async function patiently<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await work();
    } catch (error) {
      if (attempt >= LIMIT_RETRIES || !/limiting requests/i.test(messageOf(error))) throw error;
      update({ waitingUntil: Date.now() + LIMIT_PAUSE_MS });
      await sleep(LIMIT_PAUSE_MS, signal);
      update({ waitingUntil: undefined });
    }
  }
}

async function list(count: number, signal: AbortSignal): Promise<TradingViewScriptListing[]> {
  const found = new Map<string, TradingViewScriptListing>();
  for (let page = 1; page <= Math.ceil(count / PER_PAGE) && found.size < count; page++) {
    const result = await patiently(() => tradingViewScriptList(page), signal);
    for (const script of result.scripts) if (!found.has(script.scriptId)) found.set(script.scriptId, script);
    update({ listed: Math.min(found.size, count) });
    if (!result.hasMore) break;
  }
  return [...found.values()].slice(0, count);
}

export async function importPopularScripts(count: number, isRetryingSkipped = false): Promise<void> {
  if (isRunning()) return;
  const skips = loadSkips();
  const current = new AbortController();
  controller = current;
  const { signal } = current;
  const skipped: SkippedScript[] = [];
  let [done, added, updated, unchanged] = [0, 0, 0, 0];
  popularImport.set({ progress: { phase: 'listing', count, listed: 0, done, added, updated, unchanged, skipped } });
  const checks = new Set<Promise<void>>();
  const finish = () => update({ done, added, updated, unchanged, skipped: [...skipped] });
  try {
    const scripts = await list(count, signal);
    update({ phase: 'importing', listed: scripts.length });
    for (const listing of scripts) {
      signal.throwIfAborted();
      const existing = findTradingViewScript(listing.scriptId);
      if (existing?.origin.kind === 'tradingview' && existing.origin.version === listing.version) {
        unchanged++;
        done++;
        finish();
        continue;
      }
      const known = skips[listing.scriptId];
      if (known && known.version === listing.version && !isRetryingSkipped) {
        skipped.push({ url: listing.url, name: listing.name, reason: known.reason });
        done++;
        finish();
        continue;
      }
      let source: string;
      try {
        source = await patiently(() => tradingViewScriptSource(listing.scriptId, listing.version), signal);
      } catch (error) {
        if (signal.aborted || /limiting requests/i.test(messageOf(error))) throw error;
        skipped.push({ url: listing.url, name: listing.name, reason: messageOf(error) });
        done++;
        finish();
        continue;
      }
      const check = importPineScript(source, { kind: 'tradingview', rank: listing.rank, likes: listing.likes, version: listing.version, url: listing.url, author: listing.author, scriptId: listing.scriptId }, true)
        .then(() => {
          if (existing) updated++;
          else added++;
          delete skips[listing.scriptId];
        })
        .catch((error: unknown) => {
          skipped.push({ url: listing.url, name: listing.name, reason: messageOf(error) });
          skips[listing.scriptId] = { version: listing.version, reason: messageOf(error) };
        })
        .finally(() => {
          checks.delete(check);
          done++;
          if (done % SHOW_EVERY === 0) showPineScripts();
          finish();
        });
      checks.add(check);
      if (checks.size >= PARALLEL_CHECKS) await Promise.race(checks);
    }
    await Promise.all(checks);
    update({ phase: 'done' });
  } catch (error) {
    await Promise.all(checks);
    update(signal.aborted ? { phase: 'cancelled' } : { phase: 'failed', error: messageOf(error) });
  } finally {
    saveSkips(skips);
    showPineScripts();
    finish();
    update({ waitingUntil: undefined });
    controller = null;
  }
}

export function cancelPopularImport(): void {
  controller?.abort(new Error('Cancelled.'));
}
