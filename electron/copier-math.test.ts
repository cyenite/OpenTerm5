import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyStops, copyVolume, defaultFollower, isWithinHours, mapFollowerSymbol, passesFilters, type SizingContext } from './copier-math';

const context: SizingContext = {
  masterLots: 1, masterBalance: 100000, masterEquity: 100000, followerBalance: 10000, followerEquity: 9000,
  masterContract: 100000, followerContract: 100000, limits: { volumeMin: 0.01, volumeMax: 50, volumeStep: 0.01 },
};
const follower = defaultFollower('f', 'acct');

test('every risk type sizes as documented', () => {
  assert.deepEqual(copyVolume({ ...follower, riskType: 'fixedLot', riskValue: 0.3 }, context), { lots: 0.3 });
  assert.deepEqual(copyVolume({ ...follower, riskType: 'lotMultiplier', riskValue: 150 }, context), { lots: 1.5 });
  assert.deepEqual(copyVolume({ ...follower, riskType: 'balanceMultiplier', riskValue: 100 }, context), { lots: 0.1 });
  assert.deepEqual(copyVolume({ ...follower, riskType: 'equityMultiplier', riskValue: 100 }, context), { lots: 0.09 });
  assert.deepEqual(copyVolume({ ...follower, riskType: 'fixedBalance', riskValue: 100, fixedMasterBalance: 50000 }, context), { lots: 0.2 });
  assert.deepEqual(copyVolume({ ...follower, riskType: 'fixedRisk', riskValue: 1 }, { ...context, stopDistance: 0.005, followerMoneyPerUnit: 100000 }), { lots: 0.2 });
  assert.match((copyVolume({ ...follower, riskType: 'fixedRisk', riskValue: 1 }, context) as { skip: string }).skip, /stop loss/);
});

test('100% of a fractional master volume does not drift', () => {
  assert.deepEqual(copyVolume(follower, { ...context, masterLots: 0.07 }), { lots: 0.07 });
});

test('contract alignment, refiner, lot filters and forced limits', () => {
  assert.deepEqual(copyVolume(follower, { ...context, followerContract: 10000 }), { lots: 10 });
  assert.deepEqual(copyVolume({ ...follower, lotRefiner: 0.05 }, { ...context, masterLots: 0.05 }), { lots: 0.1 });
  assert.ok('skip' in copyVolume({ ...follower, lotFilter: { min: 2, max: 0 } }, context));
  assert.ok('skip' in copyVolume({ ...follower, riskValue: 0.1 }, context));
  assert.deepEqual(copyVolume({ ...follower, riskValue: 0.1, isMinimumForced: true }, context), { lots: 0.01, note: 'raised to minimum 0.01' });
  assert.deepEqual(copyVolume({ ...follower, riskValue: 10000, isMaximumForced: true }, context), { lots: 50, note: 'capped at maximum 50' });
});

test('symbol mapping prefers explicit maps then exact names then suffix matches', () => {
  const names = ['EURUSD.pro', 'EURUSDm', 'GER40', 'US30.cash'];
  assert.equal(mapFollowerSymbol('DE40', { ...follower, symbolMap: { DE40: 'GER40' } }, names), 'GER40');
  assert.equal(mapFollowerSymbol('EURUSD', follower, names), 'EURUSDm');
  assert.equal(mapFollowerSymbol('US30', follower, names), 'US30.cash');
  assert.equal(mapFollowerSymbol('EURUSD', { ...follower, isSuffixAutoMapped: false }, names), null);
  assert.equal(mapFollowerSymbol('GBPUSD', follower, names), null);
});

test('filters by side, magic, comment and symbol', () => {
  const trade = { side: 'buy' as const, symbol: 'EURUSD.m', comment: 'robot 1', magic: 10 };
  assert.equal(passesFilters(follower, trade), null);
  assert.ok(passesFilters({ ...follower, side: 'sell' }, trade));
  assert.ok(passesFilters({ ...follower, magicFilter: { mode: 'ignore', values: [10] } }, trade));
  assert.equal(passesFilters({ ...follower, magicFilter: { mode: 'copy', values: [10, 20] } }, trade), null);
  assert.ok(passesFilters({ ...follower, commentFilter: { mode: 'copy', values: ['robot 2'] } }, trade));
  assert.equal(passesFilters({ ...follower, symbolFilter: { mode: 'copy', values: ['EURUSD'] } }, trade), null);
});

test('trading hours include overnight windows', () => {
  const monday = (hour: number) => new Date(2026, 9, 12, hour, 30);
  assert.equal(isWithinHours([], monday(3)), true);
  assert.equal(isWithinHours([{ day: 1, start: '05:00', end: '20:00' }], monday(4)), false);
  assert.equal(isWithinHours([{ day: 1, start: '05:00', end: '20:00' }], monday(5)), true);
  assert.equal(isWithinHours([{ day: 1, start: '22:00', end: '02:00' }], monday(23)), true);
});

test('stops copy by price or distance, refine, fall back to fixed pips and drop when reversed', () => {
  const input = { side: 'buy' as const, masterSide: 'buy' as const, masterOpen: 1.1, masterStop: 1.099, masterTarget: 1.102, followerEntry: 1.1003, digits: 5, point: 0.00001 };
  assert.deepEqual(copyStops(follower, input), { sl: 1.099, tp: 1.102 });
  assert.deepEqual(copyStops({ ...follower, stopMode: 'distance' }, input), { sl: 1.0993, tp: 1.1023 });
  assert.deepEqual(copyStops({ ...follower, stopRefinePips: 5 }, input), { sl: 1.0985, tp: 1.102 });
  assert.deepEqual(copyStops({ ...follower, isReversed: true }, { ...input, side: 'sell' }), { sl: 0, tp: 0 });
  assert.deepEqual(copyStops({ ...follower, isReversed: true, fixedStopPips: 20 }, { ...input, side: 'sell' }), { sl: 1.1023, tp: 0 });
});

test('auto-mapping follows prefixes as well as suffixes, in both directions', () => {
  assert.equal(mapFollowerSymbol('EURUSD', follower, ['mGBPUSD', 'mEURUSD']), 'mEURUSD');
  assert.equal(mapFollowerSymbol('EURUSD.m', follower, ['#EURUSD', '#XAUUSD']), '#EURUSD');
  assert.equal(mapFollowerSymbol('mXAUUSD', follower, ['XAUUSD', 'XAUUSD.pro']), 'XAUUSD');
  const filtered = { ...follower, symbolFilter: { mode: 'copy' as const, values: ['EURUSD'] } };
  assert.equal(passesFilters(filtered, { side: 'buy', symbol: 'mEURUSD', comment: '', magic: 0 }), null);
  assert.match(passesFilters(filtered, { side: 'buy', symbol: 'mGBPUSD', comment: '', magic: 0 }) ?? '', /filtered/);
});

test('explicit mappings cover decorated master names and follow the follower decoration', () => {
  const names = ['XAUUSD.pro', 'EURUSD.pro', 'GER40.pro'];
  const mapped = { ...follower, symbolMap: { DE40: 'GER40', GOLD: 'XAUUSD.pro' } };
  assert.equal(mapFollowerSymbol('DE40.m', mapped, names), 'GER40.pro');
  assert.equal(mapFollowerSymbol('mGOLD', mapped, names), 'XAUUSD.pro');
  assert.equal(mapFollowerSymbol('DE40.m', { ...mapped, isSuffixAutoMapped: false }, names), 'GER40');
  assert.equal(mapFollowerSymbol('GOLD.m', follower, names), 'XAUUSD.pro');
  assert.equal(mapFollowerSymbol('BRK.B', follower, ['BRK.A']), null);
});
