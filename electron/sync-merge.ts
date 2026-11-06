import { isSameJson, type Json, type SyncShape } from '../shared/sync';
import { isHlc } from './sync-clock';

// An entry is unchanged exactly when its stamp is: stamping keeps the baseline's entry for an
// unchanged value, so comparing stamps is comparing edits.
export interface SyncEntry {
  readonly hlc: string;
  readonly value?: Json;
  readonly isDeleted?: true;
}

export type SyncEntries = Readonly<Record<string, SyncEntry>>;

export interface SyncedRecord {
  readonly entries: SyncEntries;
  readonly deletedHlc?: string;
}

export interface MergeConflict {
  // null when a whole record lost to its deletion, or a deletion lost to an edit.
  readonly entry: string | null;
  readonly winner: 'local' | 'remote';
  // The losing side's value; null when the loser was a deletion.
  readonly loser: Json | null;
}

export interface MergeResult {
  readonly merged: SyncedRecord | undefined;
  readonly conflicts: readonly MergeConflict[];
  // Text both sides changed: the remote version stays and these local versions become new records.
  readonly copies: readonly Json[];
}

const SINGLE = '';

// Entries are plain objects keyed by item ids, so lookups must not reach Object.prototype.
const own = (entries: SyncEntries, key: string): SyncEntry | undefined => Object.hasOwn(entries, key) ? entries[key] : undefined;

const UNSAFE_KEY = '__proto__';

// A key that would set an object's prototype when assigned, among a value's entry keys.
export function hasUnsafeKey(shape: SyncShape, plain: Json): boolean {
  if (shape === 'set') return Array.isArray(plain) && plain.includes(UNSAFE_KEY);
  return (shape === 'fields' || shape === 'map') && plain !== null && typeof plain === 'object' && !Array.isArray(plain) && Object.hasOwn(plain, UNSAFE_KEY);
}

function plainEntries(shape: SyncShape, plain: Json): Record<string, Json> {
  if (shape === 'fields' || shape === 'map') {
    if (plain === null || typeof plain !== 'object' || Array.isArray(plain)) throw new Error(`A ${shape} record must be an object.`);
    return { ...(plain as Record<string, Json>) };
  }
  if (shape === 'set') {
    if (!Array.isArray(plain) || plain.some((member) => typeof member !== 'string')) throw new Error('A set record must be a list of strings.');
    return Object.fromEntries((plain as string[]).map((member) => [member, true]));
  }
  return { [SINGLE]: plain };
}

export function fromEntries(shape: SyncShape, entries: SyncEntries): Json {
  const live = Object.entries(entries).filter(([, entry]) => !entry.isDeleted);
  if (shape === 'fields' || shape === 'map') return Object.fromEntries(live.map(([key, entry]) => [key, entry.value ?? null]));
  if (shape === 'set') return live.map(([key]) => key).sort();
  return own(entries, SINGLE)?.isDeleted ? null : own(entries, SINGLE)?.value ?? null;
}

export const recordPlain = (shape: SyncShape, record: SyncedRecord | undefined): Json | undefined =>
  !record || record.deletedHlc ? undefined : fromEntries(shape, record.entries);

// Turns a snapshot into entries against the last known state. Unchanged values keep their old
// entry; a field missing from a snapshot is left alone (it may belong to a newer build), while a
// missing map item or set member is a deletion.
export function stampRecord(shape: SyncShape, baseline: SyncedRecord | undefined, plain: Json | undefined, tick: () => string): SyncedRecord | undefined {
  if (plain === undefined) return !baseline || baseline.deletedHlc ? baseline : { entries: {}, deletedHlc: tick() };
  const previous = baseline && !baseline.deletedHlc ? baseline.entries : {};
  const current = plainEntries(shape, plain);
  const entries: Record<string, SyncEntry> = {};
  let isChanged = !baseline || !!baseline.deletedHlc;
  for (const [key, value] of Object.entries(current)) {
    const old = own(previous, key);
    const isKept = !!old && !old.isDeleted && isSameJson(old.value, value);
    entries[key] = isKept ? old : { hlc: tick(), value };
    isChanged ||= !isKept;
  }
  for (const [key, old] of Object.entries(previous)) {
    if (key in current) continue;
    const isKept = shape === 'fields' || !!old.isDeleted;
    entries[key] = isKept ? old : { hlc: tick(), isDeleted: true };
    isChanged ||= !isKept;
  }
  return isChanged ? { entries } : baseline;
}

const isSameEntry = (left: SyncEntry | undefined, right: SyncEntry | undefined) => left?.hlc === right?.hlc;

const isSameRecord = (left: SyncedRecord | undefined, right: SyncedRecord | undefined) =>
  left === right || (!!left && !!right && left.deletedHlc === right.deletedHlc && Object.keys(left.entries).length === Object.keys(right.entries).length &&
    Object.entries(left.entries).every(([key, entry]) => isSameEntry(entry, own(right.entries, key))));

const isSameValue = (left: SyncEntry, right: SyncEntry) => !!left.isDeleted === !!right.isDeleted && (!!left.isDeleted || isSameJson(left.value, right.value));

// The newest edit a side made since the base, or '' when it made none.
function latestChange(base: SyncedRecord | undefined, side: SyncedRecord): string {
  if (side.deletedHlc) return side.deletedHlc;
  const previous = base && !base.deletedHlc ? base.entries : {};
  return Object.entries(side.entries).reduce((latest, [key, entry]) => !isSameEntry(own(previous, key), entry) && entry.hlc > latest ? entry.hlc : latest, '');
}

function combineLists(winner: Json, loser: Json, base: Json | undefined): readonly Json[] {
  const asList = (value: Json | undefined): readonly Json[] => Array.isArray(value) ? value : [];
  const has = (list: readonly Json[], item: Json) => list.some((candidate) => isSameJson(candidate, item));
  const [winning, losing, original] = [asList(winner), asList(loser), asList(base)];
  const removed = original.filter((item) => !has(losing, item));
  const added = losing.filter((item) => !has(original, item) && !has(winning, item));
  return [...winning.filter((item) => !has(removed, item)), ...added];
}

export function mergeRecords(shape: SyncShape, base: SyncedRecord | undefined, local: SyncedRecord | undefined, remote: SyncedRecord | undefined, tick: () => string): MergeResult {
  const none = { conflicts: [], copies: [] };
  if (isSameRecord(base, local)) return { merged: remote, ...none };
  if (isSameRecord(base, remote) || isSameRecord(local, remote)) return { merged: local, ...none };
  if (!local || !remote) return { merged: local ?? remote, ...none };
  if (local.deletedHlc && remote.deletedHlc) return { merged: local.deletedHlc > remote.deletedHlc ? local : remote, ...none };
  if (local.deletedHlc || remote.deletedHlc) {
    const isLocalDeleted = !!local.deletedHlc;
    const [deleted, alive] = isLocalDeleted ? [local, remote] : [remote, local];
    const isDeletionNewer = deleted.deletedHlc! > latestChange(base, alive);
    const conflict: MergeConflict = isDeletionNewer
      ? { entry: null, winner: isLocalDeleted ? 'local' : 'remote', loser: fromEntries(shape, alive.entries) }
      : { entry: null, winner: isLocalDeleted ? 'remote' : 'local', loser: null };
    return { merged: isDeletionNewer ? deleted : alive, conflicts: [conflict], copies: [] };
  }

  const previous = base && !base.deletedHlc ? base.entries : {};
  const entries: Record<string, SyncEntry> = {};
  const conflicts: MergeConflict[] = [];
  const copies: Json[] = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(local.entries), ...Object.keys(remote.entries)])) {
    const original = own(previous, key);
    // An entry pruned on one side after its deletion reads as the oldest possible deletion.
    const mine = own(local.entries, key) ?? (original ? { hlc: '', isDeleted: true as const } : undefined);
    const theirs = own(remote.entries, key) ?? (original ? { hlc: '', isDeleted: true as const } : undefined);
    const isMineChanged = !isSameEntry(original, mine);
    const isTheirsChanged = !isSameEntry(original, theirs);
    let merged: SyncEntry | undefined;
    if (!isMineChanged || !mine) merged = theirs;
    else if (!isTheirsChanged || !theirs) merged = mine;
    else if (isSameValue(mine, theirs)) merged = mine.hlc > theirs.hlc ? mine : theirs;
    else if (shape === 'set' && !!mine.isDeleted !== !!theirs.isDeleted) merged = mine.isDeleted ? theirs : mine;
    else if (shape === 'text') {
      merged = theirs;
      if (!mine.isDeleted) copies.push(mine.value ?? null);
    } else {
      const isMineNewer = mine.hlc > theirs.hlc;
      const [winner, loser] = isMineNewer ? [mine, theirs] : [theirs, mine];
      merged = shape === 'list' && !winner.isDeleted && !loser.isDeleted
        ? { hlc: tick(), value: combineLists(winner.value ?? null, loser.value ?? null, original?.isDeleted ? undefined : original?.value) }
        : winner;
      conflicts.push({ entry: key, winner: isMineNewer ? 'local' : 'remote', loser: loser.isDeleted ? null : loser.value ?? null });
    }
    if (merged && merged.hlc !== '') entries[key] = merged;
  }
  return { merged: { entries }, conflicts, copies };
}

// The first merge of a computer joining synced data: it keeps what only it has, and wherever
// both sides hold a value the synced one wins. Text still keeps the local version as a copy.
export function preferRemote(shape: SyncShape, local: SyncedRecord, remote: SyncedRecord, tick: () => string): MergeResult {
  if (shape === 'text') return mergeRecords(shape, undefined, local, remote, tick);
  if (shape === 'value') return { merged: remote, conflicts: [], copies: [] };
  if (shape === 'list') {
    const [mine, theirs] = [own(local.entries, SINGLE), own(remote.entries, SINGLE)];
    if (!mine || mine.isDeleted || !theirs || theirs.isDeleted) return { merged: remote, conflicts: [], copies: [] };
    return { merged: { entries: { [SINGLE]: { hlc: tick(), value: combineLists(theirs.value ?? null, mine.value ?? null, undefined) } } }, conflicts: [], copies: [] };
  }
  return { merged: { entries: { ...local.entries, ...remote.entries } }, conflicts: [], copies: [] };
}

export function pruneTombstones(record: SyncedRecord, before: string): SyncedRecord {
  const entries = Object.entries(record.entries);
  const kept = entries.filter(([, entry]) => !entry.isDeleted || entry.hlc >= before);
  return kept.length === entries.length ? record : { ...record, entries: Object.fromEntries(kept) };
}

// Checks a record read from the remote before anything trusts it.
export function parseSyncedRecord(value: unknown): SyncedRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sync record is not an object.');
  const { entries, deletedHlc } = value as { entries?: unknown; deletedHlc?: unknown };
  if (deletedHlc !== undefined && !isHlc(deletedHlc)) throw new Error('Sync record has an invalid deletion stamp.');
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Sync record has no entries.');
  const parsed: Record<string, SyncEntry> = {};
  for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
    if (key === UNSAFE_KEY) throw new Error('Sync record entry key is not allowed.');
    const { hlc, value: entryValue, isDeleted } = (entry ?? {}) as { hlc?: unknown; value?: Json; isDeleted?: unknown };
    if (!isHlc(hlc) || (isDeleted !== undefined && isDeleted !== true) || (isDeleted === true) === (entryValue !== undefined)) throw new Error(`Sync record entry ${key} is invalid.`);
    parsed[key] = isDeleted ? { hlc, isDeleted: true } : { hlc, value: entryValue };
  }
  if (deletedHlc !== undefined && Object.keys(parsed).length) throw new Error('A deleted sync record cannot have entries.');
  return deletedHlc === undefined ? { entries: parsed } : { entries: {}, deletedHlc: deletedHlc as string };
}
