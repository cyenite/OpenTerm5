import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Position, TradeSnapshot } from '../shared/protocol';
import { BybitLink } from './bybit-link';
import { FakeBybit, rawOrder, rawPosition } from './bybit-fixtures';
import { positionTicket } from './bybit-models';
import { ticketOf } from './exchange-common';

const credentials = { platform: 'bybit' as const, environment: 'demo' as const, apiKey: 'fixture-key', apiSecret: 'fixture-secret' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

async function connected(prepare?: (exchange: FakeBybit) => void) {
  const exchange = new FakeBybit();
  prepare?.(exchange);
  const link = new BybitLink({ fetch: exchange.fetch, openSocket: exchange.openSocket, resultTimeout: 200 });
  const snapshots: TradeSnapshot[] = [];
  link.on('event', (event: string, data: unknown) => { if (event === 'trade') snapshots.push(data as TradeSnapshot); });
  const account = await link.signIn(credentials);
  return { exchange, link, account, snapshots };
}

// The exchange reports the fill on the private stream shortly after accepting the order.
function fillNext(exchange: FakeBybit, status = 'Filled', patch: Record<string, unknown> = {}) {
  const original = exchange.routes.get('/v5/order/create')!;
  exchange.routes.set('/v5/order/create', (query, body) => {
    const result = original(query, body);
    setImmediate(() => exchange.privateSocket.push({
      topic: 'order',
      data: [{ ...rawOrder({ orderId: 'created-1', orderLinkId: body!.orderLinkId as string, orderStatus: status, qty: body!.qty as string, cumExecQty: status === 'Filled' ? body!.qty as string : '0', avgPrice: '60000.1', orderType: body!.orderType as string }), category: 'linear', ...patch }],
    }));
    return result;
  });
}

test('sign-in refuses keys that can withdraw', async () => {
  const exchange = new FakeBybit();
  exchange.permissions = { ...exchange.permissions, Wallet: ['Withdraw'] };
  const link = new BybitLink({ fetch: exchange.fetch, openSocket: exchange.openSocket });
  await assert.rejects(link.signIn(credentials), /can withdraw funds/);
  assert.equal(link.loggedIn, false);
});

test('sign-in maps the unified account, contracts and positions, folding TP/SL orders into the position', async () => {
  const { link, account } = await connected((exchange) => {
    exchange.positions = [rawPosition()];
    exchange.orders = [
      rawOrder(),
      rawOrder({ orderId: 'sl-1', side: 'Sell', orderType: 'Market', orderStatus: 'Untriggered', stopOrderType: 'PartialStopLoss', triggerPrice: '58000', price: '0', reduceOnly: true }),
      rawOrder({ orderId: 'tp-1', side: 'Sell', orderType: 'Market', orderStatus: 'Untriggered', stopOrderType: 'PartialTakeProfit', triggerPrice: '63000', price: '0', reduceOnly: true }),
      rawOrder({ orderId: 'tp-2', side: 'Sell', orderType: 'Market', orderStatus: 'Untriggered', stopOrderType: 'PartialTakeProfit', triggerPrice: '62000', price: '0', reduceOnly: true }),
    ];
  });
  assert.equal(account.login, 4242);
  assert.equal(account.currency, 'USD');
  assert.equal(account.server, 'Bybit Demo trading');
  assert.equal(account.marginFree, 9000);
  const spec = await link.request('symbols.info', { symbol: 'BTCUSDT' });
  assert.deepEqual([spec.digits, spec.tickSize, spec.volumeStep, spec.volumeMin, spec.volumeMax, spec.contractSize], [2, 0.1, 0.001, 0.001, 119, 1]);
  const snapshot = await link.request('trade.snapshot', {});
  assert.equal(snapshot.orders.length, 1, 'TP/SL orders are not pending orders');
  assert.equal(snapshot.orders[0].type, 'buyLimit');
  const [position] = snapshot.positions as Position[];
  assert.equal(position.ticket, positionTicket('BTCUSDT', 0, 1_760_000_000_000));
  assert.deepEqual([position.side, position.volume, position.sl, position.tp, position.leverage], ['buy', 0.1, 58000, 62000, 10]);
  assert.equal(position.profit, Math.round(0 * 0.999 * 100) / 100, 'P/L follows the live mark price, valued in USD');
  link.disconnect();
});

test('a market risk leg sends a partial TP/SL order and reports the netted position ticket', async () => {
  const { exchange, link } = await connected();
  fillNext(exchange);
  exchange.routes.set('/v5/position/list', () => ({ list: [rawPosition({ size: '0.012', openTime: 1_760_000_100_000 })] }));
  const result = await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.0125, sl: 59000.04, tp: 62000 });
  const create = exchange.posts.find((post) => post.path === '/v5/order/create')!.body;
  assert.deepEqual([create.side, create.orderType, create.qty, create.positionIdx, create.tpslMode, create.stopLoss, create.takeProfit], ['Buy', 'Market', '0.012', 0, 'Partial', '59000.0', '62000.0']);
  assert.ok(String(create.orderLinkId).startsWith('ot5-') && String(create.orderLinkId).length <= 36);
  assert.equal(result.isSuccess, true);
  assert.equal(result.retcode, 10009);
  assert.equal(result.order, ticketOf('created-1'));
  assert.equal(result.position, positionTicket('BTCUSDT', 0, 1_760_000_100_000));
  link.disconnect();
});

test('Bybit rejections report the nearest MT5 code; a lost create response is an unknown outcome', async () => {
  const { exchange, link } = await connected();
  exchange.failures.set('/v5/order/create', { retCode: 110007, retMsg: 'ab not enough for new order' });
  const declined = await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.01 });
  assert.equal(declined.isSuccess, false);
  assert.equal(declined.retcode, 10019);
  exchange.failures.set('/v5/order/create', new Error('socket hang up'));
  await assert.rejects(link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.01 }), /outcome is unknown/);
  link.disconnect();
});

test('pending stop orders carry the trigger direction and are reported once accepted', async () => {
  const { exchange, link } = await connected();
  fillNext(exchange, 'Untriggered');
  const result = await link.request('order.send', { action: 'pending', type: 'sellStop', symbol: 'BTCUSDT', volume: 0.01, price: 58000 });
  const create = exchange.posts.find((post) => post.path === '/v5/order/create')!.body;
  assert.deepEqual([create.orderType, create.triggerPrice, create.triggerDirection], ['Market', '58000.0', 2]);
  assert.equal(result.retcode, 10008);
  const expiring = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.01, price: 58000, expiration: 1 });
  assert.match(expiring.comment, /cannot expire/);
  link.disconnect();
});

test('moving the stop of a position with partial stops amends every stop order', async () => {
  const { exchange, link } = await connected((fixture) => {
    fixture.positions = [rawPosition()];
    fixture.orders = ['sl-1', 'sl-2'].map((orderId) => rawOrder({ orderId, side: 'Sell', orderType: 'Market', orderStatus: 'Untriggered', stopOrderType: 'PartialStopLoss', triggerPrice: '58000', reduceOnly: true }));
  });
  const ticket = positionTicket('BTCUSDT', 0, 1_760_000_000_000);
  const result = await link.request('order.send', { action: 'sltp', position: ticket, sl: 60000, tp: 0 });
  assert.equal(result.isSuccess, true);
  assert.deepEqual(exchange.posts.map((post) => [post.path, post.body.orderId, post.body.triggerPrice]), [['/v5/order/amend', 'sl-1', '60000.0'], ['/v5/order/amend', 'sl-2', '60000.0']]);
  link.disconnect();
});

test('a position without TP/SL orders sets a full-position stop', async () => {
  const { exchange, link } = await connected((fixture) => { fixture.positions = [rawPosition()]; });
  await link.request('order.send', { action: 'sltp', position: positionTicket('BTCUSDT', 0, 1_760_000_000_000), sl: 59000, tp: 0 });
  assert.deepEqual(exchange.posts, [{ path: '/v5/position/trading-stop', body: { category: 'linear', symbol: 'BTCUSDT', tpslMode: 'Full', positionIdx: 0, stopLoss: '59000.0' } }]);
  link.disconnect();
});

test('the margin check prices the order at the symbol leverage and estimates isolated liquidation', async () => {
  const { link } = await connected((fixture) => { fixture.positions = [rawPosition({ size: '0', side: '', leverage: '20' })]; });
  const check = await link.request('order.check', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.1 });
  assert.equal(check.hasMarginEstimate, true);
  assert.equal(check.leverage, 20);
  assert.equal(check.margin, Math.round(60000.1 * 0.1 / 20 * 0.999 * 100) / 100);
  assert.equal(check.liquidationPrice, Number((60000.1 * (1 - (1 / 20 - 0.005))).toFixed(2)));
  link.disconnect();
});

test('position stream updates replace the entry price and closing removes the position', async () => {
  const { exchange, link, snapshots } = await connected((fixture) => { fixture.positions = [rawPosition()]; });
  exchange.privateSocket.push({ topic: 'position', data: [{ ...rawPosition({ avgPrice: undefined, entryPrice: '60500', size: '0.2' }), category: 'linear' }] });
  assert.equal(snapshots.at(-1)!.positions[0].priceOpen, 60500);
  exchange.privateSocket.push({ topic: 'position', data: [{ ...rawPosition({ size: '0', side: '' }), category: 'linear' }] });
  assert.equal(snapshots.at(-1)!.positions.length, 0);
  link.disconnect();
});

test('tickers stream ticks and aggregated charts are built from source klines', async () => {
  const { exchange, link } = await connected();
  const minute = 60_000;
  const start = Math.floor(1_760_000_000_000 / (2 * minute)) * 2 * minute;
  exchange.routes.set('/v5/market/kline', (query) => {
    assert.equal(query.get('interval'), '1');
    return { list: [3, 2, 1, 0].map((index) => [String(start + index * minute), '1', String(2 + index), '0.5', String(1 + index), '10']) };
  });
  const bars = await link.request('rates.get', { symbol: 'BTCUSDT', timeframe: 'M2', count: 2 });
  assert.deepEqual(bars, [
    { time: start / 1000, open: 1, high: 3, low: 0.5, close: 2, volume: 20 },
    { time: start / 1000 + 120, open: 1, high: 5, low: 0.5, close: 4, volume: 20 },
  ]);
  const ticks: unknown[] = [];
  link.on('event', (event: string, data: unknown) => { if (event === 'tick') ticks.push(data); });
  await link.request('ticks.subscribe', { symbols: ['BTCUSDT', 'EURUSD'] });
  await settle();
  assert.ok(exchange.publicSocket.sent.some((message) => (message.args as string[] | undefined)?.includes('tickers.BTCUSDT')));
  exchange.publicSocket.push({ topic: 'tickers.BTCUSDT', type: 'delta', ts: 5, data: { symbol: 'BTCUSDT', bid1Price: '60010' } });
  assert.deepEqual(ticks.at(-1), { symbol: 'BTCUSDT', bid: 60010, ask: 60000.1, last: 60000, time: 5, volume: 0 });
  link.disconnect();
});

test('the trade gate refuses before anything reaches Bybit', async () => {
  const { exchange, link } = await connected();
  link.setTradeGate(() => 'Equity guard tripped');
  await assert.rejects(link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.01 }), /Equity guard tripped/);
  assert.equal(exchange.posts.length, 0);
  link.disconnect();
});

test('limit prices outside Bybit\'s band are refused before sending, and refusals reach the Journal', async () => {
  const { exchange, link } = await connected();
  const journal: string[] = [];
  link.on('event', (event: string, data: { message: string }) => { if (event === 'journal') journal.push(data.message); });
  const above = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.01, price: 61000 });
  assert.equal(above.isSuccess, false);
  assert.equal(above.retcode, 10015);
  assert.match(above.comment, /buy limits at 60600\.00 or lower.*Buy Stop/);
  const check = await link.request('order.check', { action: 'pending', type: 'sellLimit', symbol: 'BTCUSDT', volume: 0.01, price: 59000 });
  assert.equal(check.isSuccess, false);
  assert.match(check.comment, /sell limits at 59400\.00 or higher/);
  assert.equal(exchange.posts.length, 0);
  exchange.failures.set('/v5/order/create', { retCode: 110003, retMsg: 'price is invalid' });
  const refused = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.01, price: 59000, sl: 58000 });
  assert.match(refused.comment, /outside the range Bybit accepts/);
  assert.match(journal.at(-1)!, /Bybit refused Buy Limit 0\.010 BTCUSDT at 59000\.0 SL 58000\.0/);
  link.disconnect();
});

test('a kline feed stays until the last chart showing that symbol and timeframe leaves', async () => {
  const { exchange, link } = await connected();
  exchange.routes.set('/v5/market/kline', () => ({ list: [] }));
  const chart = { symbol: 'BTCUSDT', timeframe: 'H1' as const };
  await link.request('rates.subscribe', chart);
  await link.request('rates.subscribe', chart);
  await settle();
  await link.request('rates.unsubscribe', chart);
  const bars: unknown[] = [];
  link.on('event', (event: string, data: unknown) => { if (event === 'bar') bars.push(data); });
  exchange.publicSocket.push({ topic: 'kline.60.BTCUSDT', data: [{ start: 1_760_000_400_000, open: '1', high: '2', low: '1', close: '2', volume: '3' }] });
  assert.equal(bars.length, 1, 'the second chart still receives bars');
  assert.ok(!exchange.publicSocket.sent.some((message) => message.op === 'unsubscribe'));
  await link.request('rates.unsubscribe', chart);
  assert.deepEqual(exchange.publicSocket.sent.at(-1), { op: 'unsubscribe', args: ['tickers.BTCUSDT', 'kline.60.BTCUSDT'] });
  link.disconnect();
});
