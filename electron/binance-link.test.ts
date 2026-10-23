import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TradeSnapshot } from '../shared/protocol';
import { BinanceLink } from './binance-link';
import { FakeBinance, rawAlgo, rawPosition, rawTrade } from './binance-fixtures';
import { attachedLevels, openingTrade, positionTicket, protectedClientId } from './binance-models';
import { ticketOf } from './exchange-common';

const credentials = { platform: 'binance' as const, environment: 'demo' as const, apiKey: 'fixture-key', apiSecret: 'fixture-secret' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

async function connected(prepare?: (exchange: FakeBinance) => void) {
  const exchange = new FakeBinance();
  prepare?.(exchange);
  const link = new BinanceLink({ fetch: exchange.fetch, openSocket: exchange.openSocket, accountDelay: 1 });
  const snapshots: TradeSnapshot[] = [];
  link.on('event', (event: string, data: unknown) => { if (event === 'trade') snapshots.push(data as TradeSnapshot); });
  const account = await link.signIn(credentials);
  return { exchange, link, account, snapshots };
}

test('sign-in refuses keys that can withdraw, and carries on where the key permissions cannot be read', async () => {
  const exchange = new FakeBinance();
  exchange.restrictions = { enableReading: true, enableFutures: true, enableWithdrawals: true };
  const link = new BinanceLink({ fetch: exchange.fetch, openSocket: exchange.openSocket });
  await assert.rejects(link.signIn(credentials), /can withdraw funds/);
  assert.equal(link.loggedIn, false);
  const { account, link: demo } = await connected((fake) => { fake.restrictions = null; });
  assert.equal(account.login, 4242);
  demo.disconnect();
});

test('sign-in maps the account, USDT contracts and positions, folding protection orders into the position', async () => {
  const { link, account, exchange } = await connected((fake) => {
    fake.positions = [rawPosition()];
    fake.trades = [rawTrade({ id: 1, side: 'SELL', qty: '0.2', time: 1_759_000_000_000 }), rawTrade({ id: 2, side: 'BUY', qty: '0.2', time: 1_759_100_000_000 }), rawTrade({ id: 3, qty: '0.1', time: 1_760_000_000_000 })];
    fake.algos = [
      rawAlgo({ algoId: 1, triggerPrice: '58000' }),
      rawAlgo({ algoId: 2, orderType: 'TAKE_PROFIT_MARKET', triggerPrice: '63000' }),
      rawAlgo({ algoId: 3, orderType: 'TAKE_PROFIT_MARKET', triggerPrice: '62000' }),
      rawAlgo({ algoId: 4, side: 'BUY', reduceOnly: false, triggerPrice: '61000', clientAlgoId: protectedClientId('entry', 60500, 62500, 0.1) }),
    ];
  });
  assert.deepEqual([account.login, account.currency, account.server, account.marginFree], [4242, 'USDT', 'Binance Demo trading', 9000]);
  const symbols = await link.request('symbols.list', {});
  assert.deepEqual(symbols.map((symbol) => symbol.name), ['BTCUSDT'], 'USDC contracts need Multi-Assets mode');
  const spec = await link.request('symbols.info', { symbol: 'BTCUSDT' });
  assert.deepEqual([spec.digits, spec.tickSize, spec.volumeStep, spec.volumeMin, spec.volumeMax], [1, 0.1, 0.001, 0.001, 120]);
  const snapshot = await link.request('trade.snapshot', {});
  const [position] = snapshot.positions;
  assert.equal(position.ticket, positionTicket('BTCUSDT', 'BOTH', 1_760_000_000_000), 'the ticket comes from the trade that opened the position');
  assert.deepEqual([position.side, position.volume, position.sl, position.tp, position.leverage], ['buy', 0.1, 58000, 62000, 10]);
  assert.deepEqual(snapshot.orders.map((order) => [order.type, order.priceOpen, order.sl, order.tp]), [['buyStop', 61000, 60500, 62500]], 'protection orders are not pending orders');
  assert.ok(exchange.userSocket.url.endsWith('/private/ws/listen-1'));
  link.disconnect();
});

test('a market order with SL and TP places reduce-only conditional orders for the fill and reports the position', async () => {
  const { exchange, link } = await connected();
  exchange.routes.set('/fapi/v3/positionRisk', () => [rawPosition({ positionAmt: '0.012' })]);
  exchange.trades = [rawTrade({ qty: '0.012', time: 1_760_000_100_000 })];
  const result = await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.0125, sl: 59000.04, tp: 62000 });
  const [order] = exchange.writes('/fapi/v1/order');
  assert.deepEqual([order.side, order.type, order.quantity, order.newOrderRespType, order.reduceOnly], ['BUY', 'MARKET', '0.012', 'RESULT', undefined]);
  const protection = exchange.writes('/fapi/v1/algoOrder').map((algo) => [algo.algoType, algo.type, algo.side, algo.quantity, algo.triggerPrice, algo.reduceOnly]);
  assert.deepEqual(protection, [['CONDITIONAL', 'STOP_MARKET', 'SELL', '0.012', '59000.0', 'true'], ['CONDITIONAL', 'TAKE_PROFIT_MARKET', 'SELL', '0.012', '62000.0', 'true']]);
  assert.deepEqual([result.isSuccess, result.retcode, result.price, result.volume], [true, 10009, 60000.1, 0.012]);
  assert.equal(result.position, positionTicket('BTCUSDT', 'BOTH', 1_760_000_100_000));
  link.disconnect();
});

test('a fill whose stop loss Binance refuses is closed again', async () => {
  const { exchange, link } = await connected();
  exchange.failures.set('POST /fapi/v1/algoOrder', { code: -4045, msg: 'Reach max stop order limit.' });
  const result = await link.request('order.send', { action: 'deal', type: 'sell', symbol: 'BTCUSDT', volume: 0.01, sl: 61000 });
  assert.equal(result.isSuccess, false);
  assert.match(result.comment, /refused the stop loss.*closed again/);
  const [, undo] = exchange.writes('/fapi/v1/order');
  assert.deepEqual([undo.side, undo.type, undo.quantity, undo.reduceOnly], ['BUY', 'MARKET', '0.010', 'true']);
  link.disconnect();
});

test('stops and targets on the wrong side are refused before anything is sent', async () => {
  const { exchange, link } = await connected();
  const market = await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.01, sl: 60500 });
  assert.deepEqual([market.isSuccess, market.retcode], [false, 10016]);
  assert.match(market.comment, /stop loss 60500.0 must be below the market \(60000.0\) for a buy/);
  const pending = await link.request('order.send', { action: 'pending', type: 'sellLimit', symbol: 'BTCUSDT', volume: 0.01, price: 60500, sl: 61000, tp: 60600 });
  assert.match(pending.comment, /take profit 60600.0 must be below the entry price \(60500.0\) for a sell/);
  assert.equal(exchange.writes('/fapi/v1/order').length + exchange.writes('/fapi/v1/algoOrder').length, 0);
  link.disconnect();
});

test('a limit entry carries its SL/TP in its client id and gets them on each fill', async () => {
  const { exchange, link } = await connected();
  const placed = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.02, price: 59500, sl: 59000, tp: 61000 });
  assert.equal(placed.retcode, 10008);
  const [entry] = exchange.writes('/fapi/v1/order');
  assert.deepEqual(attachedLevels(entry.newClientOrderId, 0.1), { sl: 59000, tp: 61000 });
  exchange.userSocket.push({ e: 'ORDER_TRADE_UPDATE', o: { s: 'BTCUSDT', c: entry.newClientOrderId, S: 'BUY', o: 'LIMIT', x: 'TRADE', X: 'PARTIALLY_FILLED', i: 1000, q: '0.02', z: '0.005', l: '0.005', p: '59500', ps: 'BOTH', T: 1 } });
  await settle();
  assert.deepEqual(exchange.writes('/fapi/v1/algoOrder').map((algo) => [algo.type, algo.quantity, algo.triggerPrice]), [['STOP_MARKET', '0.005', '59000.0'], ['TAKE_PROFIT_MARKET', '0.005', '61000.0']]);
  const refused = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.02, price: 64000 });
  assert.deepEqual([refused.isSuccess, refused.retcode], [false, 10015], 'a buy limit above the band is refused before sending');
  link.disconnect();
});

test('moving a stop places the new one before cancelling the old', async () => {
  const { exchange, link } = await connected((fake) => {
    fake.positions = [rawPosition()];
    fake.trades = [rawTrade({ time: 1_760_000_000_000 })];
    fake.algos = [rawAlgo({ algoId: 7, quantity: '0.1', triggerPrice: '58000' })];
  });
  const [position] = (await link.request('trade.snapshot', {})).positions;
  const result = await link.request('order.send', { action: 'sltp', position: position.ticket, sl: 59000, tp: 0 });
  assert.equal(result.isSuccess, true);
  const order = exchange.calls.filter((call) => call.path === '/fapi/v1/algoOrder').map((call) => `${call.method} ${call.query.get('triggerPrice') ?? call.query.get('algoId')}`);
  assert.deepEqual(order, ['POST 59000.0', 'DELETE 7']);
  link.disconnect();
});

test('hedge mode names the position side instead of sending reduce-only', async () => {
  const { exchange, link } = await connected((fake) => {
    fake.routes.set('/fapi/v1/accountConfig', () => ({ canTrade: true, dualSidePosition: true, multiAssetsMargin: false }));
    fake.positions = [rawPosition({ positionSide: 'SHORT', positionAmt: '-0.1' })];
    fake.trades = [rawTrade({ side: 'SELL', positionSide: 'SHORT', time: 1_760_000_000_000 })];
  });
  const [position] = (await link.request('trade.snapshot', {})).positions;
  assert.equal(position.side, 'sell');
  await link.request('order.send', { action: 'deal', symbol: 'BTCUSDT', position: position.ticket, volume: 0.05, type: 'buy' });
  const [close] = exchange.writes('/fapi/v1/order');
  assert.deepEqual([close.side, close.positionSide, close.reduceOnly], ['BUY', 'SHORT', undefined]);
  link.disconnect();
});

// Binance checks an order's position side against the account's mode.
function enforceMode(exchange: FakeBinance, isHedge: boolean) {
  exchange.routes.set('/fapi/v1/accountConfig', () => ({ canTrade: true, dualSidePosition: isHedge, multiAssetsMargin: false }));
  exchange.refuse = (method, path, query) => {
    if (method !== 'POST' || (path !== '/fapi/v1/order' && path !== '/fapi/v1/algoOrder')) return undefined;
    const isHedgeOrder = query.has('positionSide') && query.get('positionSide') !== 'BOTH';
    return isHedgeOrder === isHedge ? undefined : { code: -4061, msg: "Order's position side does not match user's setting." };
  };
}

test('an order refused after the account switched to Hedge Mode is sent again in the new mode', async () => {
  const { exchange, link } = await connected();
  const events: string[] = [];
  link.on('event', (event: string, data: { message?: string }) => { if (event === 'journal') events.push(data.message ?? ''); });
  enforceMode(exchange, true);
  const result = await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'BTCUSDT', volume: 0.01, sl: 59000, tp: 62000 });
  assert.equal(result.isSuccess, true);
  const orders = exchange.writes('/fapi/v1/order');
  assert.deepEqual(orders.map((order) => order.positionSide), [undefined, 'LONG'], 'refused once, then sent with the position side');
  assert.deepEqual(exchange.writes('/fapi/v1/algoOrder').map((algo) => [algo.type, algo.positionSide, algo.reduceOnly]), [['STOP_MARKET', 'LONG', undefined], ['TAKE_PROFIT_MARKET', 'LONG', undefined]]);
  assert.equal((await link.request('account.info', {}))!.isHedging, true);
  assert.match(events.join(' '), /now in Hedge Mode/);
  link.disconnect();
});

test('a switch back to One-way Mode drops the position side, and a refusal without a switch is not retried', async () => {
  const { exchange, link } = await connected((fake) => fake.routes.set('/fapi/v1/accountConfig', () => ({ canTrade: true, dualSidePosition: true, multiAssetsMargin: false })));
  enforceMode(exchange, false);
  const placed = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.01, price: 59500, sl: 59000 });
  assert.equal(placed.isSuccess, true);
  assert.deepEqual(exchange.writes('/fapi/v1/order').map((order) => order.positionSide), ['LONG', undefined]);
  exchange.refuse = (method, path) => method === 'POST' && path === '/fapi/v1/order' ? { code: -4061, msg: "Order's position side does not match user's setting." } : undefined;
  const refused = await link.request('order.send', { action: 'pending', type: 'buyLimit', symbol: 'BTCUSDT', volume: 0.01, price: 59400 });
  assert.equal(refused.isSuccess, false);
  assert.equal(exchange.writes('/fapi/v1/order').length, 3, 'the mode had not changed, so the refusal stands');
  link.disconnect();
});

test('a position closed by its stop cancels the rest of OpenTerm5 protection', async () => {
  const { exchange, link } = await connected((fake) => {
    fake.positions = [rawPosition()];
    fake.trades = [rawTrade()];
    fake.algos = [rawAlgo({ algoId: 8, clientAlgoId: 'ot5t-abc', orderType: 'TAKE_PROFIT_MARKET', triggerPrice: '62000' }), rawAlgo({ algoId: 9, clientAlgoId: 'manual-tp', orderType: 'TAKE_PROFIT_MARKET', triggerPrice: '63000' })];
  });
  exchange.userSocket.push({ e: 'ACCOUNT_UPDATE', a: { m: 'ORDER', B: [], P: [{ s: 'BTCUSDT', pa: '0', ep: '0', up: '0', ps: 'BOTH' }] } });
  await settle();
  assert.deepEqual(exchange.writes('/fapi/v1/algoOrder', 'DELETE').map((call) => call.algoId), ['8']);
  assert.equal((await link.request('trade.snapshot', {})).positions.length, 0);
  link.disconnect();
});

test('the opening trade is the one that takes the position from flat or across zero', () => {
  const trades = [rawTrade({ id: 1, side: 'BUY', qty: '0.3', time: 1 }), rawTrade({ id: 2, side: 'SELL', qty: '0.5', time: 2 }), rawTrade({ id: 3, side: 'SELL', qty: '0.1', time: 3 })];
  assert.equal(openingTrade(trades, -0.3, 'BOTH', 0.001)?.id, 2, 'a sell that flipped a long into a short opened it');
  assert.equal(openingTrade(trades.slice(0, 1), 0.3, 'BOTH', 0.001)?.id, 1);
  assert.equal(openingTrade(trades.slice(2), -0.3, 'BOTH', 0.001), undefined, 'with only a later add, the opening cannot be told yet');
  assert.equal(ticketOf('order|1') === ticketOf('algo|1'), false);
});
