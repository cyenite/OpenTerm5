import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalApi } from '../../shared/protocol';

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value); },
  removeItem: (key: string) => { stored.delete(key); },
};
const fake = { platform: 'linux', on: () => () => undefined, request: () => Promise.resolve([]), link: async () => ({ url: '', state: 'idle' }) } as unknown as TerminalApi;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { terminal: fake, automation: fake, journaling: fake, localStorage: storage } });

// The modules read window and localStorage when they load, so they are imported after the fakes.
const loaded = Promise.all([import('./hub-charts'), import('./workspace'), import('./chart-tabs'), import('./symbol-drawings'), import('./session')]);

const drawing = (id: string, price = 1.1) => ({ id, type: 'horizontal-line', paneId: 'price', anchors: [{ time: 1_700_000_000_000, price }], style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' as const }, locked: false, visible: true, zIndex: 0, createdAt: 1 });

async function setup(drawingSync: 'off' | 'layout' | 'global') {
  const [charts, { workspace, makeChart }, { makeTab }, { symbolDrawings }, { session }] = await loaded;
  const first = { ...makeChart('EURUSD'), drawings: [drawing('own')] };
  const second = makeChart('GBPUSD', 'M5');
  const tab = { ...makeTab('tab', [first.id, second.id], '2h'), drawings: { EURUSD: [drawing('layout')] } };
  workspace.set({ charts: [first, second], tabs: [tab], activeTabId: 'tab', market: 'fx', drawingSync });
  symbolDrawings.set({ bySymbol: { EURUSD: [drawing('shared')] } });
  session.set({ symbols: { EURUSD: { name: 'EURUSD' } as never, USDJPY: { name: 'USDJPY' } as never } });
  return { charts, workspace, symbolDrawings, first, second };
}

test('a phone sees the visible charts of the market in use, with every drawing they show', async () => {
  const { charts, workspace, first, second } = await setup('off');
  assert.deepEqual(charts.hubCharts(workspace.get()).map((chart) => [chart.id, chart.symbol, chart.isActive]), [[first.id, 'EURUSD', true], [second.id, 'GBPUSD', false]]);
  assert.deepEqual(charts.hubChartDocument(first.id).drawings.map((item) => item.id), ['own', 'layout', 'shared']);
  workspace.set({ market: 'crypto' });
  assert.deepEqual(charts.hubCharts(workspace.get()), []);
});

test('edits replace drawings where they live, and new ones follow drawing sync', async () => {
  for (const [sync, owner] of [['off', 'chart'], ['layout', 'layout'], ['global', 'symbol']] as const) {
    const { charts, workspace, symbolDrawings, first } = await setup(sync);
    const document = charts.editHubDrawings({ chartId: first.id, upserts: [drawing('layout', 1.2), drawing('new')], removals: ['shared'] });
    const chart = workspace.get().charts.find((item) => item.id === first.id)!;
    const layout = workspace.get().tabs[0].drawings.EURUSD ?? [];
    const shared = symbolDrawings.get().bySymbol.EURUSD ?? [];
    assert.equal(layout.find((item) => item.id === 'layout')?.anchors[0].price, 1.2, sync);
    assert.equal(shared.some((item) => item.id === 'shared'), false, sync);
    assert.equal(chart.drawings.some((item) => item.id === 'new'), owner === 'chart', sync);
    assert.equal(layout.some((item) => item.id === 'new'), owner === 'layout', sync);
    assert.equal(shared.some((item) => item.id === 'new'), owner === 'symbol', sync);
    assert.deepEqual(document.drawings.map((item) => item.id).sort(), ['layout', 'new', 'own']);
  }
});

test('unreadable drawings and unknown symbols or timeframes are refused', async () => {
  const { charts, first } = await setup('off');
  assert.throws(() => charts.editHubDrawings({ chartId: first.id, upserts: [{ id: 'x', type: 'trend-line' }], removals: [] }), /could not be read/);
  assert.throws(() => charts.editHubDrawings({ chartId: 'gone', upserts: [], removals: [] }), /closed/);
  assert.throws(() => charts.setHubChartMarket(first.id, 'NOPE', undefined), /not offered/);
  assert.throws(() => charts.setHubChartMarket(first.id, undefined, 'H7'), /not a chart timeframe/);
  assert.equal(charts.setHubChartMarket(first.id, 'USDJPY', 'H4').symbol, 'USDJPY');
});
