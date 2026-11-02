import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar } from '../types';
import { foldPrice, mergeLiveBar } from './live';

const MINUTE = 60_000;
const open = Date.UTC(2026, 10, 2, 10, 0);
const bar = (time: number, close: number): Bar => ({ time, open: 1.1, high: Math.max(1.1, close), low: Math.min(1.1, close), close, volume: 10 });

// The reported lag: the source sends the bar in progress every couple of seconds (an MT5 poll
// queued behind other broker reads), quotes keep coming in between, and the candle used to sit on
// the polled close until the next poll.
test('the bar in progress follows quotes between polled bars', () => {
  const bars = [bar(open - MINUTE, 1.1), bar(open, 1.101)];
  let quote = { time: open + 1_000, price: 1.1012 };
  const quotes = [1.1012, 1.1015, 1.1019, 1.1023];
  for (const [index, price] of quotes.entries()) {
    quote = { time: open + 1_000 * (index + 1), price };
    bars[1] = foldPrice(bars[1], quote, MINUTE) ?? bars[1];
  }
  assert.equal(bars[1].close, 1.1023);
  assert.equal(bars[1].high, 1.1023);
  assert.equal(bars[1].open, 1.1);
  // A poll that saw only the first quotes does not drag the candle back.
  assert.equal(mergeLiveBar(bars, bar(open, 1.1015), quote, MINUTE), 'replaced');
  assert.equal(bars[1].close, 1.1023);
  assert.equal(bars.length, 2);
});

test('quotes outside the bar in progress wait for the source', () => {
  const current = bar(open, 1.101);
  assert.equal(foldPrice(current, { time: open + MINUTE, price: 1.2 }, MINUTE), null, 'the next bar opens from the source');
  assert.equal(foldPrice(current, { time: open - 1, price: 1.2 }, MINUTE), null, 'a stale snapshot quote is ignored');
  assert.equal(foldPrice(current, { time: open + 5, price: 0 }, MINUTE), null);
  assert.equal(foldPrice(current, null, MINUTE), null);
  assert.equal(foldPrice(current, { time: open + 5, price: 1.101 }, MINUTE), null, 'an unchanged price is not a change');
});

test('a new bar from the source takes a quote already inside its period', () => {
  const bars = [bar(open, 1.101)];
  assert.equal(mergeLiveBar(bars, bar(open + MINUTE, 1.102), { time: open + MINUTE + 500, price: 1.103 }, MINUTE), 'appended');
  assert.equal(bars[1].close, 1.103);
  assert.equal(mergeLiveBar(bars, bar(open, 1.2), null, MINUTE), null, 'an older bar is dropped');
  assert.equal(bars.length, 2);
});

test('monthly bars run to the end of the calendar month', () => {
  const month = 30 * 86_400_000;
  const january = bar(Date.UTC(2026, 0, 1), 1.1);
  assert.ok(foldPrice(january, { time: Date.UTC(2026, 0, 31, 23), price: 1.2 }, month));
  assert.equal(foldPrice(january, { time: Date.UTC(2026, 1, 1), price: 1.2 }, month), null);
});
