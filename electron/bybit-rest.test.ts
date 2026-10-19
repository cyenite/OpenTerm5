import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { BybitApiError, BybitRest, queryString } from './bybit-rest';

const key = { apiKey: 'fixture-key', apiSecret: 'fixture-secret' };

function recorder(answers: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer));
  };
  return { calls, fetch };
}

test('signed requests sign timestamp, key, receive window and the exact query or body', async () => {
  const { calls, fetch } = recorder([{ retCode: 0, retMsg: 'OK', result: { list: [] } }, { retCode: 0, retMsg: 'OK', result: { orderId: 'x' } }]);
  const rest = new BybitRest('https://api.example', key, fetch, () => 1_700_000_000_000);
  await rest.get('/v5/order/realtime', { category: 'linear', symbol: 'BTCUSDT', cursor: undefined }, true);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(calls[0].url, 'https://api.example/v5/order/realtime?category=linear&symbol=BTCUSDT');
  assert.equal(headers['X-BAPI-SIGN'], createHmac('sha256', key.apiSecret).update(`1700000000000${key.apiKey}5000category=linear&symbol=BTCUSDT`).digest('hex'));
  await rest.post('/v5/order/create', { category: 'linear', qty: '0.01' });
  const posted = calls[1].init.headers as Record<string, string>;
  assert.equal(posted['X-BAPI-SIGN'], createHmac('sha256', key.apiSecret).update(`1700000000000${key.apiKey}5000{"category":"linear","qty":"0.01"}`).digest('hex'));
  assert.equal(calls[1].init.body, '{"category":"linear","qty":"0.01"}');
});

test('a rejected timestamp resyncs the clock and retries a read once, never a write', async () => {
  const rejected = { retCode: 10002, retMsg: 'time window', result: {} };
  const { calls, fetch } = recorder([rejected, { retCode: 0, retMsg: 'OK', result: { timeNano: '1700000005000000000' } }, { retCode: 0, retMsg: 'OK', result: { ok: true } }, rejected]);
  const rest = new BybitRest('https://api.example', key, fetch, () => 1_700_000_000_000);
  assert.deepEqual(await rest.get('/v5/account/info', {}, true), { ok: true });
  assert.equal((calls[2].init.headers as Record<string, string>)['X-BAPI-TIMESTAMP'], '1700000005000');
  await assert.rejects(rest.post('/v5/order/create', {}), (error) => error instanceof BybitApiError && error.code === 10002);
  assert.equal(calls.length, 4);
});

test('error codes become readable messages and network failures stay distinct', async () => {
  const { fetch } = recorder([{ retCode: 10003, retMsg: 'API key is invalid.', result: {} }, new Error('ECONNRESET')]);
  const rest = new BybitRest('https://api.example', key, fetch);
  await assert.rejects(rest.get('/v5/user/query-api', {}, true), /chosen environment/);
  await assert.rejects(rest.get('/v5/user/query-api', {}, true), (error) => !(error instanceof BybitApiError) && /could not be reached/.test((error as Error).message));
});

test('query strings drop empty values', () => {
  assert.equal(queryString({ category: 'linear', symbol: '', limit: 50, cursor: undefined, openOnly: 0 }), 'category=linear&limit=50&openOnly=0');
});
