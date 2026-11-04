import { isSameJson, isSyncKind, recordKey, splitRecordKey, syncKindInfo, type Json, type SyncKind } from '../shared/sync';
import { hlcAt, HybridClock } from './sync-clock';
import { decodePayload, encodePayload, envelopeHash, MAX_ENVELOPE_BYTES, objectPath, open, recordCipherKey, seal, type SyncKeys } from './sync-crypto';
import { emptyManifest, MANIFEST_PATH, openManifest, sealManifest, SyncIntegrityError, type Manifest, type ManifestDevice, type ManifestEntry } from './sync-manifest';
import { mergeRecords, parseSyncedRecord, pruneTombstones, recordPlain, stampRecord, type MergeConflict, type SyncedRecord } from './sync-merge';

const TOMBSTONE_LIFETIME_MS = 180 * 86_400_000;
const MAX_ATTEMPTS = 5;
// The mass-change guard: more than this share of a kind's records, or this many map items in one
// record, removed in one sync waits for the user.
const MASS_SHARE = 0.2;
const MASS_RECORDS = 2;
const MASS_ITEMS = 25;
const MASS_EMPTY_FROM = 3;

// The remote is a versioned file tree with one compare-and-swap: `commit` lands only while
// `parent` is still the head, and answers null otherwise.
export interface SyncRemote {
  head(): Promise<string | null>;
  read(commit: string, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>>;
  commit(parent: string | null, writes: ReadonlyMap<string, Buffer | null>): Promise<string | null>;
}

export interface SourceChange {
  readonly upserts: Readonly<Record<string, Json>>;
  readonly deletes: readonly string[];
}

export interface SyncSource {
  readonly kind: SyncKind;
  snapshot(): Promise<Readonly<Record<string, Json>>>;
  // Throws when a value would be unsafe to apply; it never changes the value.
  validate(value: Json): void;
  apply(change: SourceChange): Promise<void>;
}

export interface SyncState {
  readonly head: string | null;
  readonly clock: string | null;
  readonly highWater: number;
  readonly isApplying: boolean;
  // The last verified remote manifest, and the remote records as of `head`.
  readonly manifest: Manifest | null;
  readonly bases: Readonly<Record<string, SyncedRecord>>;
  // Merged local records not yet on the remote. Local snapshots are stamped against these, so a
  // value merged in from the remote is never mistaken for a new local edit.
  readonly pending: Readonly<Record<string, SyncedRecord>>;
}

export interface SyncStateStore {
  load(): Promise<SyncState | null>;
  save(state: SyncState): Promise<void>;
}

export type SyncDevice = Pick<ManifestDevice, 'id' | 'name' | 'platform' | 'publicKey' | 'appVersion'>;

export interface SyncEngineDeps {
  readonly epoch: number;
  readonly repoId: number;
  readonly keys: SyncKeys;
  readonly remote: SyncRemote;
  readonly store: SyncStateStore;
  readonly device: SyncDevice;
  readonly sources: readonly SyncSource[];
  readonly now?: () => number;
  readonly pause?: (ms: number) => Promise<void>;
}

export interface SyncConflict extends MergeConflict {
  readonly key: string;
}

export interface MassChange {
  readonly kind: SyncKind;
  readonly side: 'local' | 'remote';
  readonly removed: number;
  readonly total: number;
}

export interface SyncOptions {
  readonly isMassChangeAllowed?: boolean;
  // "Use synced data": local changes since the last sync are replaced by the remote's.
  readonly isLocalDiscarded?: boolean;
  // The user confirmed the repository was put back to an older state on purpose.
  readonly isHistoryAccepted?: boolean;
}

export type SyncOutcome =
  | { readonly status: 'synced'; readonly pulled: number; readonly pushed: number; readonly conflicts: readonly SyncConflict[]; readonly copies: readonly string[]; readonly skipped: readonly string[] }
  | { readonly status: 'held'; readonly changes: readonly MassChange[] }
  | { readonly status: 'busy' };

interface RemoteView {
  readonly head: string | null;
  readonly manifest: Manifest;
  readonly records: Readonly<Record<string, SyncedRecord>>;
  readonly invalid: ReadonlySet<string>;
}

const emptyState = (): SyncState => ({ head: null, clock: null, highWater: 0, isApplying: false, manifest: null, bases: {}, pending: {} });

const sameRecord = (left: SyncedRecord | undefined, right: SyncedRecord | undefined) => isSameJson(left as unknown as Json | undefined, right as unknown as Json | undefined);

const isAlive = (record: SyncedRecord | undefined) => !!record && !record.deletedHlc;

const removedItems = (from: SyncedRecord | undefined, to: SyncedRecord | undefined) =>
  !from || from.deletedHlc ? 0 : Object.entries(from.entries).filter(([key, entry]) => !entry.isDeleted && (!to || !!to.deletedHlc || !!to.entries[key]?.isDeleted)).length;

export class SyncEngine {
  private readonly clock: HybridClock;
  private readonly now: () => number;
  private readonly pause: (ms: number) => Promise<void>;
  private readonly sources: ReadonlyMap<SyncKind, SyncSource>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.clock = new HybridClock(deps.device.id, this.now);
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.sources = new Map(deps.sources.map((source) => [source.kind, source]));
  }

  // Stamps local edits when they happen rather than at the next sync, so "the newer edit wins"
  // means the newer edit even for a computer that was offline. Call it shortly after any store
  // changes; it needs no network.
  recordLocalChanges(): Promise<number> {
    return this.exclusive(async () => {
      const state = await this.deps.store.load() ?? emptyState();
      if (state.clock) this.clock.observe(state.clock);
      if (state.isApplying) return 0;
      const pending: Record<string, SyncedRecord> = { ...state.pending };
      let count = 0;
      for (const [kind, source] of this.sources) {
        const { shape } = syncKindInfo(kind);
        const snapshot = await source.snapshot();
        const keys = new Set([...Object.keys(state.bases), ...Object.keys(state.pending)].filter((key) => splitRecordKey(key).kind === kind));
        for (const id of Object.keys(snapshot)) keys.add(recordKey(kind, id));
        for (const key of keys) {
          const current = snapshot[splitRecordKey(key).id];
          if (current !== undefined && !this.isValidPlain(source, current)) continue;
          const baseline = state.pending[key] ?? state.bases[key];
          const stamped = stampRecord(shape, baseline, current, () => this.clock.tick());
          if (stamped === baseline || !stamped) continue;
          pending[key] = stamped;
          count += 1;
        }
      }
      if (count) await this.deps.store.save({ ...state, pending, clock: this.clock.last });
      return count;
    });
  }

  sync(options: SyncOptions = {}): Promise<SyncOutcome> {
    return this.exclusive(() => this.syncNow(options));
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async syncNow(options: SyncOptions): Promise<SyncOutcome> {
    let state = await this.deps.store.load() ?? emptyState();
    if (state.clock) this.clock.observe(state.clock);
    if (state.isApplying) state = await this.finishApply(state);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt) await this.pause(2 ** attempt * 250 + Math.random() * 250);
      const head = await this.deps.remote.head();
      const view = head !== null && head === state.head && state.manifest ? { head, manifest: state.manifest, records: state.bases, invalid: new Set<string>() } : await this.pull(head, state, options);
      const outcome = await this.reconcile(state, view, options);
      if (outcome.status !== 'retry') return outcome.status === 'synced' ? outcome.outcome : outcome;
      state = outcome.state;
    }
    return { status: 'busy' };
  }

  private async pull(head: string | null, state: SyncState, options: SyncOptions): Promise<RemoteView> {
    const { keys, epoch, repoId, remote } = this.deps;
    const envelope = head === null ? null : (await remote.read(head, [MANIFEST_PATH])).get(MANIFEST_PATH) ?? null;
    if (!envelope) {
      if (state.highWater > 0) throw new SyncIntegrityError('tampered', 'The sync manifest is missing from the repository.');
      return { head, manifest: emptyManifest(epoch, repoId), records: {}, invalid: new Set() };
    }
    const manifest = openManifest(keys, envelope, { epoch, repoId, highWater: options.isHistoryAccepted ? 0 : state.highWater });
    // A removed computer still holds the key until the key is replaced, so its writes are refused
    // here, and no manifest may bring it back.
    const removed = new Set(state.manifest?.devices.filter((item) => item.isRevoked).map((item) => item.id));
    if (removed.has(manifest.writer)) throw new SyncIntegrityError('tampered', 'The sync data was changed by a computer that was removed from sync.');
    if (manifest.devices.some((item) => removed.has(item.id) && !item.isRevoked) || [...removed].some((id) => !manifest.devices.some((item) => item.id === id))) {
      throw new SyncIntegrityError('tampered', 'The sync data brings back a computer that was removed from sync.');
    }
    if (!options.isLocalDiscarded && state.manifest && manifest.tombstonesPrunedBefore && manifest.tombstonesPrunedBefore > state.manifest.hlc) {
      throw new SyncIntegrityError('stale', 'This computer last synced before old deletions were cleared. Choose which data to keep.');
    }
    const records: Record<string, SyncedRecord> = {};
    const wanted = new Map<string, string>();
    for (const [key, entry] of Object.entries(manifest.records)) {
      if (!this.isReadable(key, entry)) continue;
      if (entry.hash === null) records[key] = { entries: {}, deletedHlc: entry.hlc };
      else if (state.manifest?.records[key]?.hash === entry.hash && state.bases[key]) records[key] = state.bases[key];
      else wanted.set(objectPath(entry.hash), key);
    }
    const invalid = new Set<string>();
    const objects = wanted.size && head ? await remote.read(head, [...wanted.keys()]) : new Map<string, Buffer | null>();
    for (const [path, key] of wanted) {
      const entry = manifest.records[key];
      const object = objects.get(path);
      if (!object || envelopeHash(object) !== entry.hash) throw new SyncIntegrityError('tampered', `A synced record (${splitRecordKey(key).kind}) is missing or altered.`);
      let record: SyncedRecord;
      try { record = parseSyncedRecord(decodePayload(open(recordCipherKey(keys, key), object, this.recordContext(key, entry.generation)))); }
      catch { throw new SyncIntegrityError('tampered', `A synced record (${splitRecordKey(key).kind}) failed authentication.`); }
      // An authentic record that fails validation came from a buggy build, not an attacker: it is
      // left alone on this computer rather than blocking every other record.
      if (!this.isValid(key, record)) invalid.add(key);
      else records[key] = record;
    }
    for (const record of Object.values(records)) {
      if (record.deletedHlc) this.clock.observe(record.deletedHlc);
      for (const entry of Object.values(record.entries)) this.clock.observe(entry.hlc);
    }
    this.clock.observe(manifest.hlc);
    return { head, manifest, records, invalid };
  }

  private async reconcile(state: SyncState, view: RemoteView, options: SyncOptions): Promise<{ status: 'synced'; outcome: SyncOutcome } | { status: 'held'; changes: MassChange[] } | { status: 'retry'; state: SyncState }> {
    const tick = () => this.clock.tick();
    const horizon = hlcAt(this.now() - TOMBSTONE_LIFETIME_MS);
    const snapshots = new Map<SyncKind, Readonly<Record<string, Json>>>();
    for (const [kind, source] of this.sources) snapshots.set(kind, await source.snapshot());

    const merged: Record<string, SyncedRecord> = {};
    const toPush = new Set<string>();
    const changes = new Map<SyncKind, { upserts: Record<string, Json>; deletes: string[] }>();
    const inverse = new Map<SyncKind, { upserts: Record<string, Json>; deletes: string[] }>();
    const conflicts: SyncConflict[] = [];
    const copies: string[] = [];
    const skipped = new Set<string>(view.invalid);
    const mass: MassChange[] = [];
    let pulled = 0;

    for (const [kind, source] of this.sources) {
      const { shape } = syncKindInfo(kind);
      const snapshot = snapshots.get(kind)!;
      const keys = new Set([...Object.keys(state.bases), ...Object.keys(view.records), ...Object.keys(state.pending)].filter((key) => splitRecordKey(key).kind === kind));
      for (const id of Object.keys(snapshot)) keys.add(recordKey(kind, id));
      const counts = { local: 0, remote: 0, items: 0, total: 0 };
      const change = { upserts: {} as Record<string, Json>, deletes: [] as string[] };
      const undo = { upserts: {} as Record<string, Json>, deletes: [] as string[] };
      for (const key of keys) {
        const { id } = splitRecordKey(key);
        const entry = view.manifest.records[key];
        if (view.invalid.has(key) || (entry && !this.isReadable(key, entry))) { skipped.add(key); continue; }
        const base = state.bases[key];
        const current = snapshot[id];
        if (current !== undefined && !this.isValidPlain(source, current)) { skipped.add(key); continue; }
        const local = options.isLocalDiscarded ? base : stampRecord(shape, state.pending[key] ?? base, current, tick);
        const remote = view.records[key];
        const result = mergeRecords(shape, base, local, remote, tick);
        let next = result.merged;
        if (next && !sameRecord(next, remote)) next = pruneTombstones(next, horizon);
        if (next) merged[key] = next;
        if (next && !sameRecord(next, remote)) toPush.add(key);
        if (!sameRecord(remote, base)) pulled += 1;
        conflicts.push(...result.conflicts.map((conflict) => ({ ...conflict, key })));
        for (const copy of result.copies) {
          const copyKey = recordKey(kind, `${id}~conflict~${this.deps.device.id}~${this.now()}`);
          merged[copyKey] = stampRecord(shape, undefined, copy, tick)!;
          toPush.add(copyKey);
          copies.push(copyKey);
          change.upserts[splitRecordKey(copyKey).id] = copy;
          undo.deletes.push(splitRecordKey(copyKey).id);
        }
        const target = recordPlain(shape, next);
        if (!isSameJson(target, current)) {
          if (target === undefined) change.deletes.push(id);
          else change.upserts[id] = target;
          if (current === undefined) undo.deletes.push(id);
          else undo.upserts[id] = current;
        }
        if (isAlive(base)) {
          counts.total += 1;
          if (!isAlive(local)) counts.local += 1;
          if (!isAlive(remote)) counts.remote += 1;
          counts.items = Math.max(counts.items, removedItems(base, local));
        }
      }
      const isEmptied = counts.total >= MASS_EMPTY_FROM && !Object.keys(snapshot).length && !options.isLocalDiscarded;
      const isMass = (removed: number) => removed > MASS_RECORDS && removed / Math.max(counts.total, 1) > MASS_SHARE;
      if (isEmptied || isMass(counts.local) || (counts.items > MASS_ITEMS && !options.isLocalDiscarded)) mass.push({ kind, side: 'local', removed: Math.max(counts.local, counts.items), total: counts.total });
      if (isMass(counts.remote)) mass.push({ kind, side: 'remote', removed: counts.remote, total: counts.total });
      if (change.deletes.length || Object.keys(change.upserts).length) {
        changes.set(kind, change);
        inverse.set(kind, undo);
      }
    }
    if (mass.length && !options.isMassChangeAllowed) return { status: 'held', changes: mass };

    const pending = Object.fromEntries([...toPush].filter((key) => merged[key]).map((key) => [key, merged[key]]));
    const pulledState: SyncState = { ...state, head: view.head, highWater: view.manifest.seq, manifest: view.manifest, bases: { ...view.records }, pending, clock: this.clock.last };
    await this.applyChanges(state, pulledState, changes, inverse);

    const isRegistered = view.manifest.devices.some((device) => device.id === this.deps.device.id);
    if (!toPush.size && isRegistered) {
      await this.deps.store.save({ ...pulledState, clock: this.clock.last });
      return { status: 'synced', outcome: { status: 'synced', pulled, pushed: 0, conflicts, copies, skipped: [...skipped] } };
    }
    const pushed = this.prepare(view, merged, toPush, skipped, horizon);
    const head = await this.deps.remote.commit(view.head, pushed.writes);
    if (head === null) return { status: 'retry', state: { ...pulledState, clock: this.clock.last } };
    const bases = { ...view.records };
    for (const key of pushed.written) bases[key] = merged[key];
    const left = Object.fromEntries(Object.entries(pending).filter(([key]) => !pushed.written.has(key)));
    await this.deps.store.save({ head, clock: this.clock.last, highWater: pushed.manifest.seq, isApplying: false, manifest: pushed.manifest, bases, pending: left });
    return { status: 'synced', outcome: { status: 'synced', pulled, pushed: pushed.written.size, conflicts, copies, skipped: [...skipped] } };
  }

  // The new state is saved before the stores change, flagged as applying: a crash part-way is
  // finished at the next start. A store that refuses a change rolls the others back and the old
  // state stays, so nothing is half-applied.
  private async applyChanges(previous: SyncState, next: SyncState, changes: ReadonlyMap<SyncKind, SourceChange>, inverse: ReadonlyMap<SyncKind, SourceChange>): Promise<void> {
    if (!changes.size) return;
    await this.deps.store.save({ ...next, isApplying: true });
    const applied: SyncKind[] = [];
    try {
      for (const [kind, change] of changes) {
        await this.sources.get(kind)!.apply(change);
        applied.push(kind);
      }
    } catch (error) {
      for (const kind of applied.reverse()) await this.sources.get(kind)!.apply(inverse.get(kind)!).catch(() => undefined);
      await this.deps.store.save(previous);
      throw error;
    }
    await this.deps.store.save({ ...next, isApplying: false });
  }

  private async finishApply(state: SyncState): Promise<SyncState> {
    for (const [kind, source] of this.sources) {
      const { shape } = syncKindInfo(kind);
      const snapshot = await source.snapshot();
      const change = { upserts: {} as Record<string, Json>, deletes: [] as string[] };
      const keys = new Set([...Object.keys(state.bases), ...Object.keys(state.pending)].filter((key) => splitRecordKey(key).kind === kind));
      for (const key of keys) {
        const { id } = splitRecordKey(key);
        const target = recordPlain(shape, state.pending[key] ?? state.bases[key]);
        if (isSameJson(target, snapshot[id])) continue;
        if (target === undefined) change.deletes.push(id);
        else change.upserts[id] = target;
      }
      if (change.deletes.length || Object.keys(change.upserts).length) await source.apply(change);
    }
    const finished = { ...state, isApplying: false };
    await this.deps.store.save(finished);
    return finished;
  }

  private prepare(view: RemoteView, merged: Readonly<Record<string, SyncedRecord>>, toPush: ReadonlySet<string>, skipped: Set<string>, horizon: string) {
    const { keys, epoch, repoId, device } = this.deps;
    const now = this.now();
    const writes = new Map<string, Buffer | null>();
    const records: Record<string, ManifestEntry> = { ...view.manifest.records };
    const written = new Set<string>();
    for (const key of toPush) {
      const record = merged[key];
      const previous = view.manifest.records[key];
      const generation = (previous?.generation ?? 0) + 1;
      const schema = syncKindInfo(splitRecordKey(key).kind as SyncKind).schema;
      if (record.deletedHlc) {
        records[key] = { hash: null, hlc: record.deletedHlc, schema, generation };
      } else {
        const envelope = seal(recordCipherKey(keys, key), encodePayload(record as unknown as Json), this.recordContext(key, generation));
        if (envelope.length > MAX_ENVELOPE_BYTES) { skipped.add(key); continue; }
        const hash = envelopeHash(envelope);
        writes.set(objectPath(hash), envelope);
        const latest = Object.values(record.entries).reduce((max, entry) => entry.hlc > max ? entry.hlc : max, '0000000000000.0000.0');
        records[key] = { hash, hlc: latest, schema, generation };
      }
      if (previous?.hash) writes.set(objectPath(previous.hash), null);
      written.add(key);
    }
    let prunedBefore = view.manifest.tombstonesPrunedBefore;
    for (const [key, entry] of Object.entries(records)) {
      if (entry.hash !== null || entry.hlc >= horizon) continue;
      delete records[key];
      if (!prunedBefore || horizon > prunedBefore) prunedBefore = horizon;
    }
    const self = view.manifest.devices.find((item) => item.id === device.id);
    if (self?.isRevoked) throw new SyncIntegrityError('revoked', 'This computer was removed from sync on another computer.');
    const devices = [...view.manifest.devices.filter((item) => item.id !== device.id), { ...device, firstSeen: self?.firstSeen ?? now, lastSeen: now, isRevoked: false }];
    const manifest: Manifest = { ...view.manifest, seq: view.manifest.seq + 1, hlc: this.clock.tick(), writer: device.id, epoch, repoId, records, devices, tombstonesPrunedBefore: prunedBefore };
    writes.set(MANIFEST_PATH, sealManifest(keys, manifest));
    return { writes, written, manifest };
  }

  private recordContext(key: string, generation: number) {
    const { kind, id } = splitRecordKey(key);
    return { purpose: 'record', epoch: this.deps.epoch, repoId: this.deps.repoId, kind, id, generation };
  }

  // Records of kinds this computer does not sync, or of a newer schema, are carried along untouched.
  private isReadable(key: string, entry: ManifestEntry): boolean {
    const { kind } = splitRecordKey(key);
    return isSyncKind(kind) && this.sources.has(kind) && entry.schema <= syncKindInfo(kind).schema;
  }

  private isValid(key: string, record: SyncedRecord): boolean {
    const kind = splitRecordKey(key).kind as SyncKind;
    const plain = recordPlain(syncKindInfo(kind).shape, record);
    return plain === undefined || this.isValidPlain(this.sources.get(kind)!, plain);
  }

  private isValidPlain(source: SyncSource, plain: Json): boolean {
    try { source.validate(plain); return true; } catch { return false; }
  }
}
