import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, TickBarBook } from './tick-bars';

const base = Date.UTC(2026, 9, 14, 9, 30, 0);

test('quotes build one-second bars with tick-count volume', () => {
  const book = new TickBarBook();
  book.add('EURUSD', base + 100, 1.1);
  book.add('EURUSD', base + 400, 1.105);
  book.add('EURUSD', base + 900, 1.098);
  book.add('EURUSD', base + 1200, 1.101);
  assert.deepEqual(book.bars('EURUSD', 1), [
    { time: base, open: 1.1, high: 1.105, low: 1.098, close: 1.098, volume: 3 },
    { time: base + 1000, open: 1.101, high: 1.101, low: 1.101, close: 1.101, volume: 1 },
  ]);
  assert.deepEqual(book.bars('GBPUSD', 1), []);
});

test('longer seconds timeframes merge the one-second bars they cover', () => {
  const book = new TickBarBook();
  const prices = [1, 3, 2, 5, 4, 6, 7];
  prices.forEach((price, second) => book.add('X', base + second * 1000, price));
  assert.deepEqual(book.bars('X', 5), [
    { time: base, open: 1, high: 5, low: 1, close: 4, volume: 5 },
    { time: base + 5000, open: 6, high: 7, low: 6, close: 7, volume: 2 },
  ]);
  assert.deepEqual(book.current('X', 5), { time: base + 5000, open: 6, high: 7, low: 6, close: 7, volume: 2 });
  assert.deepEqual(book.current('X', 30), { time: base, open: 1, high: 7, low: 1, close: 7, volume: 7 });
  assert.equal(book.coverage('X'), 6000);
});

test('late, invalid and excess quotes do not disturb the series', () => {
  const book = new TickBarBook(10);
  book.add('X', base + 5000, 2);
  book.add('X', base + 1000, 9);
  book.add('X', base + 5000, Number.NaN);
  book.add('X', base + 5000, 0);
  assert.deepEqual(book.bars('X', 1), [{ time: base + 5000, open: 2, high: 2, low: 2, close: 2, volume: 1 }]);
  for (let second = 6; second < 30; second++) book.add('X', base + second * 1000, second);
  assert.ok(book.bars('X', 1).length <= 11);
  assert.equal(book.bars('X', 1).at(-1)!.close, 29);
  book.clear();
  assert.equal(book.current('X', 1), null);
});

test('listeners hear about every quote and can unsubscribe', () => {
  const book = new TickBarBook();
  const heard: string[] = [];
  const off = book.onBar((symbol) => heard.push(symbol));
  book.add('A', base, 1);
  off();
  book.add('A', base + 1000, 1);
  assert.deepEqual(heard, ['A']);
  assert.deepEqual(aggregate([], 5), []);
});
