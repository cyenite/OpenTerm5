import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWatchlist, restoreWatchlists, saveWatchlist, watchlistScope } from './watchlist-presets';

test('named sets preserve real symbol names and isolate account/endpoint scopes', () => {
  const scope = watchlistScope('wss://one.example/terminal', 'account-one');
  const other = watchlistScope('wss://two.example/terminal', 'account-one');
  const sets = saveWatchlist(saveWatchlist([], scope, 'FX', ['eurusd.a', 'XAUUSD', 'eurusd.a']), other, 'FX', ['EURUSD']);
  assert.equal(sets.length, 2);
  assert.deepEqual(restoreWatchlists(JSON.parse(JSON.stringify(sets))), sets);
  assert.deepEqual(sets[0].symbols, ['eurusd.a', 'XAUUSD']);
  assert.equal(saveWatchlist(sets, scope, 'FX', ['GBPUSD']).length, 2);
  assert.throws(() => saveWatchlist([], scope, ' ', ['EURUSD']));
  assert.throws(() => restoreWatchlists([{ scope, name: 'FX', symbols: [42] }]));
});

test('apply replaces visibility sequentially and validates before any mutation', async () => {
  const scope = 'account';
  const changes: [string, boolean][] = [];
  const symbols = [{ name: 'EURUSD', visible: true }, { name: 'GBPUSD', visible: false }];
  await applyWatchlist({ scope, name: 'GBP', symbols: ['GBPUSD'] }, scope, symbols, async (name, isVisible) => { changes.push([name, isVisible]); }, () => scope);
  assert.deepEqual(changes, [['EURUSD', false], ['GBPUSD', true]]);
  await assert.rejects(applyWatchlist({ scope, name: 'missing', symbols: ['BAD'] }, scope, symbols, async () => assert.fail(), () => scope), /unavailable/);
  await assert.rejects(applyWatchlist({ scope: 'other', name: 'wrong', symbols: [] }, scope, symbols, async () => assert.fail(), () => scope), /different account/);
});

test('context change and broker rejection stop subsequent visibility requests', async () => {
  let scope = 'account';
  let calls = 0;
  const symbols = [{ name: 'EURUSD', visible: true }, { name: 'GBPUSD', visible: false }];
  const preset = { scope, name: 'GBP', symbols: ['GBPUSD'] };
  await assert.rejects(applyWatchlist(preset, scope, symbols, async () => { calls += 1; scope = 'other'; }, () => scope), /changed/);
  assert.equal(calls, 1);
  scope = 'account';
  await assert.rejects(applyWatchlist(preset, scope, symbols, async () => { throw new Error('broker refused'); }, () => scope), /broker refused/);
});
