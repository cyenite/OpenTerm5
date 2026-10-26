import assert from 'node:assert/strict';
import test from 'node:test';
import { displaySymbol } from '../shared/tradingview';
import { EventStreamParser, savedRecord, parseChartPage, parseLayoutList, parseScriptList, parseScriptPage, parseScriptSource, scriptListPages, scriptPageUrl, TradingViewClient, unescapeHtml } from './tradingview-client';

const signedInPage = `<html><head><link rel="chart-storage" href="https://charts-storage.tradingview.com/charts-storage" crossorigin="use-credentials">
<link rel="preconnect chart-storage-notifications" href="https://notifications.example.invalid/charts-storage/layout/DK4Z/subscribe"></head><body><script>
	window.BUILD_TIME = "2026-10-23T09:00:11";
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
    if (pathname === '/charts-storage/get/layout/AbCd1234/sources' && searchParams.get('chart_id') === '_shared') return json({ success: true, payload: searchParams.has('includeOwnerSource') ? {} : { sources: { shared: { id: 'shared', symbol: 'BINANCE:BTCUSDT', serverUpdateTime: 1_760_000_000_000, state: trend('shared') } } } });
    if (pathname === '/charts-storage/get/layout/AbCd1234/sources') return json({ success: true, payload: searchParams.get('includeOwnerSource') === 'ibCWf0' ? { sources: { stored: { id: 'stored', state: trend('stored') } } } : {} });
    if (pathname === '/charts-storage/get/user/sources') return json({ success: true, payload: { sources: { synced: { id: 'synced', state: trend('synced') } } } });
    if (pathname === '/themes/') return json([{ name: 'Night' }, 'Paper']);
    if (pathname === '/theme/') return json({ content: JSON.stringify({ chartProperties: { paneProperties: { background: '#000000' } } }) });
    return new Response('missing', { status: 404 });
  };
  return { fetcher, requests };
}

test('the chart page says who is signed in and where drawings are stored', () => {
  assert.deepEqual(parseChartPage(signedInPage), {
    storageUrl: 'https://charts-storage.tradingview.com/charts-storage/',
    notificationsUrl: 'https://notifications.example.invalid/charts-storage/layout/DK4Z/subscribe',
    buildTime: '2026-10-23T09:00:11',
    account: { id: 4242, username: 'trader' },
  });
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

// Shaped like the 2026-10-16 script page: the published script sits in the idea record of one of
// several init-data blocks.
const scriptPage = (access: number) => `<html><body>
<script type="application/prs.init-data+json">{"aB1":{"data":{"context":{"user":{"is_authenticated":false}}}}}</script>
<script type="application/prs.init-data+json">{"D852iY":{"ssrIdeaData":{"name":"CKD - Conformal Kernel Direction","user":{"username":"builtbyuba"},
"script":{"id":7223040,"content":"","access":${access},"script_id_part":"PUB;8d48bf62d4dd4d4a83480b6ce9159801","version_maj":3,"script_type":"study"}}}}</script>
</body></html>`;

test('script links from any TradingView site lead to the script page on www', () => {
  assert.equal(scriptPageUrl('https://in.tradingview.com/script/6SgfnZ2H-CKD-Conformal-Kernel-Direction'), 'https://www.tradingview.com/script/6SgfnZ2H-CKD-Conformal-Kernel-Direction/');
  assert.equal(scriptPageUrl(' https://www.tradingview.com/script/R85TX24V/ '), 'https://www.tradingview.com/script/R85TX24V/');
  assert.throws(() => scriptPageUrl('https://www.tradingview.com/chart/AbCd1234/'), /script page/);
  assert.throws(() => scriptPageUrl('https://tradingview.example.com/script/AbCd1234/'), /script page/);
  assert.throws(() => scriptPageUrl('not a link'), /script page/);
});

test('a script page names its published script, and protected scripts are refused', () => {
  const url = 'https://www.tradingview.com/script/6SgfnZ2H-CKD/';
  assert.deepEqual(parseScriptPage(scriptPage(1), url), { version: 3, url, name: 'CKD - Conformal Kernel Direction', author: 'builtbyuba', scriptId: 'PUB;8d48bf62d4dd4d4a83480b6ce9159801' });
  assert.throws(() => parseScriptPage(scriptPage(2), url), /protected or invite-only/);
  assert.throws(() => parseScriptPage('<html></html>', url), /without a published script/);
});

test("the Pine service's answer gives the source or TradingView's reason", () => {
  assert.equal(parseScriptSource({ source: '//@version=6\nindicator("x")', scriptAccess: 'open_no_auth' }), '//@version=6\nindicator("x")');
  assert.throws(() => parseScriptSource({ success: false, reason: 'Script not found' }), /Script not found/);
  assert.throws(() => parseScriptSource({ scriptAccess: 'protected' }), /open-source scripts/);
});

test('a script is read from its page and then from the Pine service, without signing in', async () => {
  const requests: string[] = [];
  const client = new TradingViewClient(async (url) => {
    requests.push(url);
    if (url.startsWith('https://www.tradingview.com/script/')) return new Response(scriptPage(1), { status: 200 });
    return new Response(JSON.stringify({ source: '//@version=6\nindicator("CKD")', version: '3.0' }), { status: 200 });
  });
  const script = await client.script('https://www.tradingview.com/script/6SgfnZ2H-CKD/');
  assert.equal(script.source, '//@version=6\nindicator("CKD")');
  assert.deepEqual(requests, ['https://www.tradingview.com/script/6SgfnZ2H-CKD/', 'https://pine-facade.tradingview.com/pine-facade/get/PUB%3B8d48bf62d4dd4d4a83480b6ce9159801/3?no_4xx=true']);
});

// Shaped like the 2026-10-16 listing: items under `<key>.data.data.ideas.data`.
const listItem = (id: string, extra: Record<string, unknown> = {}) => ({ name: `Script ${id}`, chart_url: `https://www.tradingview.com/script/${id}-Name/`, script_type: 'indicator', script_access: 1, script_id_part: `PUB;${id.padEnd(32, '0')}`, version: '2', likes_count: 685, user: { username: 'author' }, ...extra });
const listPage = (items: unknown[], next: string | null) => `<script type="application/prs.init-data+json">${JSON.stringify({ k9: { data: { context: {}, data: { ideas: { data: { items, total: 1000, next }, params: {} } } } } })}</script>`;

test('a popular list page gives open-source indicators with their rank, and skips the rest', () => {
  const page = parseScriptList(listPage([listItem('aa'), listItem('bb', { script_type: 'strategy' }), listItem('cc', { script_access: 2 }), listItem('dd', { version: 'x' }), listItem('ee')], '/scripts/page-3/'), 48);
  assert.deepEqual(page.scripts.map((script) => [script.rank, script.scriptId.slice(0, 6), script.version, script.likes, script.author]), [[49, 'PUB;aa', 2, 685, 'author'], [53, 'PUB;ee', 2, 685, 'author']]);
  assert.equal(page.total, 1000);
  assert.equal(page.hasMore, true);
  assert.equal(parseScriptList(listPage([], null), 0).hasMore, false);
  assert.throws(() => parseScriptList('<html></html>', 0), /without its list/);
});

test('list pages keep the indicator filter, and sources come from the Pine service', async () => {
  const requests: string[] = [];
  const client = new TradingViewClient(async (url) => {
    requests.push(url);
    return url.includes('pine-facade') ? new Response(JSON.stringify({ source: '//@version=6' })) : new Response(listPage([listItem('aa')], null));
  });
  await client.scriptList(1);
  await client.scriptList(2);
  assert.equal(await client.scriptSource('PUB;aa000000000000000000000000000000', 2), '//@version=6');
  assert.deepEqual(requests, [
    'https://www.tradingview.com/scripts/?script_type=indicators',
    'https://www.tradingview.com/scripts/page-2/?script_type=indicators',
    'https://pine-facade.tradingview.com/pine-facade/get/PUB%3Baa000000000000000000000000000000/2?no_4xx=true',
  ]);
  await assert.rejects(client.scriptList(scriptListPages + 1), /pages 1 to 42/);
  await assert.rejects(client.scriptSource('USER;abc', 1), /not a published/);
});

test('each tool keeps where it was read from and when TradingView last saved it', async () => {
  const { fetcher } = fakeTradingView();
  const client = new TradingViewClient(fetcher);
  const { sets } = await client.drawings((await client.symbols()).symbols);
  const origins = Object.fromEntries(sets.flatMap((set) => set.tools).map((tool) => [tool.id, tool.origin && [tool.origin.source.scope, tool.origin.source.chartId, tool.origin.source.storageSymbol, tool.origin.serverUpdateTime]]));
  assert.deepEqual(origins, {
    shared: ['chart', '_shared', 'BINANCE:BTCUSDT', 1_760_000_000_000],
    synced: ['synced', undefined, '={"symbol":"FX:EURUSD"}', undefined],
    legacy: undefined,
    'on-rsi': undefined,
    stored: ['chart', '1', 'OANDA:XAUUSD', undefined],
  });
});

test('a save sends only the named tools to their target, with the build time, and answers in ms', async () => {
  const saves: { url: URL; init?: RequestInit }[] = [];
  const { fetcher } = fakeTradingView();
  const client = new TradingViewClient(async (url, init) => {
    if (init?.method === 'PUT') {
      saves.push({ url: new URL(url), init });
      return new Response(JSON.stringify({ success: true, payload: { serverUpdateTime: 1_761_000_000.5 } }));
    }
    return fetcher(url, init);
  });
  const source = { scope: 'chart' as const, layoutId: 'AbCd1234', layoutUrl: 'AbCd1234', layoutName: 'Gold plan', chartId: '_shared', storageSymbol: 'OANDA:XAUUSD' };
  assert.deepEqual(await client.push({ source, records: { a: { id: 'a', state: {} }, b: null } }, 'openterm1'), { serverUpdateTime: 1_761_000_000_500 });
  await client.push({ source: { ...source, scope: 'synced', chartId: undefined }, records: { c: null } }, 'openterm1');
  assert.deepEqual(saves.map(({ url }) => [url.pathname, Object.fromEntries(url.searchParams)]), [
    ['/charts-storage/layout/AbCd1234/sources', { chart_id: '_shared', layout_id: 'AbCd1234', jwt: 'jwt-AbCd1234-4242' }],
    ['/charts-storage/user/sources', { layout_id: 'AbCd1234', jwt: 'jwt-AbCd1234-4242' }],
  ]);
  assert.deepEqual(JSON.parse(String(saves[0].init?.body)), { sources: { a: { id: 'a', state: {}, symbol: null, currencyId: null, unitId: null }, b: null }, drawing_groups: {}, clientId: 'AbCd1234/_shared/openterm1' });
  assert.equal(saves[0].init?.credentials, 'include');
  assert.deepEqual(saves[0].init?.headers, { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', 'X-BUILD-TIME': '2026-10-23T09:00:11' });
  await assert.rejects(client.push({ source: { ...source, scope: 'layout' }, records: {} }, 'openterm1'), /cannot be written back/);
});

test('a token TradingView stopped accepting is fetched again, once', async () => {
  let tokens = 0;
  const { fetcher } = fakeTradingView();
  const client = new TradingViewClient(async (url, init) => {
    if (new URL(url).pathname === '/chart-token/') return new Response(JSON.stringify({ token: tokens++ === 0 ? 'stale' : 'jwt-fresh' }));
    return fetcher(url, init);
  });
  const { symbols } = await client.symbols();
  assert.equal(tokens, 2);
  assert.equal(symbols.length, 3);
});

test('change-stream messages become changes per target, without this client\'s own saves', async () => {
  const client = new TradingViewClient(fakeTradingView().fetcher);
  await client.watchLayouts([{ layoutId: 'AbCd1234', layoutUrl: 'AbCd1234', layoutName: 'Gold plan' }]);
  const message = {
    _shared: { clientId: 'AbCd1234/1/browser9', sources: { moved: { id: 'moved', symbol: 'OANDA:XAUUSD', serverUpdateTime: 5, state: trend('moved') }, gone: null } },
    1: { clientId: 'AbCd1234/1/openterm1', sources: { echo: { id: 'echo', state: trend('echo') } } },
    UserSync: { clientId: 'AbCd1234/1/browser9', symbol: 'FX:EURUSD', sources: null },
  };
  const changes = client.changesOf('AbCd1234', message, 'openterm1');
  assert.deepEqual(changes.map((change) => [change.source.scope, change.source.chartId, change.tools.map((tool) => [tool.id, tool.isOnPrice, tool.origin?.serverUpdateTime, tool.origin?.source.storageSymbol]), change.removedIds, change.isSymbolCleared]), [
    ['chart', '_shared', [['moved', true, 5, 'OANDA:XAUUSD']], ['gone'], false],
    ['synced', undefined, [], [], true],
  ]);
  assert.deepEqual(client.changesOf('Unwatched', message, 'openterm1'), []);
  assert.equal(await client.streamUrl('AbCd1234'), 'https://notifications.example.invalid/auth/charts-storage/layout/AbCd1234/subscribe?id=private');
});

test('server-sent events are joined across chunks, and comments are dropped', () => {
  const parser = new EventStreamParser();
  assert.deepEqual(parser.feed(':\n\ndata: {"a"'), []);
  assert.deepEqual(parser.feed(':1}\r\n\r\nid: 4\ndata:x\ndata: y\n'), ['{"a":1}']);
  assert.deepEqual(parser.feed('\n'), ['x\ny']);
});

test('a saved tool carries the symbol, currency and unit its state holds, as TradingView\'s saves do', () => {
  const record = { id: 'x', symbol: 'OANDA:EURNZD', ownerSource: 'ibCWf0', serverUpdateTime: 5, state: { type: 'LineToolTrendLine', state: { symbol: 'OANDA:EURNZD', currencyId: null, unitId: 'pips' } } };
  assert.deepEqual(savedRecord(record), { ...record, currencyId: null, unitId: 'pips' });
});
