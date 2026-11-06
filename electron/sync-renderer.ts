import { rendererSyncKinds, syncKindInfo, type Json, type RendererSyncKind, type SyncSnapshot, type SyncSourceReply, type SyncSourceRequest } from '../shared/sync';
import { SyncSourceUnavailableError, type SyncSource } from './sync-engine';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DEPTH = 64;

export interface RendererSourcesDeps {
  // False when there is no window to ask.
  readonly send: (id: number, request: SyncSourceRequest) => boolean;
  readonly timeoutMs?: number;
}

interface Waiting {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

// Structured clone carries Maps, Dates, NaN and cycles that JSON cannot; only plain JSON passes.
function isPlainJson(value: unknown, depth = 0): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth > MAX_DEPTH || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.every((item) => isPlainJson(item, depth + 1));
  return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((item) => isPlainJson(item, depth + 1));
}

// The renderer's stores, reached over IPC. The renderer checks its own values when it takes a
// snapshot, so the engine validating those again needs no round trip; only remote values do.
export class RendererSources {
  private next = 1;
  private isReady = false;
  private readonly waiting = new Map<number, Waiting>();
  private readonly checked = new WeakSet<object>();
  private readonly refused = new WeakSet<object>();

  constructor(private readonly deps: RendererSourcesDeps) {}

  // Ready once the renderer's stores have loaded; a reload or a closed window fails what was asked.
  setReady(isReady: boolean): void {
    this.isReady = isReady;
    if (isReady) return;
    for (const id of [...this.waiting.keys()]) this.fail(id, new SyncSourceUnavailableError('The window closed before it answered.'));
  }

  receive(id: number, reply: unknown): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    clearTimeout(waiting.timer);
    const answer = reply as Partial<SyncSourceReply> | null;
    if (!isObject(answer)) waiting.reject(new Error('The app window sent a malformed answer.'));
    else if ('error' in answer) waiting.reject(new Error(String(answer.error)));
    else waiting.resolve('result' in answer ? answer.result : undefined);
  }

  // Secret kinds never go to the renderer, whatever the kind list says.
  sources(): SyncSource[] {
    return rendererSyncKinds.filter((kind) => !syncKindInfo(kind).isSecret).map((kind) => this.source(kind));
  }

  private source(kind: RendererSyncKind): SyncSource {
    return {
      kind,
      snapshot: async () => {
        const snapshot = await this.request({ method: 'snapshot', kind }) as SyncSnapshot;
        if (!isObject(snapshot?.values) || Array.isArray(snapshot.values) || !Array.isArray(snapshot.invalid) || !isPlainJson(snapshot.values)) throw new Error(`The ${kind} snapshot is malformed.`);
        const invalid = new Set(snapshot.invalid);
        for (const [id, value] of Object.entries(snapshot.values)) {
          if (isObject(value)) (invalid.has(id) ? this.refused : this.checked).add(value);
        }
        return snapshot.values;
      },
      validate: async (value: Json, id: string) => {
        if (isObject(value) && this.checked.has(value)) return;
        if (isObject(value) && this.refused.has(value)) throw new Error(`This ${kind} record failed its checks.`);
        await this.request({ method: 'validate', kind, id, value });
      },
      apply: async (change) => {
        await this.request({ method: 'apply', kind, change });
      },
    };
  }

  private request(request: SyncSourceRequest): Promise<unknown> {
    if (!this.isReady) return Promise.reject(new SyncSourceUnavailableError('The app window is still loading.'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, new SyncSourceUnavailableError('The app window did not answer.')), this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      if (!this.deps.send(id, request)) this.fail(id, new SyncSourceUnavailableError('There is no app window.'));
    });
  }

  private fail(id: number, error: Error): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    clearTimeout(waiting.timer);
    waiting.reject(error);
  }
}
