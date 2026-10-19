import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, bulkAction, placeMarket, placePending } from './engine';
import { bar, m1, MINUTE, ok, simulation, started, T0 } from './engine-fixtures';

test('a break-even rule moves the stop one point past entry once the trigger is reached', () => {
  const sim = simulation();
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 0.1, rule: { breakEven: { triggerPoints: 50, lockPoints: 1 } } }));
  book = advance(book, sim, () => m1(bar(0, 1.1001, 1.106, 1.1, 1.105)), T0 + MINUTE);
  assert.equal(book.positions[0].sl, 1.10011);
  assert.equal(book.positions[0].rule?.breakEven?.isDone, true);
  book = advance(book, sim, () => m1(bar(0, 1.1001, 1.106, 1.1, 1.105), bar(1, 1.105, 1.1052, 1.099, 1.0995)), T0 + 2 * MINUTE);
  assert.equal(book.trades[0].reason, 'sl');
  assert.equal(book.trades[0].priceClose, 1.10011);
});

test('a trailing stop follows the best price by its distance, in steps', () => {
  const sim = simulation();
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 0.1, rule: { trailing: { startPoints: 50, distancePoints: 30, stepPoints: 10 } } }));
  // The bar closes at 1.10590, above the stop the high trailed it to.
  book = advance(book, sim, () => m1(bar(0, 1.1001, 1.106, 1.1, 1.1059)), T0 + MINUTE);
  assert.equal(book.positions[0].sl, 1.1057, 'thirty points under the high of 1.10600');
  book = advance(book, sim, () => m1(bar(0, 1.1001, 1.106, 1.1, 1.1059), bar(1, 1.1059, 1.106, 1.099, 1.0995)), T0 + 2 * MINUTE);
  assert.equal(book.trades[0].priceClose, 1.1057);
});

test('hidden stops and targets close at market where they are crossed', () => {
  const sim = simulation({ slippagePoints: 1 });
  let book = ok(placeMarket(started(), sim, { EURUSD: 1.1 }, { side: 'buy', symbol: 'EURUSD', volume: 0.1, rule: { virtualStop: 1.099, virtualTarget: 1.103 } }));
  assert.equal(book.positions[0].sl, 0, 'nothing is set on the position itself');
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.1001, 1.098, 1.0985)), T0 + MINUTE);
  assert.equal(book.trades[0].reason, 'sl');
  assert.equal(book.trades[0].priceClose, 1.09899, 'the hidden stop less a point of slippage');
});

test('a pending order hands its rule to the position it opens', () => {
  const sim = simulation();
  let book = ok(placePending(started(), sim, { EURUSD: 1.1 }, { type: 'buyStop', symbol: 'EURUSD', volume: 0.1, price: 1.1005, rule: { virtualStop: 1.099 } }));
  book = advance(book, sim, () => m1(bar(0, 1.1, 1.101, 1.0999, 1.1008)), T0 + MINUTE);
  assert.deepEqual(book.positions[0].rule, { virtualStop: 1.099 });
});

test('bulk actions close, delete and reverse as the live trade manager does', () => {
  const sim = simulation();
  const bids = { EURUSD: 1.1, USDJPY: 150 };
  let book = started();
  book = ok(placeMarket(book, sim, bids, { side: 'buy', symbol: 'EURUSD', volume: 0.1 }));
  book = ok(placeMarket(book, sim, bids, { side: 'sell', symbol: 'EURUSD', volume: 0.2 }));
  book = ok(placeMarket(book, sim, bids, { side: 'buy', symbol: 'USDJPY', volume: 0.1 }));
  book = ok(placePending(book, sim, bids, { type: 'buyLimit', symbol: 'EURUSD', volume: 0.1, price: 1.099 }));
  const later = { EURUSD: 1.102, USDJPY: 149 };
  const losing = bulkAction(book, sim, later, 'closeLosing');
  assert.deepEqual(losing.book.positions.map((position) => position.side + position.symbol), ['buyEURUSD'], 'the EURUSD sell and the USDJPY buy were losing');
  const onSymbol = bulkAction(book, sim, later, 'deletePending', 'USDJPY');
  assert.equal(onSymbol.book.orders.length, 1, 'a symbol narrows the action');
  const breakEven = bulkAction(book, sim, later, 'breakEvenAll', 'EURUSD');
  assert.deepEqual(breakEven.book.positions.map((position) => position.sl), [1.1001, 0, 0], 'only the EURUSD buy is ahead');
  const reversed = bulkAction(book, sim, later, 'reverse', undefined, book.positions[0].ticket);
  assert.deepEqual(reversed.results.map((result) => result.error), [null, null]);
  assert.equal(reversed.book.positions.at(-1)?.side, 'sell');
});
