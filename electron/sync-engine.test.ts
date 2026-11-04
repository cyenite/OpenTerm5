import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { deriveKeys, newRootKey } from './sync-crypto';
import { device, FakeRemote, REPO_ID } from './sync-engine-fixtures';
import { MANIFEST_PATH, openManifest, sealManifest, SyncIntegrityError } from './sync-manifest';

function setup(kinds: Parameters<typeof device>[3] = ['layout', 'chartDrawings', 'pineScript']) {
  const remote = new FakeRemote();
  const rootKey = newRootKey();
  const clock = { now: 1_800_000_000_000 };
  return { remote, rootKey, clock, a: device('a', remote, rootKey, kinds, clock), b: device('b', remote, rootKey, kinds, clock), tick: (ms = 1000) => { clock.now += ms; } };
}

const integrity = (reason: string) => (error: unknown) => error instanceof SyncIntegrityError && error.reason === reason;

test('one computer\'s data reaches another, and nothing readable is written', async () => {
  const { remote, a, b } = setup();
  a.source('layout').data = { L1: { name: 'Gold scalping', charts: ['c1', 'c2'] } };
  a.source('chartDrawings').data = { c1: { d1: { type: 'trendline', price: 2350.5 } } };
  assert.equal((await a.engine.sync()).status, 'synced');
  const outcome = await b.engine.sync();
  assert.deepEqual(b.source('layout').data, a.source('layout').data);
  assert.deepEqual(b.source('chartDrawings').data, a.source('chartDrawings').data);
  assert.equal(outcome.status === 'synced' && outcome.pulled, 2);
  for (const [path, content] of remote.files()) {
    assert.ok(path === MANIFEST_PATH || /^objects\/[0-9a-f]{2}\/[0-9a-f]{62}$/.test(path), path);
    // Four bytes or more: shorter strings turn up in random ciphertext by chance.
    for (const secret of ['Gold scalping', 'trendline', '2350.5', 'layout', 'chartDrawings']) assert.ok(!content.includes(secret), `${secret} visible in ${path}`);
  }
});

test('edits to different drawings on two computers both survive', async () => {
  const { a, b, tick } = setup();
  a.source('chartDrawings').data = { c1: { d1: 'line', d2: 'box' } };
  await a.engine.sync();
  await b.engine.sync();
  a.source('chartDrawings').data = { c1: { d1: 'line moved', d2: 'box' } };
  b.source('chartDrawings').data = { c1: { d1: 'line', d2: 'box', d3: 'fib' } };
  tick();
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  const expected = { c1: { d1: 'line moved', d2: 'box', d3: 'fib' } };
  assert.deepEqual(a.source('chartDrawings').data, expected);
  assert.deepEqual(b.source('chartDrawings').data, expected);
});

test('a push that loses the race pulls, merges and lands on the retry', async () => {
  const { remote, a, b, tick } = setup();
  await a.engine.sync();
  await b.engine.sync();
  a.source('layout').data = { L1: { name: 'From A' } };
  b.source('layout').data = { L2: { name: 'From B' } };
  tick();
  remote.beforeCommit = async () => { await a.engine.sync(); };
  const outcome = await b.engine.sync();
  assert.equal(outcome.status, 'synced');
  await a.engine.sync();
  const expected = { L1: { name: 'From A' }, L2: { name: 'From B' } };
  assert.deepEqual(b.source('layout').data, expected);
  assert.deepEqual(a.source('layout').data, expected);
});

test('a value merged in from the remote is not pushed back as a local edit', async () => {
  const { remote, a, b, tick } = setup();
  a.source('layout').data = { L1: { color: 'red' } };
  await a.engine.sync();
  await b.engine.sync();
  a.source('layout').data = { L1: { color: 'blue' } };
  await a.engine.recordLocalChanges();
  tick();
  b.source('layout').data = { L1: { color: 'green' } };
  await b.engine.sync();
  const outcome = await a.engine.sync();
  assert.deepEqual(a.source('layout').data, { L1: { color: 'green' } });
  assert.deepEqual(outcome.status === 'synced' && outcome.conflicts, [{ key: 'layout:L1', entry: 'color', winner: 'remote', loser: 'blue' }]);
  const head = remote.current;
  tick();
  await a.engine.sync();
  assert.equal(remote.current, head, 'nothing left to push');
});

test('an edit made offline yesterday loses to a newer edit, even when it syncs last', async () => {
  const { a, b, tick } = setup();
  a.source('layout').data = { L1: { name: 'original' } };
  await a.engine.sync();
  await b.engine.sync();
  a.source('layout').data = { L1: { name: 'offline edit' } };
  assert.equal(await a.engine.recordLocalChanges(), 1);
  assert.equal(await a.engine.recordLocalChanges(), 0);
  tick(86_400_000);
  b.source('layout').data = { L1: { name: 'newer edit' } };
  await b.engine.sync();
  tick();
  await a.engine.sync();
  assert.deepEqual(a.source('layout').data, { L1: { name: 'newer edit' } });
});

test('a Pine script edited on both computers keeps both versions', async () => {
  const { a, b, tick } = setup();
  a.source('pineScript').data = { s1: { name: 'RSI', source: 'v1' } };
  await a.engine.sync();
  await b.engine.sync();
  tick();
  a.source('pineScript').data = { s1: { name: 'RSI', source: 'v2 from A' } };
  b.source('pineScript').data = { s1: { name: 'RSI', source: 'v2 from B' } };
  await b.engine.sync();
  const outcome = await a.engine.sync();
  await b.engine.sync();
  const copy = outcome.status === 'synced' ? outcome.copies[0].slice('pineScript:'.length) : '';
  assert.match(copy, /^s1~conflict~a~/);
  for (const computer of [a, b]) assert.deepEqual(computer.source('pineScript').data, { s1: { name: 'RSI', source: 'v2 from B' }, [copy]: { name: 'RSI', source: 'v2 from A' } });
});

test('an altered object stops the sync and changes nothing locally', async () => {
  const { remote, a, b } = setup();
  a.source('layout').data = { L1: { name: 'Mine' } };
  await a.engine.sync();
  const [path, content] = [...remote.files()].find(([name]) => name !== MANIFEST_PATH)!;
  const altered = Buffer.from(content);
  altered[40] ^= 1;
  remote.write(new Map([[path, altered]]));
  b.source('layout').data = { L9: { name: 'Untouched' } };
  await assert.rejects(b.engine.sync(), integrity('tampered'));
  assert.deepEqual(b.source('layout').data, { L9: { name: 'Untouched' } });
  assert.equal(b.store.state, null);
});

test('a missing manifest, a foreign key and an older repository state are all refused', async () => {
  const { remote, rootKey, clock, a, tick } = setup();
  a.source('layout').data = { L1: { name: 'v1' } };
  await a.engine.sync();
  const old = remote.current!;
  tick();
  a.source('layout').data = { L1: { name: 'v2' } };
  await a.engine.sync();

  const stranger = device('s', remote, newRootKey(), ['layout'], clock);
  await assert.rejects(stranger.engine.sync(), integrity('tampered'));

  const latest = remote.current;
  remote.current = old;
  await assert.rejects(a.engine.sync(), integrity('rollback'));
  assert.deepEqual(a.source('layout').data, { L1: { name: 'v2' } });
  await a.engine.sync({ isHistoryAccepted: true, isLocalDiscarded: true });
  assert.deepEqual(a.source('layout').data, { L1: { name: 'v1' } });
  remote.current = latest;

  remote.current = remote.commits.size ? [...remote.commits.keys()].at(-1)! : null;
  remote.write(new Map([[MANIFEST_PATH, null]]));
  await assert.rejects(a.engine.sync(), integrity('tampered'));
  assert.ok(device('a2', remote, rootKey, ['layout'], clock));
});

test('a store emptied by corruption is held for the user, not deleted everywhere', async () => {
  const { remote, a, b, tick } = setup();
  a.source('layout').data = Object.fromEntries(['L1', 'L2', 'L3', 'L4', 'L5'].map((id) => [id, { name: id }]));
  await a.engine.sync();
  await b.engine.sync();
  const head = remote.current;
  tick();
  a.source('layout').data = {};
  const held = await a.engine.sync();
  assert.deepEqual(held, { status: 'held', changes: [{ kind: 'layout', side: 'local', removed: 5, total: 5 }] });
  assert.equal(remote.current, head);

  await a.engine.sync({ isLocalDiscarded: true });
  assert.equal(Object.keys(a.source('layout').data).length, 5);

  a.source('layout').data = {};
  await a.engine.sync({ isMassChangeAllowed: true });
  assert.deepEqual(await b.engine.sync(), { status: 'held', changes: [{ kind: 'layout', side: 'remote', removed: 5, total: 5 }] });
  await b.engine.sync({ isMassChangeAllowed: true });
  assert.deepEqual(b.source('layout').data, {});
});

test('deleting many drawings from one chart is held too', async () => {
  const { a } = setup();
  const drawings = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`d${index}`, index]));
  a.source('chartDrawings').data = { c1: drawings };
  await a.engine.sync();
  a.source('chartDrawings').data = { c1: { d0: 0 } };
  assert.equal((await a.engine.sync()).status, 'held');
});

test('a store that refuses a change rolls every store back and keeps the old state', async () => {
  const { a, b, tick } = setup();
  a.source('layout').data = { L1: { name: 'new layout' } };
  a.source('chartDrawings').data = { c1: { d1: 'line' } };
  await a.engine.sync();
  const drawings = b.source('chartDrawings');
  drawings.onApply = (change) => { if (Object.keys(change.upserts).length) throw new Error('quota exceeded'); };
  tick();
  await assert.rejects(b.engine.sync(), /quota exceeded/);
  assert.deepEqual(b.source('layout').data, {});
  assert.equal(b.store.state?.head ?? null, null);
  assert.deepEqual(b.store.state?.pending ?? {}, {});
  drawings.onApply = undefined;
  await b.engine.sync();
  assert.deepEqual(b.source('chartDrawings').data, { c1: { d1: 'line' } });
});

test('a crash part-way through applying is finished at the next start', async () => {
  const { a, b } = setup();
  a.source('layout').data = { L1: { name: 'layout' } };
  a.source('chartDrawings').data = { c1: { d1: 'line' } };
  await a.engine.sync();
  b.source('chartDrawings').onApply = () => {
    b.store.isNextSaveFailing = true;
    throw new Error('crash');
  };
  await assert.rejects(b.engine.sync(), /disk gone/);
  assert.equal(b.store.state?.isApplying, true);
  b.source('chartDrawings').onApply = undefined;
  const restarted = b.restart();
  await restarted.engine.sync();
  assert.equal(b.store.state?.isApplying, false);
  assert.deepEqual(b.source('layout').data, { L1: { name: 'layout' } });
  assert.deepEqual(b.source('chartDrawings').data, { c1: { d1: 'line' } });
});

test('kinds a computer does not sync are carried along untouched', async () => {
  const { remote, rootKey, clock, a, tick } = setup();
  a.source('pineScript').data = { s1: { name: 'RSI', source: 'x' } };
  a.source('layout').data = { L1: { name: 'one' } };
  await a.engine.sync();
  const layoutsOnly = device('c', remote, rootKey, ['layout'], clock);
  await layoutsOnly.engine.sync();
  layoutsOnly.source('layout').data = { L1: { name: 'renamed' } };
  tick();
  await layoutsOnly.engine.sync();
  a.source('pineScript').data = {};
  await a.engine.sync({ isLocalDiscarded: true });
  assert.deepEqual(a.source('pineScript').data, { s1: { name: 'RSI', source: 'x' } });
  assert.deepEqual(a.source('layout').data, { L1: { name: 'renamed' } });
});

test('an authentic but invalid record is skipped without blocking the rest', async () => {
  const { a, b } = setup();
  a.source('layout').data = { L1: { name: 'fine' }, L2: { name: 42 } };
  await a.engine.sync();
  b.source('layout').isValid = (value) => typeof (value as { name?: unknown }).name === 'string';
  const outcome = await b.engine.sync();
  assert.deepEqual(b.source('layout').data, { L1: { name: 'fine' } });
  assert.deepEqual(outcome.status === 'synced' && outcome.skipped, ['layout:L2']);
});

test('a record too large to sync is skipped and the rest still lands', async () => {
  const { a, b } = setup();
  a.source('chartDrawings').data = { huge: { d1: randomBytes(300 * 1024).toString('base64') }, small: { d1: 'line' } };
  const outcome = await a.engine.sync();
  assert.deepEqual(outcome.status === 'synced' && outcome.skipped, ['chartDrawings:huge']);
  await b.engine.sync();
  assert.deepEqual(b.source('chartDrawings').data, { small: { d1: 'line' } });
});

test('every computer registers itself, and a removed one cannot push', async () => {
  const { remote, rootKey, a, b } = setup();
  await a.engine.sync();
  await b.engine.sync();
  const keys = deriveKeys(rootKey);
  const manifest = openManifest(keys, remote.files().get(MANIFEST_PATH)!, { epoch: 1, repoId: REPO_ID, highWater: 0 });
  assert.deepEqual(manifest.devices.map((item) => item.id).sort(), ['a', 'b']);
  remote.write(new Map([[MANIFEST_PATH, sealManifest(keys, { ...manifest, seq: manifest.seq + 1, devices: manifest.devices.map((item) => item.id === 'b' ? { ...item, isRevoked: true } : item) })]]));
  b.source('layout').data = { L1: { name: 'x' } };
  await assert.rejects(b.engine.sync(), integrity('revoked'));
  await a.engine.sync();

  const revoked = openManifest(keys, remote.files().get(MANIFEST_PATH)!, { epoch: 1, repoId: REPO_ID, highWater: 0 });
  const writtenByRemoved = { ...revoked, seq: revoked.seq + 1, writer: 'b' };
  remote.write(new Map([[MANIFEST_PATH, sealManifest(keys, writtenByRemoved)]]));
  await assert.rejects(a.engine.sync(), integrity('tampered'));
  const restored = { ...revoked, seq: revoked.seq + 2, writer: 'a', devices: revoked.devices.map((item) => ({ ...item, isRevoked: false })) };
  remote.write(new Map([[MANIFEST_PATH, sealManifest(keys, restored)]]));
  await assert.rejects(a.engine.sync(), /brings back a computer/);
});

test('old deletions are cleared after 180 days, and a computer away longer must choose', async () => {
  const { remote, rootKey, a, b, tick } = setup();
  a.source('layout').data = { L1: { name: 'kept' }, L2: { name: 'gone' } };
  await a.engine.sync();
  await b.engine.sync();
  a.source('layout').data = { L1: { name: 'kept' } };
  await a.engine.sync();
  tick(181 * 86_400_000);
  a.source('layout').data = { L1: { name: 'kept' }, L3: { name: 'new' } };
  await a.engine.sync();
  const manifest = openManifest(deriveKeys(rootKey), remote.files().get(MANIFEST_PATH)!, { epoch: 1, repoId: REPO_ID, highWater: 0 });
  assert.equal(manifest.records['layout:L2'], undefined);
  assert.ok(manifest.tombstonesPrunedBefore);
  await assert.rejects(b.engine.sync(), integrity('stale'));
  await b.engine.sync({ isLocalDiscarded: true });
  assert.deepEqual(b.source('layout').data, { L1: { name: 'kept' }, L3: { name: 'new' } });
});

test('two computers syncing many random edits end up identical', async () => {
  let seed = 7;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const { a, b, tick } = setup();
  for (let step = 0; step < 150; step++) {
    const computer = random() < 0.5 ? a : b;
    const drawings = computer.source('chartDrawings');
    const chart = `c${Math.floor(random() * 3)}`;
    const items = { ...(drawings.data[chart] as Record<string, string> | undefined ?? {}) };
    if (random() < 0.3) delete items[`d${Math.floor(random() * 4)}`];
    else items[`d${Math.floor(random() * 4)}`] = `v${step}`;
    drawings.data = { ...drawings.data, [chart]: items };
    tick(Math.floor(random() * 3000));
    if (random() < 0.4) assert.notEqual((await computer.engine.sync({ isMassChangeAllowed: true })).status, 'busy');
  }
  for (const computer of [a, b, a]) await computer.engine.sync({ isMassChangeAllowed: true });
  assert.deepEqual(a.source('chartDrawings').data, b.source('chartDrawings').data);
});
