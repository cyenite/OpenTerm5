import assert from 'node:assert/strict';
import test from 'node:test';
import { displaySymbol, parseChartPage, parseLayoutList, TradingViewClient, unescapeHtml } from './tradingview-client';

const signedInPage = `<html><head><link rel="chart-storage" href="https://charts-storage.tradingview.com/charts-storage" crossorigin="use-credentials">
<link rel="chart-storage-notifications" href="https://example.invalid/notify"></head><body><script>
	var is_authenticated = true;
		var user = {"id":4242,"username":"trader","following":"0"};
</script></body></html>`;

const guestPage = `<script>var is_authenticated = false;
		var user = {"username":"Guest","following":"0"};
</script>`;

const trend = (id: string, owner = 'ibCWf0') => ({ type: 'LineToolTrendLine', id, state: { linecolor: '#2962FF' }, points: [{ time_t: 1, offset: 0, price: 1 }, { time_t: 2, offset: 0, price: 2 }], zorder: 1, ownerSource: owner });

const layoutContent = {
  charts: [{
    chartId: '1',
    panes: [
      { sources: [{ type: 'MainSeries', id: 'ibCWf0', state: { symbol: 'OANDA:XAUUSD' } }, trend('legacy'), trend('on-rsi', 'rsi1')] },
    ],
  }],
};

function fakeTradingView(): { fetcher: (url: string, init?: RequestInit) => Promise<Response>; requests: string[] } {
  const requests: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push(url);
    const { pathname, searchParams } = new URL(url);
    const isXhr = (init?.headers as Record<string, string> | undefined)?.['X-Requested-With'] === 'XMLHttpRequest';
    if (pathname === '/chart/') return new Response(signedInPage, { status: 200 });
    // Like TradingView: without the XHR header the layout list redirects to the home page.
    if (pathname === '/my-charts/' && !isXhr) return new Response(null, { status: 302, headers: { Location: '/' } });
    if (pathname.startsWith('/charts-storage/') && isXhr) return new Response('{}', { status: 400 });
    if (pathname.startsWith('/charts-storage/') && !searchParams.get('jwt')?.startsWith('jwt-')) return new Response(JSON.stringify({ errorMsg: 'JWT validation failed' }), { status: 403 });
    if (pathname === '/my-charts/') return json([{ id: 7, url: 'https://www.tradingview.com/chart/AbCd1234/', name: 'Gold plan' }]);
    if (pathname === '/chart/AbCd1234/json/') return json({ uid: 'AbCd1234', name: 'Gold plan', content: JSON.stringify(layoutContent) });
    if (pathname === '/chart-token/') return json({ token: `jwt-${searchParams.get('image_url')}-${searchParams.get('user_id')}` });
    if (pathname === '/charts-storage/layout/AbCd1234/sizes') return json({ success: true, payload: { charts: { 1: { symbols: { 'OANDA:XAUUSD': { countSources: 2, ids: ['legacy', 'stored'] } } }, _shared: { symbols: { 'BINANCE:BTCUSDT': { countSources: 1, ids: ['shared'] } } } } } });
    if (pathname === '/charts-storage/user/sizes') return json({ success: true, payload: { charts: { UserSync: { symbols: { '={"symbol":"FX:EURUSD"}': { countSources: 1, ids: ['synced'] } } } } } });
    if (pathname === '/charts-storage/get/layout/AbCd1234/sources' && searchParams.get('chart_id') === '_shared') return json({ success: true, payload: searchParams.has('includeOwnerSource') ? {} : { sources: { shared: { id: 'shared', state: trend('shared') } } } });
    if (pathname === '/charts-storage/get/layout/AbCd1234/sources') return json({ success: true, payload: searchParams.get('includeOwnerSource') === 'ibCWf0' ? { sources: { stored: { id: 'stored', state: trend('stored') } } } : {} });
    if (pathname === '/charts-storage/get/user/sources') return json({ success: true, payload: { sources: { synced: { id: 'synced', state: trend('synced') } } } });
    if (pathname === '/themes/') return json([{ name: 'Night' }, 'Paper']);
    if (pathname === '/theme/') return json({ content: JSON.stringify({ chartProperties: { paneProperties: { background: '#000000' } } }) });
    return new Response('missing', { status: 404 });
  };
  return { fetcher, requests };
}

test('the chart page says who is signed in and where drawings are stored', () => {
  assert.deepEqual(parseChartPage(signedInPage), { storageUrl: 'https://charts-storage.tradingview.com/charts-storage/', account: { id: 4242, username: 'trader' } });
  assert.equal(parseChartPage(guestPage).account, null);
});

test('layout lists accept addresses or bare ids and drop duplicates', () => {
  assert.deepEqual(parseLayoutList({ results: [{ url: '/chart/Xy12/', name: 'A' }, { url: 'Xy12' }, { short_url: 'Zz9' }, { name: 'no id' }] }), [{ url: 'Xy12', name: 'A' }, { url: 'Zz9', name: 'Zz9' }]);
});

test('storage symbols with settings show their plain symbol', () => {
  assert.equal(displaySymbol('={"symbol":"FX:EURUSD","adjustment":"splits"}'), 'FX:EURUSD');
  assert.equal(displaySymbol('FX:EURUSD'), 'FX:EURUSD');
});

test('symbols gather layout, chart and synced drawings without counting one drawing twice', async () => {
  const { fetcher } = fakeTradingView();
  const { symbols, skippedLayouts } = await new TradingViewClient(fetcher).symbols();
  assert.deepEqual(skippedLayouts, []);
  assert.deepEqual(symbols.find((symbol) => symbol.symbol === 'OANDA:XAUUSD')?.ids, ['legacy', 'stored']);
  assert.deepEqual(symbols.map((symbol) => [symbol.symbol, symbol.count, symbol.sources.map((source) => source.scope)]), [
    ['BINANCE:BTCUSDT', 1, ['chart']],
    ['FX:EURUSD', 1, ['synced']],
    ['OANDA:XAUUSD', 2, ['layout', 'chart']],
  ]);
});

test('drawings for a symbol come from each of its sources, once each', async () => {
  const { fetcher, requests } = fakeTradingView();
  const client = new TradingViewClient(fetcher);
  const { symbols } = await client.symbols();
  const { sets } = await client.drawings(symbols);
  assert.deepEqual(sets.map((set) => [set.symbol, set.tools.map((tool) => `${tool.id}${tool.isOnPrice ? '' : ' (indicator)'}`)]), [
    ['BINANCE:BTCUSDT', ['shared']],
    ['FX:EURUSD', ['synced']],
    ['OANDA:XAUUSD', ['legacy', 'on-rsi (indicator)', 'stored']],
  ]);
  const queries = requests.filter((url) => url.includes('/get/layout/')).map((url) => Object.fromEntries(new URL(url).searchParams));
  assert.deepEqual(queries, [
    { symbol: 'BINANCE:BTCUSDT', chart_id: '_shared', brokerName: '', layout_id: 'AbCd1234', jwt: 'jwt-AbCd1234-4242' },
    { symbol: 'OANDA:XAUUSD', chart_id: '1', includeOwnerSource: 'ibCWf0', brokerName: '', layout_id: 'AbCd1234', jwt: 'jwt-AbCd1234-4242' },
  ]);
  assert.equal(requests.filter((url) => url.includes('/chart-token/')).length, 1);
});

test('themes list by name and load their colours', async () => {
  const client = new TradingViewClient(fakeTradingView().fetcher);
  assert.deepEqual(await client.themes(), ['Night', 'Paper']);
  assert.deepEqual(await client.theme('Night'), { chartProperties: { paneProperties: { background: '#000000' } } });
});

test('a signed-out session is asked to sign in, and refusals say so', async () => {
  const guest = new TradingViewClient(async () => new Response(guestPage, { status: 200 }));
  await assert.rejects(guest.symbols(), /Sign in to TradingView first/);
  const refused = new TradingViewClient(async (url) => (url.endsWith('/chart/') ? new Response(signedInPage) : new Response('', { status: 403 })));
  await assert.rejects(refused.themes(), /Sign in to TradingView again/);
});

test('a refused layout is skipped with TradingView\'s reason, and redirects ask for a new sign-in', async () => {
  const badToken = new TradingViewClient(async (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/chart/') return new Response(signedInPage);
    if (pathname === '/my-charts/') return new Response(JSON.stringify([{ url: 'AbCd1234', name: 'Gold plan' }]));
    if (pathname === '/chart/AbCd1234/json/') return new Response(JSON.stringify({ uid: 'AbCd1234', content: 'null' }));
    if (pathname === '/chart-token/') return new Response(JSON.stringify({ token: 'expired' }));
    return new Response(JSON.stringify({ errorMsg: 'JWT validation failed' }), { status: 403 });
  });
  assert.deepEqual((await badToken.symbols()).skippedLayouts, [{ layoutName: 'Gold plan', reason: 'JWT validation failed' }]);
  const redirected = new TradingViewClient(async (url) => (url.endsWith('/chart/') ? new Response(signedInPage) : new Response(null, { status: 302, headers: { Location: '/' } })));
  await assert.rejects(redirected.symbols(), /sent a page instead of your chart layouts/);
});

test('a layout above the plan\'s limit is skipped and the others still import', async () => {
  const { fetcher } = fakeTradingView();
  const locked = async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname === '/my-charts/') return new Response(JSON.stringify([{ url: 'Locked99', name: 'Mechanical layout' }, { url: 'AbCd1234', name: 'Gold plan' }]));
    if (pathname === '/chart/Locked99/json/') return new Response(JSON.stringify({ detail: 'layout is not available in the current plan' }), { status: 403 });
    return fetcher(url, init);
  };
  const client = new TradingViewClient(locked);
  const scan = await client.symbols();
  assert.deepEqual(scan.skippedLayouts, [{ layoutName: 'Mechanical layout', reason: 'layout is not available in the current plan' }]);
  assert.deepEqual(scan.symbols.map((symbol) => symbol.symbol), ['BINANCE:BTCUSDT', 'FX:EURUSD', 'OANDA:XAUUSD']);
  const { sets } = await client.drawings(scan.symbols);
  assert.equal(sets.flatMap((set) => set.tools).length, 5);
});

test('drawing templates are fetched by their escaped names and shown unescaped', async () => {
  const requested: string[] = [];
  const client = new TradingViewClient(async (url) => {
    const { pathname, searchParams } = new URL(url);
    requested.push(`${pathname}${searchParams.get('templateName') ? `?${searchParams.get('templateName')}` : ''}`);
    if (pathname === '/chart/') return new Response(signedInPage);
    if (pathname === '/drawing-templates/LineToolHorzLine/') return new Response(JSON.stringify(['S&amp;R']));
    if (pathname === '/drawing-templates/LineToolTrendLine/') return new Response(JSON.stringify(['BOS', 'Empty']));
    if (pathname === '/drawing-template/LineToolHorzLine/' && searchParams.get('templateName') === 'S&amp;R') return new Response(JSON.stringify({ content: JSON.stringify({ linecolor: '#F23645' }) }));
    if (pathname === '/drawing-template/LineToolTrendLine/' && searchParams.get('templateName') === 'BOS') return new Response(JSON.stringify({ content: JSON.stringify({ text: 'BOS' }) }));
    if (pathname === '/drawing-template/LineToolTrendLine/') return new Response(JSON.stringify({ content: '' }));
    return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
  });
  const templates = await client.drawingTemplates(['LineToolTrendLine', 'LineToolHorzLine', 'LineToolRay']);
  assert.deepEqual(templates, [
    { type: 'LineToolHorzLine', name: 'S&R', content: { linecolor: '#F23645' } },
    { type: 'LineToolTrendLine', name: 'BOS', content: { text: 'BOS' } },
  ]);
  assert.ok(requested.includes('/drawing-template/LineToolHorzLine/?S&amp;R'));
  assert.equal(unescapeHtml('A &lt;B&gt; &quot;C&quot; &#39;D&#39;'), 'A <B> "C" \'D\'');
});

test('chart settings come from every chart of every layout, and a refused layout is skipped', async () => {
  const chartProperties = { paneProperties: { background: '#131722', topMargin: 10 }, scalesProperties: { fontSize: 12 } };
  const settingsLayout = {
    charts: [
      { chartId: '1', chartProperties, timeScale: { m_rightOffset: 10 }, panes: [{ sources: [{ type: 'MainSeries', id: 'ibCWf0', state: { symbol: 'OANDA:XAUUSD', interval: '15', style: 1 } }, trend('legacy')] }] },
      { chartId: '2', chartProperties, panes: [{ sources: [{ type: 'MainSeries', id: 'k9', state: { symbol: 'FX:EURUSD', interval: '60', style: 9 } }] }] },
    ],
  };
  const { fetcher } = fakeTradingView();
  const client = new TradingViewClient(async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/my-charts/') return new Response(JSON.stringify([{ url: 'Locked99', name: 'Mechanical layout' }, { url: 'AbCd1234', name: 'Gold plan' }]));
    if (pathname === '/chart/Locked99/json/') return new Response(JSON.stringify({ detail: 'layout is not available in the current plan' }), { status: 403 });
    if (pathname === '/chart/AbCd1234/json/') return new Response(JSON.stringify({ uid: 'AbCd1234', name: 'Gold plan', content: JSON.stringify(settingsLayout) }));
    return fetcher(url, init);
  });
  const { charts, skippedLayouts } = await client.chartSettings();
  assert.deepEqual(skippedLayouts, [{ layoutName: 'Mechanical layout', reason: 'layout is not available in the current plan' }]);
  assert.deepEqual(charts.map((chart) => [chart.layoutName, chart.layoutUrl, chart.chartId, chart.symbol, chart.interval]), [
    ['Gold plan', 'AbCd1234', '1', 'OANDA:XAUUSD', '15'],
    ['Gold plan', 'AbCd1234', '2', 'FX:EURUSD', '60'],
  ]);
  assert.deepEqual(charts[0].content, {
    chartProperties,
    timeScale: { m_rightOffset: 10 },
    panes: [{ sources: [{ type: 'MainSeries', id: 'ibCWf0', state: { symbol: 'OANDA:XAUUSD', interval: '15', style: 1 } }] }],
  });
});

test('chart settings ask a signed-out session to sign in', async () => {
  const guest = new TradingViewClient(async () => new Response(guestPage, { status: 200 }));
  await assert.rejects(guest.chartSettings(), /Sign in to TradingView first/);
});
