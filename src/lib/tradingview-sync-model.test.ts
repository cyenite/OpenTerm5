import assert from 'node:assert/strict';
import test from 'node:test';
import type { TradingViewLineToolData, TradingViewSource } from '../../shared/tradingview';
import { applyRemote, eventsOf, eventsOfReload, MASS_DELETE_LIMIT, mergeDrawings, outgoing, restoreLinks, restoreSyncedDrawing, syncedFrom, type SyncedDrawing, type SyncLink } from './tradingview-sync-model';

const T = 1_760_000_400;

const shared: TradingViewSource = { scope: 'chart', layoutId: 'L1', layoutUrl: 'L1', layoutName: 'Main', chartId: '_shared', storageSymbol: 'OANDA:EURUSD' };

const link: SyncLink = { symbol: 'EURUSD', tradingView: { symbol: 'OANDA:EURUSD', count: 1, ids: [], sources: [shared] } };

const options = { now: 1_000, serverOffsetAt: () => 0 };

function trend(id: string, price: number, time: number, source = shared, color = '#2962ff'): TradingViewLineToolData {
  const state = { linecolor: color, linewidth: 2 };
  const points = [{ time_t: T, offset: 0, price, interval: '60' }, { time_t: T + 3600, offset: 0, price: price + 0.01, interval: '60' }];
  return { id, type: 'LineToolTrendLine', points, state, zorder: 1, isOnPrice: true, origin: { source, serverUpdateTime: time, record: { id, symbol: source.storageSymbol, ownerSource: 'ibCWf0', serverUpdateTime: time, state: { type: 'LineToolTrendLine', id, state, points, zorder: 1 } } } };
}

function entryOf(tool: TradingViewLineToolData): SyncedDrawing {
  const synced = syncedFrom(tool, 'EURUSD', undefined, options);
  assert.notEqual(typeof synced, 'string', String(synced));
  return synced as SyncedDrawing;
}

const ledgerOf = (...entries: SyncedDrawing[]) => new Map(entries.map((entry) => [entry.drawing.id, entry]));

test('an edit here goes to its TradingView target as the patched record; unchanged drawings stay', () => {
  const [a, b] = [entryOf(trend('a', 1.1, 5)), entryOf(trend('b', 1.2, 5))];
  const moved = { ...a.drawing, style: { ...a.drawing.style, lineWidth: 5 } };
  const plan = outgoing(ledgerOf(a, b), link, [moved, b.drawing], { ...options, isMassDeleteAllowed: false });
  assert.equal(plan.pushes.length, 1);
  const state = (plan.pushes[0].records.a as { state: { state: Record<string, unknown> } }).state.state;
  assert.equal(state.linewidth, 5);
  assert.deepEqual(Object.keys(plan.pushes[0].records), ['a']);
  assert.deepEqual(plan.pushes[0].entries.map(({ drawingId, entry }) => [drawingId, entry?.drawing.style.lineWidth, entry?.editedAt]), [['tv-a', 5, undefined]]);
  assert.deepEqual(plan.edited.map((entry) => [entry.tvId, entry.editedAt]), [['a', 1_000]]);
  assert.deepEqual(outgoing(ledgerOf(a, b), link, [a.drawing, b.drawing], { ...options, isMassDeleteAllowed: false }).pushes, []);
});

test('a deletion here deletes in TradingView, but a mass deletion waits for the user', () => {
  const a = entryOf(trend('a', 1.1, 5));
  const plan = outgoing(ledgerOf(a), link, [], { ...options, isMassDeleteAllowed: false });
  assert.deepEqual(plan.pushes.map((push) => push.records), [{ a: null }]);
  const many = Array.from({ length: MASS_DELETE_LIMIT + 1 }, (_, index) => entryOf(trend(`m${index}`, 1, 5)));
  const held = outgoing(ledgerOf(...many), link, [], { ...options, isMassDeleteAllowed: false });
  assert.deepEqual([held.pushes.length, held.heldDeletions.length], [0, MASS_DELETE_LIMIT + 1]);
  assert.equal(outgoing(ledgerOf(...many), link, [], { ...options, isMassDeleteAllowed: true }).pushes[0].entries.length, MASS_DELETE_LIMIT + 1);
});

test('a newer TradingView save replaces the drawing; an older one or the same content does not', () => {
  const a = entryOf(trend('a', 1.1, 5));
  const newer = applyRemote(ledgerOf(a), link, [a.drawing], [{ kind: 'saved', tool: trend('a', 1.3, 9) }], options);
  assert.equal(newer.drawings[0].anchors[0].price, 1.3);
  assert.equal(newer.drawings[0].createdAt, a.drawing.createdAt);
  assert.equal(newer.upserts[0].serverUpdateTime, 9);
  const older = applyRemote(ledgerOf(a), link, [a.drawing], [{ kind: 'saved', tool: trend('a', 1.3, 4) }], options);
  assert.deepEqual([older.drawings, older.upserts], [[a.drawing], []]);
  // Our own save read back later: same content, a later time; only the time is taken.
  const echo = applyRemote(ledgerOf(a), link, [a.drawing], [{ kind: 'saved', tool: trend('a', 1.1, 7) }], options);
  assert.deepEqual([echo.drawings, echo.upserts.map((entry) => entry.serverUpdateTime)], [[a.drawing], [7]]);
});

test('a new TradingView drawing is added and a TradingView deletion removes it', () => {
  const added = applyRemote(new Map(), link, [], [{ kind: 'saved', tool: trend('n', 1.1, 5) }], options);
  assert.deepEqual(added.drawings.map((drawing) => drawing.id), ['tv-n']);
  const removed = applyRemote(ledgerOf(added.upserts[0]), link, added.drawings, [{ kind: 'removed', drawingId: 'tv-n' }], options);
  assert.deepEqual([removed.drawings, removed.removals, removed.notes], [[], ['tv-n'], []]);
});

test('edits made on both sides merge setting by setting, the newer edit winning a shared setting', () => {
  const a = entryOf(trend('a', 1.1, 5));
  const local = { ...a.drawing, style: { ...a.drawing.style, lineWidth: 6, lineColor: '#00ff00' } };
  const remote = trend('a', 1.5, 9, shared, '#ff0000');
  const olderHere = applyRemote(ledgerOf({ ...a, editedAt: 8 }), link, [local], [{ kind: 'saved', tool: remote }], options);
  assert.deepEqual([olderHere.drawings[0].anchors[0].price, olderHere.drawings[0].style.lineWidth, olderHere.drawings[0].style.lineColor], [1.5, 6, '#ff0000']);
  assert.match(olderHere.notes[0], /TradingView edit was newer and kept for style.lineColor/);
  assert.equal(olderHere.upserts[0].editedAt, 8);
  const newerHere = applyRemote(ledgerOf({ ...a, editedAt: 10 }), link, [local], [{ kind: 'saved', tool: remote }], options);
  assert.equal(newerHere.drawings[0].style.lineColor, '#00ff00');
});

test('a deletion here against an edit in TradingView: the newer one wins', () => {
  const a = entryOf(trend('a', 1.1, 5));
  const kept = applyRemote(ledgerOf({ ...a, editedAt: 10 }), link, [], [{ kind: 'saved', tool: trend('a', 1.5, 9) }], options);
  assert.deepEqual([kept.drawings, kept.upserts[0].editedAt], [[], 10]);
  const back = applyRemote(ledgerOf({ ...a, editedAt: 8 }), link, [], [{ kind: 'saved', tool: trend('a', 1.5, 9) }], options);
  assert.equal(back.drawings[0].anchors[0].price, 1.5);
});

test('three-way merge leaves untouched settings as TradingView has them', () => {
  const base = entryOf(trend('a', 1.1, 5)).drawing;
  const { drawing, conflicts } = mergeDrawings(base, { ...base, locked: true }, { ...base, text: 'from TV' }, false);
  assert.deepEqual([drawing.locked, drawing.text, conflicts], [true, 'from TV', []]);
});

test('stream deletions apply only at the target that holds the drawing, and a cleared symbol empties it', () => {
  const synced: TradingViewSource = { ...shared, scope: 'synced', chartId: undefined };
  const [a, b] = [entryOf(trend('a', 1.1, 5)), entryOf(trend('b', 1.2, 5, synced))];
  const ledger = ledgerOf(a, b);
  // Sharing a drawing to all layouts deletes it in the layout and saves it under UserSync.
  assert.deepEqual(eventsOf({ source: synced, tools: [], removedIds: ['a'], isSymbolCleared: false }, link, ledger), []);
  assert.deepEqual(eventsOf({ source: shared, tools: [trend('x', 1, 5, { ...shared, storageSymbol: 'FX:GBPUSD' })], removedIds: ['a'], isSymbolCleared: false }, link, ledger), [{ kind: 'removed', drawingId: 'tv-a' }]);
  assert.deepEqual(eventsOf({ source: synced, tools: [], removedIds: [], isSymbolCleared: true }, link, ledger), [{ kind: 'removed', drawingId: 'tv-b' }]);
});

test('a reload deletes held drawings gone from targets it read, and keeps those it could not read', () => {
  const synced: TradingViewSource = { ...shared, scope: 'synced', chartId: undefined };
  const ledger = ledgerOf(entryOf(trend('a', 1.1, 5)), entryOf(trend('b', 1.2, 5, synced)));
  const events = eventsOfReload([], link, ledger, (source) => source.scope === 'chart');
  assert.deepEqual(events, [{ kind: 'removed', drawingId: 'tv-a' }]);
});

test('links and ledger entries read back from storage, and broken ones are dropped', () => {
  assert.deepEqual(restoreLinks(JSON.parse(JSON.stringify([link, { symbol: 'X', tradingView: { symbol: 'FX:X', sources: [{ scope: 'nowhere' }] } }, 'junk']))), [link]);
  const entry = { ...entryOf(trend('a', 1.1, 5)), editedAt: 3 };
  assert.deepEqual(restoreSyncedDrawing(JSON.parse(JSON.stringify(entry))), entry);
  assert.equal(restoreSyncedDrawing({ ...entry, source: { scope: 'chart' } }), null);
});

test('a deletion saved to TradingView leaves a tombstone, so undoing it re-creates the drawing there', () => {
  const a = entryOf(trend('a', 1.1, 5));
  const deleted = outgoing(ledgerOf(a), link, [], { ...options, isMassDeleteAllowed: false }).pushes[0].entries[0].entry;
  assert.equal(deleted.isDeleted, true);
  assert.deepEqual(outgoing(ledgerOf(deleted), link, [], { ...options, isMassDeleteAllowed: false }).pushes, []);
  const undone = outgoing(ledgerOf(deleted), link, [a.drawing], { ...options, isMassDeleteAllowed: false });
  assert.deepEqual(undone.pushes[0].records.a, a.record);
  assert.equal(undone.pushes[0].entries[0].entry.isDeleted, undefined);
  assert.deepEqual(eventsOfReload([], link, ledgerOf(deleted), () => true), []);
});
