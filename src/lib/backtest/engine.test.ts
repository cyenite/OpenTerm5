import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountFigures, advance, cancelOrder, closePosition, modifyPosition, placeMarket, placePending, type Bids } from './engine';
import { bar, m1, MINUTE, ok, simulation, started, T0 } from './engine-fixtures';
import { newBook } from './model';
import { barsEnding, bidAt } from './series';
import { backtestStats, rMultiple, tradesCsv } from './stats';

test('series reveal a bar once it has ended, and the bid is the last ended close', () => {
  const series = m1(bar(0, 1.1, 1.2, 1.0, 1.15), bar(1, 1.15, 1.3, 1.1, 1.25), bar(5, 1.25, 1.26, 1.2, 1.21));
  assert.deepEqual(barsEnding(series, T0, T0 + 2 * MINUTE).map((item) => item.close), [1.15, 1.25]);
  assert.deepEqual(barsEnding(series, T0 + 2 * MINUTE, T0 + 6 * MINUTE).map((item) => item.close), [1.21]);
  assert.equal(bidAt(series, T0 + 90_000), 1.15, 'mid-bar, the previous close');
  assert.equal(bidAt(series, T0 + 4 * MINUTE), 1.25, 'during a closure the last close stands');
  assert.equal(bidAt(series, T0 - 1), null);
});

test('a market buy fills at the ask plus slippage, pays commission, and closes at the bid', () => {
  const sim = simulation({ slippagePoints: 2, commissionPerLot: 3.5 });
  const bids: Bids = { EURUSD: 1.1 };
  let book = ok(placeMarket(started(), sim, bids, { side: 'buy', symbol: 'EURUSD', volume: 1 }));
  const position = book.positions[0];
  assert.equal(position.priceOpen, 1.10012, 'ask 1.10010 plus two points');
  assert.equal(book.balance, 9996.5);
  assert.equal(book.deals[0].commission, -3.5);
  book = ok(closePosition(book, sim, { EURUSD: 1.102 }, position.ticket));
  // Closes at the bid less slippage: 1.10198 - 1.10012 = 186 points of 1 lot = 186 USD.
  assert.equal(book.deals.at(-1)?.profit, 186);
  assert.equal(book.balance, 9996.5 + 186 - 3.5);
  assert.equal(book.positions.length, 0);
  assert.equal(book.trades.length, 1);
  assert.equal(book.trades[0].reason, 'close');
  assert.equal(book.trades[0].commission, -7);
});

test('orders and stops are refused where MetaTrader would refuse them', () => {
  const sim = simulation();
  const book = started();
  const bids = { EURUSD: 1.1 };
  assert.match(placePending(book, sim, bids, { type: 'buyLimit', symbol: 'EURUSD', volume: 0.1, price: 1.1002 }).error ?? '', /below the ask/);
  assert.match(placePending(book, sim, bids, { type: 'sellStop', symbol: 'EURUSD', volume: 0.1, price: 1.1001 }).error ?? '', /below the bid/);
  assert.match(placePending(book, sim, bids, { type: 'buyStopLimit', symbol: 'EURUSD', volume: 0.1, price: 1.101, stopLimit: 1.102 }).error ?? '', /at or below its stop/);
  assert.match(placeMarket(book, sim, bids, { side: 'buy', symbol: 'EURUSD', volume: 0.1, sl: 1.1005 }).error ?? '', /stop loss must be below 1.10000/);
  assert.match(placeMarket(book, sim, bids, { side: 'sell', symbol: 'EURUSD', volume: 0.1, tp: 1.1005 }).error ?? '', /take profit must be below/);
  assert.match(placeMarket(book, sim, bids, { side: 'buy', symbol: 'EURUSD', volume: 0.015 }).error ?? '', /multiple of 0.01/);
  assert.match(placeMarket(book, sim, {}, { side: 'buy', symbol: 'EURUSD', volume: 0.1 }).error ?? '', /no price/);
  assert.match(placeMarket(newBook(1000), sim, bids, { side: 'buy', symbol: 'EURUSD', volume: 0.1 }).error ?? '', /starts once the replay/);
  assert.match(placeMarket(book, sim, bids, { side: 'buy', symbol: 'GBPUSD', volume: 0.1 }).error ?? '', /not set up/);
  assert.match(placeMarket(started(0, 100), sim, bids, { side: 'buy', symbol: 'EURUSD', volume: 1 }).error ?? '', /Not enough money/, '1 lot at 1:100 needs 1100 USD of margin');
});

test('a buy limit fills when the ask reaches it, and one the bar opens below fills at the opening ask', () => {
  const sim = simulation();
  let book = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'buyLimit', symbol: 'EURUSD', volume: 0.1, price: 1.0995 }));
  // The bid has to reach 1.0994 for the ask to touch 1.0995.
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1003, 1.09945, 1.1)), T0 + MINUTE);
  assert.equal(book.positions.length, 0, 'the bid low of 1.09945 leaves the ask above the limit');
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1003, 1.09945, 1.1), bar(1, 1.1, 1.1001, 1.0990, 1.0992)), T0 + 2 * MINUTE);
  assert.equal(book.positions[0].priceOpen, 1.0995);
  assert.equal(book.positions[0].ticket, 1, 'the position keeps the order ticket');

  let gap = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'buyLimit', symbol: 'EURUSD', volume: 0.1, price: 1.0995 }));
  gap = advance(gap, sim, () => m1(bar(0, 1.098, 1.0985, 1.0975, 1.098)), T0 + MINUTE);
  assert.equal(gap.positions[0].priceOpen, 1.0981, 'the opening ask 1.09810, better than the limit');
});

test('stops trigger on the side of the quote they close at, with slippage', () => {
  const sim = simulation({ slippagePoints: 3 });
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'sell', symbol: 'EURUSD', volume: 0.1, sl: 1.1010 }));
  // The ask is the bid plus 10 points, so a bid of 1.1009 already puts the ask at the stop.
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1009, 1.0995, 1.0996)), T0 + MINUTE);
  assert.equal(book.trades[0].reason, 'sl');
  assert.equal(book.trades[0].priceClose, 1.10103, 'the stop at 1.10100 plus three points of slippage');

  let stop = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'buyStop', symbol: 'EURUSD', volume: 0.1, price: 1.1020 }));
  stop = advance(stop, sim, () => m1(bar(0, 1.103, 1.104, 1.1025, 1.1035)), T0 + MINUTE);
  assert.equal(stop.positions[0].priceOpen, 1.10313, 'a gap fills at the opening ask plus slippage');
});

test('within one bar, a rising bar reaches its low before its high', () => {
  const sim = simulation();
  const open = () => ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 0.1, sl: 1.0990, tp: 1.1010 }));
  const rising = advance(open(), sim, () => m1(bar(0, 1.1, 1.102, 1.098, 1.101)), T0 + MINUTE);
  assert.equal(rising.trades[0].reason, 'sl');
  const falling = advance(open(), sim, () => m1(bar(0, 1.1, 1.102, 1.098, 1.099)), T0 + MINUTE);
  assert.equal(falling.trades[0].reason, 'tp');
  assert.equal(falling.trades[0].priceClose, 1.101);
});

test('an order filled in a bar can reach its own stop later in the same bar', () => {
  const sim = simulation();
  let book = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'sellLimit', symbol: 'EURUSD', volume: 0.1, price: 1.1010, sl: 1.1030 }));
  // Falling bar: up to 1.1040 first (fills the limit, then reaches the stop), then down.
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.104, 1.099, 1.0995)), T0 + MINUTE);
  assert.equal(book.positions.length, 0);
  assert.deepEqual(book.deals.map((deal) => [deal.entry, deal.reason, deal.price]), [['in', 'pending', 1.101], ['out', 'sl', 1.103]]);
});

test('a stop limit becomes a limit at its stop price and fills when the limit trades', () => {
  const sim = simulation();
  let book = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'buyStopLimit', symbol: 'EURUSD', volume: 0.1, price: 1.1010, stopLimit: 1.1005 }));
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1003, 1.0999, 1.1002)), T0 + MINUTE);
  assert.equal(book.orders[0].type, 'buyStopLimit', 'the stop has not traded');
  // Rising bar: the low first (nothing yet), then the high takes the ask to the stop, then the
  // close brings the ask back down to the limit.
  const series = m1(bar(0, 1.1, 1.1003, 1.0999, 1.1002), bar(1, 1.1002, 1.1009, 1.1001, 1.1004));
  book = advance(book, sim, () => series, T0 + 2 * MINUTE);
  assert.equal(book.orders.length, 0);
  assert.equal(book.positions[0].priceOpen, 1.1005);
  assert.match(book.journal.map((line) => line.message).join('\n'), /became a buy limit at 1.10050/);
});

test('pending orders expire at their time, and deleted orders are gone', () => {
  const sim = simulation();
  let book = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'sellLimit', symbol: 'EURUSD', volume: 0.1, price: 1.102, expiration: T0 + 2 * MINUTE }));
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1, 1.1, 1.1), bar(1, 1.1, 1.1, 1.1, 1.1), bar(2, 1.1, 1.103, 1.1, 1.1)), T0 + 3 * MINUTE);
  assert.equal(book.orders.length, 0);
  assert.equal(book.positions.length, 0, 'the bar that reached the price opened after the expiration');
  assert.match(book.journal.at(-1)!.message, /expired/);
  const placed = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'sellLimit', symbol: 'EURUSD', volume: 0.1, price: 1.102 }));
  assert.equal(ok(cancelOrder(placed, placed.orders[0].ticket)).orders.length, 0);
});

test('USDJPY profit converts at its own price, and figures follow the bids', () => {
  const sim = simulation();
  let book = ok(placeMarket(started(), sim, { USDJPY: 150 }, { side: 'buy', symbol: 'USDJPY', volume: 1 }));
  assert.equal(book.positions[0].priceOpen, 150.01);
  const figures = accountFigures(book, sim, { USDJPY: 151.01 });
  // 1 JPY move on 100 000 USD is 100 000 JPY, at 151.01 that is 662.21 USD.
  assert.equal(figures.profit.toFixed(2), '662.21');
  assert.equal(figures.margin.toFixed(2), '1000.00', 'one lot of USD at 1:100');
  assert.equal(figures.marginLevel?.toFixed(0), String(Math.round((10_000 + 662.21) / 1000 * 100)));
  book = ok(closePosition(book, sim, { USDJPY: 151.01 }, book.positions[0].ticket));
  assert.equal(book.balance, 10_662.21);
});

test('a partial close leaves the rest open, and the trade is recorded once fully closed', () => {
  const sim = simulation();
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 1, sl: 1.099 }));
  const ticket = book.positions[0].ticket;
  assert.equal(book.positions[0].initialRisk.toFixed(2), '110.00', '110 points to the stop from the ask');
  book = ok(closePosition(book, sim, { EURUSD: 1.1011 }, ticket, 0.4));
  assert.equal(book.positions[0].volume, 0.6);
  assert.equal(book.trades.length, 0);
  assert.match(closePosition(book, sim, { EURUSD: 1.1011 }, ticket, 0.7).error ?? '', /only 0.60 lots/);
  book = ok(closePosition(book, sim, { EURUSD: 1.1021 }, ticket));
  const [trade] = book.trades;
  assert.equal(trade.volume, 1);
  // 0.4 at +10 points and 0.6 at +20 points: 40 + 120 USD.
  assert.equal(trade.profit, 160);
  assert.equal(trade.priceClose, 1.10170);
  assert.equal(rMultiple(trade)?.toFixed(3), (160 / 110).toFixed(3));
});

test('excursions track the best and worst prices along the bar path', () => {
  const sim = simulation();
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 0.1 }));
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.103, 1.0985, 1.1001)), T0 + MINUTE);
  book = ok(closePosition(book, sim, { EURUSD: 1.1001 }, book.positions[0].ticket));
  assert.equal(book.trades[0].mfe, 29, 'from 1.10010 up to 1.10300 on 0.1 lots');
  assert.equal(book.trades[0].mae, -16, 'down to 1.09850');
});

test('setting a first stop loss on a position records its risk', () => {
  const sim = simulation();
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'sell', symbol: 'EURUSD', volume: 1 }));
  assert.equal(book.positions[0].initialRisk, 0);
  assert.match(modifyPosition(book, sim, { EURUSD: 1.1 }, book.positions[0].ticket, 1.1, 0).error ?? '', /stop loss must be above 1.10010/);
  book = ok(modifyPosition(book, sim, { EURUSD: 1.1 }, book.positions[0].ticket, 1.1020, 1.098));
  assert.equal(book.positions[0].initialRisk.toFixed(2), '200.00');
  book = ok(modifyPosition(book, sim, { EURUSD: 1.1 }, book.positions[0].ticket, 1.1015, 1.098));
  assert.equal(book.positions[0].initialRisk.toFixed(2), '200.00', 'trailing the stop keeps the first risk');
});

test('a margin level at the stop out closes the most losing position', () => {
  const sim = simulation({ leverage: 500, stopOutLevel: 50 });
  let book = ok(placeMarket(started(0, 1000), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 4 }));
  // Margin 4 * 110 010 / 500 = 880.08; equity falls under 440 once the bid drops about 140 points.
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1, 1.0980, 1.0980)), T0 + MINUTE);
  assert.equal(book.positions.length, 0);
  assert.equal(book.trades[0].reason, 'stopOut');
  assert.ok(book.balance > 0 && book.balance < 440);
  assert.ok(book.maxDrawdownPercent > 50);
});

test('statistics summarise closed trades, streaks and drawdown', () => {
  const sim = simulation();
  let book = started();
  const results = [200, -100, -50, 300, 0];
  for (const [index, points] of results.entries()) {
    book = ok(placeMarket(book, sim, { EURUSD: 1.1 }, { side: index % 2 ? 'sell' : 'buy', symbol: 'EURUSD', volume: 1, ...(index === 0 ? { sl: 1.099 } : {}) }));
    const ticket = book.positions[0].ticket;
    const isBuy = index % 2 === 0;
    // Buys open at the ask 1.10010 and close at the bid; sells open at 1.10000 and close at the ask.
    const bid = isBuy ? 1.1001 + points / 100_000 : 1.0999 - points / 100_000;
    book = ok(closePosition(book, sim, { EURUSD: Number(bid.toFixed(5)) }, ticket));
  }
  const stats = backtestStats(book, 10_000);
  assert.equal(stats.trades, 5);
  assert.deepEqual([stats.wins, stats.losses], [2, 2]);
  assert.equal(stats.winRate, 50);
  assert.equal(stats.netProfit.toFixed(2), '350.00');
  assert.equal(stats.profitFactor?.toFixed(2), (500 / 150).toFixed(2));
  assert.equal(stats.maxConsecutiveLosses, 2);
  assert.equal(stats.maxConsecutiveWins, 1);
  assert.equal(stats.largestLoss, -100);
  assert.equal(stats.long.trades, 3);
  assert.equal(stats.returnPercent.toFixed(1), '3.5');
  assert.equal(stats.averageR?.toFixed(2), (200 / 110).toFixed(2), 'only the first trade had a stop');
  const csv = tradesCsv(book.trades, () => 5).split('\n');
  assert.equal(csv.length, 6);
  assert.match(csv[1], /^\d+,EURUSD,buy,1\.00,2026-01-05 10:00:00,1\.10010,/);
});
