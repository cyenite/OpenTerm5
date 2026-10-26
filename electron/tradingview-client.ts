import type { TradingViewAccount, TradingViewChange, TradingViewChartSettings, TradingViewChartSettingsScan, TradingViewDrawings, TradingViewDrawingSet, TradingViewDrawingTemplate, TradingViewLineToolData, TradingViewOrigin, TradingViewPointData, TradingViewPush, TradingViewScan, TradingViewScript, TradingViewScriptListing, TradingViewScriptPage, TradingViewSkippedLayout, TradingViewSource, TradingViewSymbol, TradingViewWatchedLayout } from '../shared/tradingview';
import { displaySymbol } from '../shared/tradingview';

interface LineToolRecord extends TradingViewLineToolData {
  ownerSource?: string;
}

// TradingView has no public API for a user's drawings or themes. These are the requests its own
// chart page makes (read from its 2026-10-14 web build), sent with the signed-in session's cookies.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const tradingViewSite = 'https://www.tradingview.com';

const sharedChartId = '_shared';

// The change stream's key for drawings synced to all layouts.
const syncedChartId = 'UserSync';

const defaultStorage = 'https://charts-storage.tradingview.com/charts-storage/';

// TradingView's Pine service; its public script page asks it for the source (2026-10-16 build).
const pineFacade = 'https://pine-facade.tradingview.com/pine-facade';

// `script.access` on a script page for an open-source script; protected and invite-only scripts
// run on TradingView's servers and their source is never sent.
const publicAccess = 1;

// The popular list (TradingView's default `latest_popular` order, open-source scripts only) stops
// at 1000 scripts, 24 to a page. Its `next` links drop the type filter, so pages carry it again.
const SCRIPTS_PER_PAGE = 24;

export const scriptListPages = Math.ceil(1000 / SCRIPTS_PER_PAGE);

const isScriptId = (value: unknown): value is string => typeof value === 'string' && /^PUB;[0-9a-f]{32}$/i.test(value);

interface ScriptPage {
  version: number;
  url: string;
  name: string;
  author: string;
  scriptId: string;
}

interface ChartPage {
  storageUrl: string;
  // The change stream's address for one layout; only a signed-in page names it.
  notificationsUrl: string | null;
  // The web build the page belongs to, which TradingView's own saves send along.
  buildTime: string | null;
  account: TradingViewAccount | null;
}

interface LayoutRef {
  url: string;
  name: string;
}

interface Layout {
  id: string;
  url: string;
  name: string;
  // `settings` is the chart cut down to what its chart settings need.
  charts: { chartId: string; symbol: string; interval?: string; seriesId: string; tools: LineToolRecord[]; settings: unknown }[];
}

interface StoredCount {
  count: number;
  chartId: string;
  storageSymbol: string;
  ids: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : undefined);

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export class TradingViewError extends Error {
  constructor(message: string, readonly status?: number, readonly reason?: string) {
    super(message);
  }
}

export function parseChartPage(html: string): ChartPage {
  const link = /<link\b[^>]*\brel="[^"]*\bchart-storage\b(?!-)[^"]*"[^>]*>/i.exec(html)?.[0];
  const href = link ? /\bhref="([^"]+)"/i.exec(link)?.[1] : undefined;
  const storageUrl = href ? (href.endsWith('/') ? href : `${href}/`) : defaultStorage;
  const notificationsLink = /<link\b[^>]*\brel="[^"]*\bchart-storage-notifications\b[^"]*"[^>]*>/i.exec(html)?.[0];
  const notificationsUrl = (notificationsLink ? /\bhref="([^"]+)"/i.exec(notificationsLink)?.[1] : undefined) ?? null;
  const buildTime = /\bBUILD_TIME\s*=\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  const isSignedIn = /\bis_authenticated\s*=\s*true\b/.test(html);
  const line = /^\s*var user\s*=\s*(\{.*\});\s*$/m.exec(html)?.[1];
  let account: TradingViewAccount | null = null;
  if (isSignedIn && line) {
    try {
      const user = JSON.parse(line) as Record<string, unknown>;
      const id = Number(user.id);
      if (Number.isSafeInteger(id) && id > 0 && typeof user.username === 'string') account = { id, username: user.username };
    } catch {
      account = null;
    }
  }
  return { storageUrl, notificationsUrl, buildTime, account };
}

// A layout's short id from its address (https://www.tradingview.com/chart/AbCd1234/) or the id itself.
function layoutUrlOf(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const fromPath = /\/chart\/([A-Za-z0-9_-]+)/.exec(raw)?.[1];
  return fromPath ?? (/^[A-Za-z0-9_-]+$/.test(raw) ? raw : undefined);
}

export function parseLayoutList(body: unknown): LayoutRef[] {
  const list = Array.isArray(body) ? body : isRecord(body) ? [body.results, body.charts, body.data, body.items].find(Array.isArray) ?? [] : [];
  const seen = new Set<string>();
  return list.flatMap((item): LayoutRef[] => {
    if (!isRecord(item)) return [];
    const url = layoutUrlOf(item.url) ?? layoutUrlOf(item.short_url) ?? layoutUrlOf(item.image_url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, name: text(item.name) ?? text(item.title) ?? url }];
  });
}

function pointOf(value: unknown): TradingViewPointData {
  if (!isRecord(value)) return {};
  return { time_t: finite(value.time_t), offset: finite(value.offset), price: finite(value.price), interval: text(value.interval) };
}

// A saved line tool: `{type, id, state, points, zorder, ownerSource}`. Whether it sits on the price
// chart is settled once the layouts' price series ids are known.
export function lineToolOf(value: unknown): LineToolRecord | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !value.type.startsWith('LineTool')) return null;
  const id = text(value.id);
  if (!id || !Array.isArray(value.points) || !isRecord(value.state)) return null;
  return { id, type: value.type, points: value.points.map(pointOf), state: value.state, zorder: finite(value.zorder), isOnPrice: false, ownerSource: text(value.ownerSource) };
}

export function parseLayout(body: unknown, url: string): Layout {
  if (!isRecord(body)) throw new TradingViewError(`TradingView sent an unreadable layout for ${url}.`);
  let content: unknown = body.content;
  if (typeof content === 'string') {
    try { content = content === 'null' || content === 'undefined' ? null : JSON.parse(content); }
    catch { content = null; }
  }
  const charts = isRecord(content) && Array.isArray(content.charts) ? content.charts : [];
  return {
    id: text(body.uid) ?? url,
    url,
    name: text(body.name) ?? url,
    charts: charts.flatMap((chart, index) => {
      if (!isRecord(chart) || !Array.isArray(chart.panes)) return [];
      const sources = chart.panes.flatMap((pane) => (isRecord(pane) && Array.isArray(pane.sources) ? pane.sources : []));
      const series = sources.find((source) => isRecord(source) && source.type === 'MainSeries');
      const symbol = isRecord(series) && isRecord(series.state) ? text(series.state.symbol) : undefined;
      if (!symbol) return [];
      const tools = sources.map(lineToolOf).filter((tool): tool is LineToolRecord => tool !== null);
      const seriesId = text((series as Record<string, unknown>).id) ?? defaultSeriesId;
      const state = (series as Record<string, unknown>).state as Record<string, unknown>;
      const settings = { chartProperties: chart.chartProperties, timeScale: chart.timeScale, panes: [{ sources: [{ type: 'MainSeries', id: seriesId, state }] }] };
      return [{ chartId: text(chart.chartId) ?? String(index + 1), symbol, interval: text(state.interval), seriesId, tools, settings }];
    }),
  };
}

// `{charts: {[chartId]: {symbols: {[symbol]: {countSources}}}}}`.
export function parseSizes(payload: unknown): StoredCount[] {
  const charts = isRecord(payload) && isRecord(payload.charts) ? payload.charts : {};
  return Object.entries(charts).flatMap(([chartId, chart]) => {
    const symbols = isRecord(chart) && isRecord(chart.symbols) ? chart.symbols : {};
    return Object.entries(symbols).flatMap(([storageSymbol, size]) => {
      const ids = isRecord(size) && Array.isArray(size.ids) ? size.ids.flatMap((id) => text(id) ?? []) : [];
      const count = isRecord(size) ? finite(size.countSources) ?? ids.length : 0;
      return count > 0 ? [{ count, chartId, storageSymbol, ids }] : [];
    });
  });
}

// `{sources: {[id]: {id, state: <line tool>, symbol, ...}}}`.
export function originOf(source: TradingViewSource, record: Readonly<Record<string, unknown>>): TradingViewOrigin {
  const serverUpdateTime = finite(record.serverUpdateTime);
  return { source, record, ...(serverUpdateTime !== undefined ? { serverUpdateTime } : {}) };
}

// `{sources: {[id]: {id, symbol, ownerSource, serverUpdateTime, state}}}`. With the source they
// were read from, each tool keeps its origin, for writing it back.
export function parseSources(payload: unknown, source?: TradingViewSource): LineToolRecord[] {
  const sources = isRecord(payload) && isRecord(payload.sources) ? payload.sources : {};
  return Object.values(sources).flatMap((record) => {
    const tool = isRecord(record) ? lineToolOf(record.state) : null;
    if (!tool || !isRecord(record)) return [];
    return [source ? { ...tool, origin: originOf({ ...source, storageSymbol: text(record.symbol) ?? source.storageSymbol }, record) } : tool];
  });
}

// A tool as TradingView's own chart saves it: its symbol, currency and unit repeated beside the
// state, which loads leave out.
export function savedRecord(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const tool = isRecord(record.state) ? record.state : {};
  const state = isRecord(tool.state) ? tool.state : {};
  const header = (key: string) => (key in record ? record[key] : state[key] ?? null);
  return { ...record, symbol: header('symbol'), currencyId: header('currencyId'), unitId: header('unitId') };
}

// Server-sent events arrive in chunks split anywhere; an event's data lines join with a newline
// once a blank line ends it. Comments (TradingView's keep-alive) and other fields are dropped.
export class EventStreamParser {
  private buffer = '';
  private data: string[] = [];

  feed(chunk: string): string[] {
    const lines = (this.buffer + chunk).split('\n');
    this.buffer = lines.pop() ?? '';
    const events: string[] = [];
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line) {
        if (this.data.length) events.push(this.data.join('\n'));
        this.data = [];
        continue;
      }
      const colon = line.indexOf(':');
      if (colon === 0 || (colon < 0 ? line : line.slice(0, colon)) !== 'data') continue;
      const value = colon < 0 ? '' : line.slice(colon + 1);
      this.data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    return events;
  }
}

// The script page's address on www.tradingview.com, from any TradingView script link.
export function scriptPageUrl(link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new TradingViewError('Paste the address of a TradingView script page.');
  }
  const isTradingView = url.protocol === 'https:' && (url.hostname === 'tradingview.com' || url.hostname.endsWith('.tradingview.com'));
  const path = /^\/script\/[A-Za-z0-9]+(?:-[^/]*)?\/?$/.exec(url.pathname)?.[0];
  if (!isTradingView || !path) throw new TradingViewError('Paste the address of a TradingView script page, such as https://www.tradingview.com/script/AbCd1234-Name/.');
  return `${tradingViewSite}${path.endsWith('/') ? path : `${path}/`}`;
}

// The published script behind a page: the idea record the page's init data carries.
function scriptIdea(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!isRecord(value) || depth > 6) return null;
  if (isRecord(value.script) && typeof value.script.script_id_part === 'string') return value;
  for (const child of Object.values(value)) {
    const idea = scriptIdea(child, depth + 1);
    if (idea) return idea;
  }
  return null;
}

export function parseScriptPage(html: string, url: string): ScriptPage {
  for (const match of html.matchAll(/<script type="application\/prs\.init-data\+json">([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const idea = scriptIdea(data);
    if (!idea) continue;
    const script = idea.script as Record<string, unknown>;
    const scriptId = String(script.script_id_part);
    const version = finite(script.version_maj) ?? Number(text(script.version_maj));
    if (!isScriptId(scriptId) || !Number.isInteger(version) || version < 1) break;
    if (script.access !== publicAccess) throw new TradingViewError("This script's source is protected or invite-only. TradingView shares the source of open-source scripts only.");
    return { version, url, name: text(idea.name) ?? 'TradingView script', author: (isRecord(idea.user) ? text(idea.user.username) : undefined) ?? '', scriptId };
  }
  throw new TradingViewError('TradingView sent a page without a published script on it.');
}

// The listing in a scripts page's init data: open-source indicators with what fetching their source
// needs. `before` is how many scripts earlier pages held, for each script's rank.
export function parseScriptList(html: string, before: number): TradingViewScriptPage {
  for (const match of html.matchAll(/<script type="application\/prs\.init-data\+json">([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try { data = JSON.parse(match[1]); } catch { continue; }
    if (!isRecord(data)) continue;
    for (const block of Object.values(data)) {
      const ideas = isRecord(block) && isRecord(block.data) && isRecord(block.data.data) ? block.data.data.ideas : undefined;
      if (!isRecord(ideas) || !isRecord(ideas.data) || !Array.isArray(ideas.data.items)) continue;
      const scripts = ideas.data.items.flatMap((item, index): TradingViewScriptListing[] => {
        if (!isRecord(item) || item.script_access !== publicAccess || item.script_type !== 'indicator' || !isScriptId(item.script_id_part)) return [];
        const version = Number(text(item.version));
        const url = text(item.chart_url);
        if (!Number.isInteger(version) || version < 1 || !url?.startsWith(`${tradingViewSite}/script/`)) return [];
        return [{ rank: before + index + 1, likes: finite(item.likes_count) ?? 0, version, url, name: text(item.name) ?? 'TradingView script', author: (isRecord(item.user) ? text(item.user.username) : undefined) ?? '', scriptId: item.script_id_part }];
      });
      return { total: finite(ideas.data.total) ?? 0, hasMore: typeof ideas.data.next === 'string' && !!ideas.data.next, scripts };
    }
  }
  throw new TradingViewError('TradingView sent a scripts page without its list.');
}

export function parseScriptSource(body: unknown): string {
  if (isRecord(body) && body.success === false) {
    const reason = text(body.reason);
    throw new TradingViewError(`TradingView would not send the script's source${reason ? `: ${reason}` : ''}.`);
  }
  if (!isRecord(body) || typeof body.source !== 'string' || !body.source.trim()) throw new TradingViewError("TradingView did not send the script's source. Only open-source scripts can be imported.");
  return body.source;
}

// The error TradingView gives, such as "JWT validation failed", for the message the user sees.
async function reasonOf(response: Response): Promise<string | undefined> {
  try {
    const body = JSON.parse(await response.text()) as unknown;
    return (isRecord(body) ? text(body.detail) ?? text(body.errorMsg) ?? text(body.message) ?? text(body.code) : undefined)?.slice(0, 120);
  } catch {
    return undefined;
  }
}

const entities: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };

export function unescapeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, entity: string) => entities[entity]);
}

// Runs `work` over the items, at most `size` at a time.
async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(work));
}

// One layout TradingView will not open (locked above the plan's limit, deleted meanwhile) must not
// stop the others from being read.
const isLayoutRefusal = (error: unknown): error is TradingViewError => error instanceof TradingViewError && (error.status === 403 || error.status === 404);

// The price series' id differs per layout (ibCWf0, say); '_seriesId' is the default for new charts.
const defaultSeriesId = '_seriesId';

const placed = (tool: LineToolRecord, seriesIds: ReadonlySet<string>): TradingViewLineToolData => {
  const { ownerSource, ...data } = tool;
  return { ...data, isOnPrice: !ownerSource || seriesIds.has(ownerSource) };
};

export class TradingViewClient {
  private page?: ChartPage;
  private readonly tokens = new Map<string, Promise<string>>();
  private readonly layouts = new Map<string, Promise<Layout>>();
  private readonly watched = new Map<string, { watched: TradingViewWatchedLayout; layout: Layout }>();
  private readonly seriesIds = new Set<string>([defaultSeriesId]);

  constructor(private readonly fetcher: Fetcher) {}

  async account(): Promise<TradingViewAccount | null> {
    this.page = parseChartPage(await this.text(`${tradingViewSite}/chart/`, 'the chart page'));
    return this.page.account;
  }

  async symbols(): Promise<TradingViewScan> {
    const account = await this.signedIn();
    const skippedLayouts: TradingViewSkippedLayout[] = [];
    const found = new Map<string, { ids: Set<string>; unnamed: number; sources: TradingViewSource[] }>();
    const add = (symbol: string, ids: readonly string[], count: number, source: TradingViewSource) => {
      const entry = found.get(symbol) ?? { ids: new Set<string>(), unnamed: 0, sources: [] };
      if (ids.length) ids.forEach((id) => entry.ids.add(id));
      else entry.unnamed += count;
      entry.sources.push(source);
      found.set(symbol, entry);
    };
    let firstLayout: Layout | undefined;
    for (const ref of parseLayoutList(await this.json(`${tradingViewSite}/my-charts/`, 'your chart layouts'))) {
      try {
        const layout = await this.layout(ref.url, ref.name);
        const base = { layoutId: layout.id, layoutUrl: layout.url, layoutName: layout.name };
        const stored = parseSizes(await this.storage(account, layout.id, `layout/${layout.id}/sizes`, {}));
        firstLayout ??= layout;
        for (const chart of layout.charts) {
          const ids = chart.tools.filter((tool) => placed(tool, this.seriesIds).isOnPrice).map((tool) => tool.id);
          if (ids.length) add(chart.symbol, ids, ids.length, { ...base, scope: 'layout', chartId: chart.chartId, storageSymbol: chart.symbol, seriesId: chart.seriesId });
        }
        for (const size of stored) {
          const seriesId = layout.charts.find((chart) => chart.chartId === size.chartId)?.seriesId;
          add(displaySymbol(size.storageSymbol), size.ids, size.count, { ...base, scope: 'chart', chartId: size.chartId, storageSymbol: size.storageSymbol, ...(seriesId ? { seriesId } : {}) });
        }
      } catch (error) {
        if (!isLayoutRefusal(error)) throw error;
        skippedLayouts.push({ layoutName: ref.name, reason: error.reason ?? `TradingView answered ${error.status}` });
      }
    }
    // Synced drawings are requested through any layout TradingView opens.
    if (firstLayout) {
      const base = { layoutId: firstLayout.id, layoutUrl: firstLayout.url, layoutName: firstLayout.name };
      try {
        for (const stored of parseSizes(await this.storage(account, firstLayout.id, 'user/sizes', {}))) {
          add(displaySymbol(stored.storageSymbol), stored.ids, stored.count, { ...base, scope: 'synced', storageSymbol: stored.storageSymbol });
        }
      } catch (error) {
        if (!isLayoutRefusal(error)) throw error;
        skippedLayouts.push({ layoutName: 'Drawings synced to all layouts', reason: error.reason ?? `TradingView answered ${error.status}` });
      }
    }
    const symbols = [...found]
      .map(([symbol, entry]) => ({ symbol, count: entry.ids.size + entry.unnamed, ids: [...entry.ids], sources: entry.sources }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
    return { symbols, skippedLayouts };
  }

  async drawings(symbols: readonly TradingViewSymbol[]): Promise<TradingViewDrawings> {
    const account = await this.signedIn();
    const sets: TradingViewDrawingSet[] = [];
    const skipped = new Map<string, string>();
    // Every layout's price series id is needed to tell price drawings from indicator ones.
    for (const source of symbols.flatMap((symbol) => symbol.sources)) {
      try { await this.layout(source.layoutUrl, source.layoutName); }
      catch (error) { if (!isLayoutRefusal(error)) throw error; }
    }
    for (const symbol of symbols) {
      const tools = new Map<string, LineToolRecord>();
      for (const source of symbol.sources) {
        try {
          for (const tool of await this.sourceTools(account, source)) tools.set(tool.id, tool);
        } catch (error) {
          if (!isLayoutRefusal(error)) throw error;
          skipped.set(source.scope === 'synced' ? 'Drawings synced to all layouts' : source.layoutName, error.reason ?? `TradingView answered ${error.status}`);
        }
      }
      sets.push({ symbol: symbol.symbol, tools: [...tools.values()].map((tool) => placed(tool, this.seriesIds)) });
    }
    return { sets, skippedLayouts: [...skipped].map(([layoutName, reason]) => ({ layoutName, reason })) };
  }

  // Saves and deletes tools at one target as TradingView's chart does: only the tools named change.
  // The client id lets every chart, this one included, tell its own saves in the change stream.
  async push({ source, records }: TradingViewPush, clientId: string): Promise<{ serverUpdateTime: number }> {
    if (source.scope === 'layout') throw new TradingViewError('Drawings saved inside an older TradingView layout cannot be written back.');
    const account = await this.signedIn();
    const isSynced = source.scope === 'synced';
    const query: Record<string, string> = !isSynced && source.chartId ? { chart_id: source.chartId } : {};
    const sources = Object.fromEntries(Object.entries(records).map(([id, record]) => [id, record && savedRecord(record)]));
    const save = JSON.stringify({ sources, drawing_groups: {}, clientId: `${source.layoutId}/${source.chartId ?? syncedChartId}/${clientId}` });
    const payload = await this.storage(account, source.layoutId, isSynced ? 'user/sources' : `layout/${source.layoutId}/sources`, query, save);
    // Loads give ms; a save answers in seconds.
    const seconds = isRecord(payload) ? finite(payload.serverUpdateTime) : undefined;
    return { serverUpdateTime: seconds === undefined ? Date.now() : Math.round(seconds * 1000) };
  }

  // Loads the layouts whose change streams are followed, for their charts' price series ids.
  async watchLayouts(layouts: readonly TradingViewWatchedLayout[]): Promise<void> {
    await this.signedIn();
    for (const watched of layouts) this.watched.set(watched.layoutId, { watched, layout: await this.layout(watched.layoutUrl, watched.layoutName) });
  }

  // The layout's change stream, opened with the account's cookies as TradingView's chart does, or
  // null when the chart page names none.
  async streamUrl(layoutId: string): Promise<string | null> {
    await this.signedIn();
    const base = this.page?.notificationsUrl;
    if (!base) return null;
    const url = new URL(`/auth/charts-storage/layout/${encodeURIComponent(layoutId)}/subscribe`, base);
    url.searchParams.set('id', 'private');
    return url.href;
  }

  // One change-stream message: `{[chart id | _shared | UserSync]: {sources, clientId, symbol?}}`.
  // Messages this client caused are dropped.
  changesOf(layoutId: string, message: unknown, clientId: string): TradingViewChange[] {
    const entry = this.watched.get(layoutId);
    if (!entry || !isRecord(message)) return [];
    return Object.entries(message).flatMap(([chartKey, value]): TradingViewChange[] => {
      if (!isRecord(value) || text(value.clientId)?.split('/')[2] === clientId) return [];
      const isSynced = chartKey === syncedChartId;
      const seriesId = entry.layout.charts.find((chart) => chart.chartId === chartKey)?.seriesId;
      const source: TradingViewSource = { ...entry.watched, scope: isSynced ? 'synced' : 'chart', ...(isSynced ? {} : { chartId: chartKey }), storageSymbol: text(value.symbol) ?? '', ...(seriesId ? { seriesId } : {}) };
      if (value.sources === null) return source.storageSymbol ? [{ source, tools: [], removedIds: [], isSymbolCleared: true }] : [];
      const records = isRecord(value.sources) ? Object.entries(value.sources) : [];
      const removedIds = records.filter(([, record]) => record === null).map(([id]) => id);
      const tools = parseSources({ sources: Object.fromEntries(records.filter(([, record]) => record !== null)) }, source).map((tool) => placed(tool, this.seriesIds));
      return tools.length || removedIds.length ? [{ source, tools, removedIds, isSymbolCleared: false }] : [];
    });
  }

  // Every template saved for the given tool classes. TradingView lists names HTML-escaped (S&amp;R)
  // and finds a template only by that escaped name, so it is sent back as listed and unescaped for
  // display.
  async drawingTemplates(types: readonly string[]): Promise<TradingViewDrawingTemplate[]> {
    await this.signedIn();
    const found: TradingViewDrawingTemplate[] = [];
    await inBatches(types, 6, async (type) => {
      const listed = await this.optionalJson(`${tradingViewSite}/drawing-templates/${encodeURIComponent(type)}/`, `your ${type} templates`);
      const names = Array.isArray(listed) ? listed.flatMap((name) => text(name) ?? []) : [];
      for (const name of names) {
        const body = await this.optionalJson(`${tradingViewSite}/drawing-template/${encodeURIComponent(type)}/?templateName=${encodeURIComponent(name)}`, `the template "${unescapeHtml(name)}"`);
        const content = isRecord(body) ? body.content : undefined;
        if (typeof content !== 'string' || !content) continue;
        try { found.push({ type, name: unescapeHtml(name), content: JSON.parse(content) }); }
        catch { continue; }
      }
    });
    return found.sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
  }

  // The chart settings of every chart in every layout TradingView opens.
  async chartSettings(): Promise<TradingViewChartSettingsScan> {
    await this.signedIn();
    const charts: TradingViewChartSettings[] = [];
    const skippedLayouts: TradingViewSkippedLayout[] = [];
    for (const ref of parseLayoutList(await this.json(`${tradingViewSite}/my-charts/`, 'your chart layouts'))) {
      try {
        const layout = await this.layout(ref.url, ref.name);
        for (const chart of layout.charts) {
          charts.push({ layoutName: layout.name, layoutUrl: layout.url, chartId: chart.chartId, symbol: chart.symbol, ...(chart.interval ? { interval: chart.interval } : {}), content: chart.settings });
        }
      } catch (error) {
        if (!isLayoutRefusal(error)) throw error;
        skippedLayouts.push({ layoutName: ref.name, reason: error.reason ?? `TradingView answered ${error.status}` });
      }
    }
    return { charts, skippedLayouts };
  }

  async themes(): Promise<string[]> {
    await this.signedIn();
    const body = await this.json(`${tradingViewSite}/themes/`, 'your chart themes');
    const list = Array.isArray(body) ? body : isRecord(body) ? [body.themes, body.results, body.data].find(Array.isArray) ?? [] : [];
    return [...new Set(list.flatMap((item) => {
      const name = isRecord(item) ? text(item.name) : text(item);
      return name ? [name] : [];
    }))];
  }

  async theme(name: string): Promise<unknown> {
    await this.signedIn();
    const body = await this.json(`${tradingViewSite}/theme/?themeName=${encodeURIComponent(name)}`, `the theme "${name}"`);
    const content = isRecord(body) ? body.content : undefined;
    if (typeof content !== 'string') throw new TradingViewError(`TradingView sent no colours for the theme "${name}".`);
    try { return JSON.parse(content); }
    catch { throw new TradingViewError(`TradingView sent unreadable colours for the theme "${name}".`); }
  }

  // Open-source scripts are public: neither request needs the signed-in session.
  async script(link: string): Promise<TradingViewScript> {
    const url = scriptPageUrl(link);
    const page = parseScriptPage(await this.text(url, 'the script page'), url);
    return { ...page, source: await this.scriptSource(page.scriptId, page.version) };
  }

  // A page of the popular open-source indicators, from 1 to `scriptListPages`.
  async scriptList(page: number): Promise<TradingViewScriptPage> {
    if (!Number.isInteger(page) || page < 1 || page > scriptListPages) throw new TradingViewError(`The popular list has pages 1 to ${scriptListPages}.`);
    const path = page === 1 ? '/scripts/' : `/scripts/page-${page}/`;
    return parseScriptList(await this.text(`${tradingViewSite}${path}?script_type=indicators`, 'the popular scripts'), (page - 1) * SCRIPTS_PER_PAGE);
  }

  async scriptSource(scriptId: string, version: number): Promise<string> {
    if (!isScriptId(scriptId) || !Number.isInteger(version) || version < 1) throw new TradingViewError('That is not a published TradingView script.');
    return parseScriptSource(await this.json(`${pineFacade}/get/${encodeURIComponent(scriptId)}/${version}?no_4xx=true`, "the script's source"));
  }

  private async sourceTools(account: TradingViewAccount, source: TradingViewSource): Promise<LineToolRecord[]> {
    if (source.scope === 'layout') {
      const layout = await this.layout(source.layoutUrl, source.layoutName);
      return layout.charts.filter((chart) => chart.chartId === source.chartId && chart.symbol === source.storageSymbol).flatMap((chart) => chart.tools);
    }
    const path = source.scope === 'synced' ? 'get/user/sources' : `get/layout/${source.layoutId}/sources`;
    // As TradingView's own request: drawings shared within the layout live under chart "_shared",
    // and only a chart's own drawings are narrowed to the price series (narrowing shared ones
    // returns nothing).
    const query: Record<string, string> = { symbol: source.storageSymbol };
    if (source.scope === 'chart' && source.chartId) {
      query.chart_id = source.chartId;
      if (source.chartId !== sharedChartId) query.includeOwnerSource = source.seriesId ?? defaultSeriesId;
    }
    query.brokerName = '';
    return parseSources(await this.storage(account, source.layoutId, path, query), source);
  }

  private layout(url: string, name: string): Promise<Layout> {
    const cached = this.layouts.get(url);
    if (cached) return cached;
    const layout = this.json(`${tradingViewSite}/chart/${url}/json/`, `the layout "${name}"`).then((body) => {
      const parsed = parseLayout(body, url);
      parsed.charts.forEach((chart) => this.seriesIds.add(chart.seriesId));
      return parsed;
    });
    layout.catch(() => this.layouts.delete(url));
    this.layouts.set(url, layout);
    return layout;
  }

  private async signedIn(): Promise<TradingViewAccount> {
    const account = this.page?.account ?? await this.account();
    if (!account) throw new TradingViewError('Sign in to TradingView first.');
    return account;
  }

  private token(account: TradingViewAccount, layoutId: string): Promise<string> {
    const cached = this.tokens.get(layoutId);
    if (cached) return cached;
    const url = `${tradingViewSite}/chart-token/?image_url=${encodeURIComponent(layoutId)}&user_id=${account.id}`;
    const token = this.json(url, 'access to your drawings').then((body) => {
      const value = isRecord(body) ? text(body.token) : undefined;
      if (!value) throw new TradingViewError('TradingView did not grant access to your drawings. Sign in again.');
      return value;
    });
    token.catch(() => this.tokens.delete(layoutId));
    this.tokens.set(layoutId, token);
    return token;
  }

  // A body makes it a save (PUT). A token outlives an import but not a sync left running for
  // hours, so one TradingView no longer accepts is fetched again, once.
  private async storage(account: TradingViewAccount, layoutId: string, path: string, query: Record<string, string>, save?: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const url = new URL(path, this.page?.storageUrl ?? defaultStorage);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      url.searchParams.set('layout_id', layoutId);
      url.searchParams.set('jwt', await this.token(account, layoutId));
      try {
        const body = await this.json(url.href, 'your drawings', save);
        if (!isRecord(body) || body.success !== true) throw new TradingViewError(`TradingView could not ${save === undefined ? 'read' : 'save'} your drawings.`);
        return body.payload;
      } catch (error) {
        if (attempt > 0 || !(error instanceof TradingViewError) || error.status !== 403 || !/jwt/i.test(error.reason ?? '')) throw error;
        this.tokens.delete(layoutId);
      }
    }
  }

  // TradingView's own fetch marks requests to its site as XHR; without that, /my-charts/ redirects
  // to the home page instead of answering. A redirect from a data request means the session is gone.
  // A save goes out as the chart page's saves do (checked 2026-10-26): without www.tradingview.com
  // as its origin TradingView's proxy answers a bare 403, and without the session's cookies,
  // which a request carrying an Origin header only sends when asked, storage refuses any save
  // naming a tool with 403 "Header validation failed".
  private async request(url: string, what: string, isPage: boolean, save?: string): Promise<Response> {
    const isSite = new URL(url).origin === tradingViewSite;
    const headers: Record<string, string> = isPage ? { Accept: 'text/html' } : { Accept: 'application/json', ...(isSite ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) };
    if (save !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', Origin: tradingViewSite, ...(this.page?.buildTime ? { 'X-BUILD-TIME': this.page.buildTime } : {}) });
    const init: RequestInit = save === undefined ? {} : { method: 'PUT', body: save, credentials: 'include' };
    const send = () => this.fetcher(url, { ...init, headers, redirect: isPage ? 'follow' : 'manual', signal: AbortSignal.timeout(20_000) });
    let response = await send();
    if (response.status === 429) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      response = await send();
    }
    if (response.ok) return response;
    const reason = await reasonOf(response);
    const detail = reason ? `: ${reason}` : '';
    const { status } = response;
    if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) throw new TradingViewError(`TradingView sent a page instead of ${what}. Sign in to TradingView again.`);
    if (status === 401 || status === 403) throw new TradingViewError(`TradingView refused access to ${what} (${status}${detail}). Sign in to TradingView again if this continues.`, status, reason);
    if (status === 429) throw new TradingViewError('TradingView is limiting requests. Try again in a minute.', status, reason);
    throw new TradingViewError(`TradingView answered ${status}${detail} when ${save === undefined ? 'reading' : 'saving'} ${what}.`, status, reason);
  }

  private async text(url: string, what: string): Promise<string> {
    return (await this.request(url, what, true)).text();
  }

  // A request whose absence (a tool with no templates) is not an error.
  private async optionalJson(url: string, what: string): Promise<unknown> {
    try { return await this.json(url, what); }
    catch (error) {
      if (error instanceof TradingViewError && error.status === 404) return null;
      throw error;
    }
  }

  private async json(url: string, what: string, save?: string): Promise<unknown> {
    const body = await (await this.request(url, what, false, save)).text();
    try { return JSON.parse(body); }
    catch { throw new TradingViewError(`TradingView sent an unreadable answer when reading ${what}.`); }
  }
}
