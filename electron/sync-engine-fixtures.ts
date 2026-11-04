import type { Json, SyncKind } from '../shared/sync';
import { deriveKeys, type SyncKeys } from './sync-crypto';
import { SyncEngine, type SourceChange, type SyncRemote, type SyncSource, type SyncState, type SyncStateStore } from './sync-engine';
import type { Timers } from './sync-scheduler';

export const REPO_ID = 77;

// A versioned file tree with the one compare-and-swap GitHub's fast-forward ref update gives.
export class FakeRemote implements SyncRemote {
  current: string | null = null;
  beforeCommit?: () => Promise<void>;
  private count = 0;
  readonly commits = new Map<string, Map<string, Buffer>>();

  async head(): Promise<string | null> { return this.current; }

  async read(commit: string, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>> {
    const files = this.commits.get(commit)!;
    return new Map(paths.map((path) => [path, files.has(path) ? Buffer.from(files.get(path)!) : null]));
  }

  async commit(parent: string | null, writes: ReadonlyMap<string, Buffer | null>): Promise<string | null> {
    const hook = this.beforeCommit;
    this.beforeCommit = undefined;
    await hook?.();
    if (parent !== this.current) return null;
    return this.write(writes);
  }

  // What an attacker holding the token can do: commit anything, or point the ref anywhere.
  write(writes: ReadonlyMap<string, Buffer | null>): string {
    const files = new Map(this.current ? this.commits.get(this.current) : []);
    for (const [path, content] of writes) {
      if (content) files.set(path, Buffer.from(content));
      else files.delete(path);
    }
    const id = `c${++this.count}`;
    this.commits.set(id, files);
    this.current = id;
    return id;
  }

  files(): Map<string, Buffer> { return this.commits.get(this.current!)!; }
}

export class MemoryStore implements SyncStateStore {
  state: SyncState | null = null;
  isNextSaveFailing = false;

  async load(): Promise<SyncState | null> { return this.state && structuredClone(this.state); }

  async save(state: SyncState): Promise<void> {
    if (this.isNextSaveFailing) {
      this.isNextSaveFailing = false;
      throw new Error('disk gone');
    }
    this.state = structuredClone(state);
  }
}

export class MemorySource implements SyncSource {
  data: Record<string, Json> = {};
  onApply?: (change: SourceChange) => void;
  isValid: (value: Json) => boolean = () => true;
  readonly applied: SourceChange[] = [];

  constructor(readonly kind: SyncKind) {}

  async snapshot(): Promise<Readonly<Record<string, Json>>> { return structuredClone(this.data); }

  validate(value: Json): void | Promise<void> {
    if (!this.isValid(value)) throw new Error('invalid');
  }

  async apply(change: SourceChange): Promise<void> {
    this.onApply?.(change);
    this.applied.push(change);
    for (const id of change.deletes) delete this.data[id];
    Object.assign(this.data, structuredClone(change.upserts));
  }
}

export interface Device {
  readonly id: string;
  readonly store: MemoryStore;
  readonly engine: SyncEngine;
  readonly sources: Record<string, MemorySource>;
  readonly source: (kind: SyncKind) => MemorySource;
  restart(): Device;
}

export function device(id: string, remote: FakeRemote, rootKey: Buffer, kinds: readonly SyncKind[], clock: { now: number }, store = new MemoryStore(), sources?: Record<string, MemorySource>): Device {
  const keys: SyncKeys = deriveKeys(rootKey);
  const own = sources ?? Object.fromEntries(kinds.map((kind) => [kind, new MemorySource(kind)]));
  const engine = new SyncEngine({
    epoch: 1, repoId: REPO_ID, keys, remote, store, sources: Object.values(own),
    device: { id, name: `Computer ${id}`, platform: 'linux', publicKey: 'x', appVersion: '0.12.0' },
    now: () => clock.now, pause: async () => undefined,
  });
  return { id, store, engine, sources: own, source: (kind) => own[kind], restart: () => device(id, remote, rootKey, kinds, clock, store, own) };
}

export class FakeTimers implements Timers {
  time = 0;
  private next = 1;
  private readonly queue = new Map<number, { at: number; run: () => void }>();

  set(run: () => void, ms: number): unknown {
    const id = this.next++;
    this.queue.set(id, { at: this.time + ms, run });
    return id;
  }

  clear(handle: unknown): void { this.queue.delete(handle as number); }

  hasDue(): boolean { return [...this.queue.values()].some((timer) => timer.at <= this.time); }

  // Moves time forward, firing due timers in order and letting their promises settle.
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.queue].filter(([, timer]) => timer.at <= end).sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      this.queue.delete(due[0]);
      this.time = due[1].at;
      due[1].run();
      for (let index = 0; index < 10; index++) await Promise.resolve();
    }
    this.time = end;
  }
}
