import type { Bar } from '@meridian/charts';
import type { PineConversion } from './pine-output';
import type { PineDeclaration, PineReply, PineRequest, PineRun } from './pine-protocol';

// A few workers running Pine scripts for every chart. A script that runs past the time limit (an
// endless loop, say) takes its worker down with it; the next request starts a fresh one.

export type PineBarSource = (symbol: string, timeframe: string, limit?: number, from?: number, to?: number) => Promise<Bar[]>;

const TIME_LIMIT_MS = 60_000;

const POOL_SIZE = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));

interface Job {
  resolve: (reply: PineReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Runner {
  worker: Worker;
  jobs: Map<number, Job>;
}

const runners: (Runner | null)[] = new Array<Runner | null>(POOL_SIZE).fill(null);

let jobCount = 0;

let barSource: PineBarSource = () => Promise.reject(new Error('No bars are available.'));

export function setPineBarSource(source: PineBarSource): void {
  barSource = source;
}

function stop(slot: number, reason: string): void {
  const runner = runners[slot];
  if (!runner) return;
  runners[slot] = null;
  runner.worker.terminate();
  for (const job of runner.jobs.values()) {
    clearTimeout(job.timer);
    job.reject(new Error(reason));
  }
}

function start(slot: number): Runner {
  const worker = new Worker(new URL('./pine.worker.ts', import.meta.url), { type: 'module', name: 'pine' });
  const runner: Runner = { worker, jobs: new Map() };
  worker.onmessage = (event: MessageEvent<PineReply>) => {
    const reply = event.data;
    if (reply.kind === 'bars') {
      const answer = (message: PineRequest) => { if (runners[slot] === runner) worker.postMessage(message); };
      barSource(reply.symbol, reply.timeframe, reply.limit, reply.from, reply.to)
        .then((bars) => answer({ kind: 'bars', id: reply.id, bars }))
        .catch((error: unknown) => answer({ kind: 'bars', id: reply.id, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    const job = runner.jobs.get(reply.id);
    if (!job) return;
    runner.jobs.delete(reply.id);
    clearTimeout(job.timer);
    job.resolve(reply);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    stop(slot, `The Pine runtime stopped: ${event.message || 'unknown error'}.`);
  };
  runners[slot] = runner;
  return runner;
}

// The least busy worker, started if its slot is empty.
function pick(): [number, Runner] {
  let best = 0;
  for (let slot = 1; slot < POOL_SIZE; slot++) {
    if ((runners[slot]?.jobs.size ?? 0) < (runners[best]?.jobs.size ?? 0)) best = slot;
  }
  return [best, runners[best] ?? start(best)];
}

function send(request: (id: number) => PineRequest, signal?: AbortSignal): Promise<PineReply> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const [slot, runner] = pick();
  const id = ++jobCount;
  return new Promise<PineReply>((resolve, reject) => {
    const timer = setTimeout(() => stop(slot, `The script ran for more than ${TIME_LIMIT_MS / 1000} seconds and was stopped.`), TIME_LIMIT_MS);
    runner.jobs.set(id, { resolve, reject, timer });
    // The worker finishes the run regardless; an aborted caller just stops waiting for it.
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    runner.worker.postMessage(request(id));
  });
}

export async function inspectPine(source: string): Promise<PineDeclaration> {
  const reply = await send((id) => ({ kind: 'inspect', id, source }));
  if (reply.kind !== 'inspect' || !reply.declaration) throw new Error(reply.kind === 'inspect' && reply.error ? reply.error : 'The script could not be read.');
  return reply.declaration;
}

export async function runPine(run: PineRun, signal?: AbortSignal): Promise<PineConversion> {
  const reply = await send((id) => ({ kind: 'run', id, run }), signal);
  if (reply.kind !== 'run' || !reply.conversion) throw new Error(reply.kind === 'run' && reply.error ? reply.error : 'The script did not run.');
  return reply.conversion;
}
