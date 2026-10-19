import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MeridianChart } from '@meridian/charts';
import type { Bar, SymbolSpec, TerminalApi } from '../../../shared/protocol';

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 0, 5, 10, 0);

// One flat EURUSD minute bar after another, with a dip to 1.0980 in minute 30.
const bars: Bar[] = Array.from({ length: 200 }, (_, minute) => ({ time: (T0 + minute * MINUTE) / 1000, open: 1.1, high: 1.1002, low: minute === 30 ? 1.098 : 1.0998, close: 1.1, volume: 1 }));

const requests: string[] = [];
const terminal = {
  platform: 'linux',
  on: () => () => undefined,
  request: async (method: string) => {
    requests.push(method);
    if (method === 'rates.get') return bars;
    if (method === 'symbols.valuation') return { via: [], rate: 1, calcMode: 0, moneyPerUnit: 100_000, profitCurrency: 'USD', accountCurrency: 'USD' };
    return [];
  },
} as unknown as TerminalApi;
Object.defineProperty(globalThis, 'window', { configurable: true, value: { terminal } });

// The runtime reaches the session, which reads window.terminal when it loads.
const modules = Promise.all([import('./runtime'), import('../replay'), import('../session'), import('../workspace'), import('../chart-tabs'), import('../chart-instances')]);

const spec = { name: 'EURUSD', currencyBase: 'EUR', currencyProfit: 'USD', currencyMargin: 'EUR', point: 0.00001, digits: 5, spread: 10, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01, contractSize: 100_000 } as SymbolSpec;

function fakeEngine(): MeridianChart {
  const off = () => () => undefined;
  let isSelecting = false;
  return {
    canUndo: () => false, canRedo: () => false, isReplaying: () => false, isObjectTreeShown: () => false,
    onHistoryChange: off, onReplayChange: off, onObjectTreeChange: off,
    loadHistoryTo: async () => T0,
    selectReplayStart: () => { isSelecting = true; },
    cancelReplaySelection: () => { isSelecting = false; },
    isReplaySelecting: () => isSelecting,
    setReplay: () => { isSelecting = false; },
    earliestReplayTime: () => T0 + MINUTE,
    nextReplayTime: (after: number) => (after < T0 + 199 * MINUTE ? after + MINUTE : null),
  } as unknown as MeridianChart;
}

test('a backtest follows the replay clock, fills on the bars it passes, and only moves forward', async () => {
  const [runtime, replayModule, sessionModule, { makeChart, workspace }, { makeTab }, { registerChart }] = await modules;
  sessionModule.session.set({ account: { currency: 'USD', login: 1, server: 'Demo' } as never, symbols: { EURUSD: spec } });
  const chart = makeChart('EURUSD', 'M1');
  workspace.set({ charts: [chart], tabs: [makeTab('tab', [chart.id], 's')], activeTabId: 'tab', replayMode: 'allCharts' });
  const unregister = registerChart(chart.id, fakeEngine());

  await runtime.createBacktest({ name: 'Test', symbol: 'EURUSD', account: '1 on Demo', currency: 'USD', timeframe: 'M1', startTime: T0 + 10 * MINUTE, endTime: null, settings: { balance: 10_000, leverage: 100, stopOutLevel: 50, slippagePoints: 0, commissionPerLot: 0, spreadPoints: null } });
  await runtime.backtestSettled();
  const active = () => runtime.activeBacktest(runtime.backtest.get())!;
  assert.equal(replayModule.replay.get().session?.time, T0 + 10 * MINUTE);
  assert.equal(active().book.time, T0 + 10 * MINUTE);
  assert.equal(active().terms.EURUSD.spreadPoints, 10, "the broker's spread, captured once");
  assert.equal(runtime.backtest.get().bids.EURUSD, 1.1);

  assert.equal(await runtime.backtestPending({ type: 'buyLimit', symbol: 'EURUSD', volume: 0.1, price: 1.099, sl: 1.097 }), null);
  for (let step = 0; step < 25; step++) replayModule.stepReplay();
  await runtime.backtestSettled();
  assert.equal(active().book.time, T0 + 35 * MINUTE);
  assert.equal(active().book.positions[0]?.priceOpen, 1.099, 'the dip in minute 30 took the ask to the limit');
  assert.equal(active().book.positions[0].time, T0 + 30 * MINUTE);

  replayModule.pickReplayStart(T0 + 20 * MINUTE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(replayModule.replay.get().session?.time, T0 + 35 * MINUTE, 'the replay is put back where the backtest stands');
  assert.match(runtime.backtest.get().notice ?? '', /only moves forward/);

  runtime.endBacktest();
  assert.equal(replayModule.replay.get().session, null);
  assert.equal(runtime.backtest.get().activeId, null);
  assert.equal(runtime.backtest.get().sessions[0].book.positions.length, 1, 'ending keeps the open position for a resume');

  await runtime.resumeBacktest(runtime.backtest.get().sessions[0].id);
  await runtime.backtestSettled();
  assert.equal(replayModule.replay.get().session?.time, T0 + 35 * MINUTE, 'a resume continues where the session stopped');
  assert.equal(runtime.closeBacktestPosition(active().book.positions[0].ticket), null);
  assert.equal(active().book.trades.length, 1);
  runtime.endBacktest();
  unregister();
});

test('a backtest runs its own clock, and risk orders trade it as the live trade manager would', async () => {
  const [runtime, replayModule, sessionModule, { makeChart, workspace }, { makeTab }, { registerChart }] = await modules;
  sessionModule.session.set({ account: { currency: 'USD', login: 1, server: 'Demo' } as never, symbols: { EURUSD: spec } });
  const chart = makeChart('EURUSD', 'M1');
  workspace.set({ charts: [chart], tabs: [makeTab('tab', [chart.id], 's')], activeTabId: 'tab', replayMode: 'activeChart', isBacktestPanelShown: false, isAnalysisMode: false, isMarketWatchShown: true });
  const unregister = registerChart(chart.id, fakeEngine());

  await runtime.createBacktest({ name: 'Risk', symbol: 'EURUSD', account: '1 on Demo', currency: 'USD', timeframe: 'M1', startTime: T0 + 10 * MINUTE, endTime: null, settings: { balance: 10_000, leverage: 100, stopOutLevel: 50, slippagePoints: 0, commissionPerLot: 0, spreadPoints: null } });
  await runtime.backtestSettled();
  assert.equal(replayModule.replay.get().session?.purpose, 'backtest', 'not bar replay');
  assert.equal(workspace.get().isBacktestPanelShown, true, 'starting opens the Backtest panel');
  assert.deepEqual([workspace.get().isBacktestMode, workspace.get().isAnalysisMode, workspace.get().isMarketWatchShown], [true, true, false], 'Backtest mode: analysis layout without the watchlist');
  assert.equal(runtime.modeOf(workspace.get()), 'backtest');
  replayModule.startReplay();
  assert.equal(replayModule.replay.get().session?.purpose, 'backtest', 'bar replay waits until the backtest ends');

  const outcome = await runtime.backtestRiskOrder({ type: 'buy', mode: 'percentBalance', value: 1, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 10 }, takeProfitR: [1, 2], management: { isBreakEvenAfterFirstTarget: true } });
  assert.deepEqual(outcome.results.map((result) => result.isSuccess), [true, true], 'one order per target');
  const positions = runtime.activeBacktest(runtime.backtest.get())!.book.positions;
  assert.deepEqual(positions.map((position) => [position.volume, position.sl, position.tp]), [[0.5, 1.0991, 1.1011], [0.5, 1.0991, 1.1021]]);
  assert.equal(positions[0].rule, null);
  assert.deepEqual(positions[1].rule?.breakEven, { triggerPoints: 100, lockPoints: 1 }, 'the second part moves to break-even at the first target');

  const view = runtime.backtestView(runtime.backtest.get())!;
  assert.deepEqual(view.positions.map((position) => position.ticket), positions.map((position) => position.ticket));
  assert.equal(view.account.balance, 10_000);
  assert.deepEqual(view.quotes.EURUSD, { bid: 1.1, ask: 1.1001 });
  const modified = await runtime.backtestTrade({ action: 'sltp', position: positions[0].ticket, symbol: 'EURUSD', sl: 1.0995, tp: 1.1011 });
  assert.equal(modified.isSuccess, true);
  const closed = await runtime.backtestBulk({ kind: 'closeAll' });
  assert.equal(closed.length, 2);
  workspace.set({ tool: 'riskOrder' });
  runtime.endBacktest();
  assert.deepEqual([workspace.get().isBacktestMode, workspace.get().isAnalysisMode, workspace.get().isMarketWatchShown, workspace.get().isBacktestPanelShown, workspace.get().tool], [false, false, true, false, 'cursor'], 'ending leaves Backtest mode, puts the settings back and drops the order tool');
  unregister();
});

test('Backtest mode switches the interface before any session, and another mode switches it back', async () => {
  const [runtime, , , { workspace }] = await modules;
  workspace.set({ isAnalysisMode: false, isMarketWatchShown: true, isBacktestPanelShown: false, isBacktestMode: false, page: 'copier' });
  runtime.chooseMode('backtest');
  assert.deepEqual([workspace.get().isBacktestMode, workspace.get().isAnalysisMode, workspace.get().isMarketWatchShown, workspace.get().isBacktestPanelShown, workspace.get().page], [true, true, false, true, 'trading']);
  assert.equal(runtime.backtest.get().activeId, null, 'no session yet');
  runtime.chooseMode('analysis');
  assert.deepEqual([runtime.modeOf(workspace.get()), workspace.get().isMarketWatchShown, workspace.get().isBacktestPanelShown], ['analysis', true, false], 'the watchlist and panel come back, then Analysis mode applies');
  runtime.chooseMode('trade');
  assert.equal(runtime.modeOf(workspace.get()), 'trade');
});
