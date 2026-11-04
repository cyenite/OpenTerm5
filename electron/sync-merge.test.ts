import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Json, SyncShape } from '../shared/sync';
import { HybridClock, isHlc } from './sync-clock';
import { fromEntries, mergeRecords, parseSyncedRecord, pruneTombstones, recordPlain, stampRecord, type SyncedRecord } from './sync-merge';

function clocks() {
  let time = 1_000_000;
  const now = () => time;
  return { a: new HybridClock('a', now), b: new HybridClock('b', now), advance: (ms = 1) => { time += ms; } };
}

function edit(shape: SyncShape, base: SyncedRecord | undefined, plain: Json | undefined, clock: HybridClock) {
  return stampRecord(shape, base, plain, () => clock.tick());
}

test('clock stamps sort by time, then counter, and never fall behind a stamp seen', () => {
  let time = 5;
  const clock = new HybridClock('dev1', () => time);
  const first = clock.tick();
  const second = clock.tick();
  assert.ok(isHlc(first) && second > first);
  clock.observe('9999999999999.0003.other');
  assert.ok(clock.tick() > '9999999999999.0003.other');
  time = 1;
  assert.ok(clock.tick() > second);
  assert.throws(() => new HybridClock('Bad-Id'), /device id/);
  assert.throws(() => clock.observe('nonsense'), /stamp/);
});

test('stamping keeps unchanged entries and marks only what changed', () => {
  const { a, advance } = clocks();
  const base = edit('map', undefined, { x: 1, y: 2 }, a)!;
  advance();
  assert.equal(edit('map', base, { x: 1, y: 2 }, a), base);
  const next = edit('map', base, { x: 1, z: 3 }, a)!;
  assert.equal(next.entries.x, base.entries.x);
  assert.equal(next.entries.y.isDeleted, true);
  assert.deepEqual(fromEntries('map', next.entries), { x: 1, z: 3 });
});

test('a field missing from a snapshot is kept, a missing map item is deleted', () => {
  const { a } = clocks();
  const fields = edit('fields', undefined, { name: 'A', future: 'kept' }, a)!;
  assert.deepEqual(recordPlain('fields', edit('fields', fields, { name: 'B' }, a)), { name: 'B', future: 'kept' });
  const map = edit('map', undefined, { one: 1, two: 2 }, a)!;
  assert.deepEqual(recordPlain('map', edit('map', map, { one: 1 }, a)), { one: 1 });
});

test('edits to different entries merge cleanly', () => {
  const { a, b } = clocks();
  const base = edit('map', undefined, { d1: 'line', d2: 'box' }, a)!;
  const local = edit('map', base, { d1: 'line moved', d2: 'box' }, a);
  const remote = edit('map', base, { d1: 'line', d2: 'box', d3: 'fib' }, b);
  const result = mergeRecords('map', base, local, remote, () => a.tick());
  assert.deepEqual(recordPlain('map', result.merged), { d1: 'line moved', d2: 'box', d3: 'fib' });
  assert.deepEqual(result.conflicts, []);
});

test('the same entry edited on both sides goes to the newer edit and reports the loser', () => {
  const { a, b, advance } = clocks();
  const base = edit('fields', undefined, { color: 'red' }, a)!;
  const local = edit('fields', base, { color: 'blue' }, a);
  advance();
  const remote = edit('fields', base, { color: 'green' }, b);
  const result = mergeRecords('fields', base, local, remote, () => a.tick());
  assert.deepEqual(recordPlain('fields', result.merged), { color: 'green' });
  assert.deepEqual(result.conflicts, [{ entry: 'color', winner: 'remote', loser: 'blue' }]);
});

test('an edit racing a delete goes to the newer one, both for entries and whole records', () => {
  const { a, b, advance } = clocks();
  const base = edit('map', undefined, { d1: 'line' }, a)!;
  const deleted = edit('map', base, {}, a);
  advance();
  const edited = edit('map', base, { d1: 'line moved' }, b);
  assert.deepEqual(recordPlain('map', mergeRecords('map', base, deleted, edited, () => a.tick()).merged), { d1: 'line moved' });

  const removedRecord = edit('map', base, undefined, a);
  const record = mergeRecords('map', base, removedRecord, edited, () => a.tick());
  assert.deepEqual(recordPlain('map', record.merged), { d1: 'line moved' });
  assert.deepEqual(record.conflicts, [{ entry: null, winner: 'remote', loser: null }]);
  advance();
  const lateRemoval = edit('map', base, undefined, a);
  const removal = mergeRecords('map', base, lateRemoval, edited, () => a.tick());
  assert.equal(recordPlain('map', removal.merged), undefined);
  assert.deepEqual(removal.conflicts, [{ entry: null, winner: 'local', loser: { d1: 'line moved' } }]);
});

test('a set keeps a member one side added while the other removed it', () => {
  const { a, b, advance } = clocks();
  const base = edit('set', undefined, ['rsi'], a)!;
  const removed = edit('set', base, [], a);
  advance();
  const readded = edit('set', edit('set', base, [], b), ['rsi', 'macd'], b);
  assert.deepEqual(recordPlain('set', mergeRecords('set', base, removed, readded, () => a.tick()).merged), ['macd', 'rsi']);
});

test('lists keep the newer order plus the other side\'s additions and removals', () => {
  const { a, b, advance } = clocks();
  const base = edit('list', undefined, ['L1', 'L2', 'L3'], a)!;
  const local = edit('list', base, ['L1', 'L3', 'L4'], a);
  advance();
  const remote = edit('list', base, ['L3', 'L2', 'L1'], b);
  const result = mergeRecords('list', base, local, remote, () => a.tick());
  assert.deepEqual(recordPlain('list', result.merged), ['L3', 'L1', 'L4']);
  assert.notEqual(result.merged!.entries[''].hlc, remote!.entries[''].hlc);
});

test('text both sides changed keeps the remote version and copies the local one', () => {
  const { a, b, advance } = clocks();
  const base = edit('text', undefined, { name: 'RSI', source: 'v1' }, a)!;
  advance();
  const local = edit('text', base, { name: 'RSI', source: 'v2 local' }, a);
  const remote = edit('text', base, { name: 'RSI', source: 'v2 remote' }, b);
  const result = mergeRecords('text', base, local, remote, () => a.tick());
  assert.deepEqual(recordPlain('text', result.merged), { name: 'RSI', source: 'v2 remote' });
  assert.deepEqual(result.copies, [{ name: 'RSI', source: 'v2 local' }]);
});

test('identical edits on both sides are not conflicts', () => {
  const { a, b } = clocks();
  const base = edit('fields', undefined, { x: 1 }, a)!;
  const result = mergeRecords('fields', base, edit('fields', base, { x: 2 }, a), edit('fields', base, { x: 2 }, b), () => a.tick());
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(recordPlain('fields', result.merged), { x: 2 });
});

test('pruned tombstones read as old deletions', () => {
  const { a, b, advance } = clocks();
  const base = edit('map', undefined, { d1: 1, d2: 2 }, a)!;
  const remote = edit('map', base, { d2: 2 }, b)!;
  advance(10);
  const cut = a.tick();
  const pruned = pruneTombstones(remote, cut);
  assert.equal(pruned.entries.d1, undefined);
  assert.deepEqual(recordPlain('map', mergeRecords('map', base, base, pruned, () => a.tick()).merged), { d2: 2 });
});

test('records read from the remote are checked', () => {
  const good = { entries: { a: { hlc: '0000000000001.0000.a', value: 1 }, b: { hlc: '0000000000001.0001.a', isDeleted: true } } };
  assert.deepEqual(parseSyncedRecord(good), good);
  for (const bad of [null, [], { entries: [] }, { entries: { a: { hlc: 'x', value: 1 } } }, { entries: { a: { hlc: '0000000000001.0000.a' } } },
    { entries: { a: { hlc: '0000000000001.0000.a', value: 1, isDeleted: true } } }, { entries: { a: { hlc: '0000000000001.0000.a', value: 1 } }, deletedHlc: '0000000000002.0000.a' }]) {
    assert.throws(() => parseSyncedRecord(bad), Error, JSON.stringify(bad));
  }
});

// Three replicas edit one map at random and sync in random order through a compare-and-swap
// remote: each sync merges into the latest remote state, pushes, and applies the result locally
// before editing again (as the engine does). Afterwards every replica must hold the same map, and
// each key must hold whichever stamped edit to it was newest: nothing that should win is lost.
test('random edits on three replicas converge on the newest edit of every key', () => {
  let seed = 42;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 300; round++) {
    let time = 1;
    const replicas = ['a', 'b', 'c'].map((id) => ({ clock: new HybridClock(id, () => time), base: undefined as SyncedRecord | undefined, plain: {} as Record<string, Json> }));
    const newest = new Map<string, { hlc: string; value?: Json }>();
    let remote: SyncedRecord | undefined;
    const sync = (replica: (typeof replicas)[number]) => {
      const local = stampRecord('map', replica.base, replica.plain, () => replica.clock.tick());
      for (const [key, entry] of Object.entries(local?.entries ?? {})) if ((newest.get(key)?.hlc ?? '') < entry.hlc) newest.set(key, entry);
      const result = mergeRecords('map', replica.base, local, remote, () => replica.clock.tick());
      for (const entry of Object.values(result.merged?.entries ?? {})) replica.clock.observe(entry.hlc);
      remote = result.merged;
      replica.base = remote;
      replica.plain = { ...(recordPlain('map', remote) as Record<string, Json> | undefined ?? {}) };
    };
    for (let step = 0; step < 40; step++) {
      time += Math.floor(random() * 3);
      const replica = replicas[Math.floor(random() * 3)];
      if (random() < 0.6) {
        const key = `k${Math.floor(random() * 6)}`;
        if (random() < 0.2) delete replica.plain[key];
        else replica.plain[key] = `${replica.clock.tick()}`;
      } else sync(replica);
    }
    for (const replica of [...replicas, ...replicas]) sync(replica);
    const expected = Object.fromEntries([...newest].filter(([, entry]) => entry.value !== undefined).map(([key, entry]) => [key, entry.value!]));
    for (const replica of replicas) assert.deepEqual(replica.plain, expected, `round ${round}`);
  }
});
