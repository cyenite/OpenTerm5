import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HyperliquidInfo, WeightBudget } from './hyperliquid-rest';

test('a request waits for weight to refill instead of exceeding the minute budget', async () => {
  let now = 0;
  const waits: number[] = [];
  const budget = new WeightBudget(1200, () => now, async (ms) => { waits.push(ms); now += ms; });
  await budget.take(1000);
  await budget.take(200);
  assert.deepEqual(waits, []);
  budget.spend(40);
  await budget.take(20);
  // 60 weight short at 20 weight a second.
  assert.deepEqual(waits, [3000]);
});

test('candleSnapshot posts its range under req and pays for the candles returned', async () => {
  const bodies: unknown[] = [];
  let now = 0;
  const budget = new WeightBudget(1200, () => now, async (ms) => { now += ms; });
  const candles = Array.from({ length: 600 }, (_, index) => ({ t: index * 60_000, o: '1', h: '1', l: '1', c: '1', v: '1', s: 'BTC', i: '1m' }));
  const info = new HyperliquidInfo('https://api.example', async (url, init) => {
    assert.equal(url, 'https://api.example/info');
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(candles));
  }, budget);
  assert.equal((await info.candles('BTC', '1m', 0, 36_000_000)).length, 600);
  assert.deepEqual(bodies, [{ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: 0, endTime: 36_000_000 } }]);
  // 20 for the request and 10 for 600 candles leaves 1170.
  await budget.take(1170);
  assert.equal(now, 0);
});

test('a refusal surfaces as an error with the answer', async () => {
  const info = new HyperliquidInfo('https://api.example', async () => new Response('bad coin', { status: 422 }));
  await assert.rejects(info.perpMeta(), /422: bad coin/);
});
