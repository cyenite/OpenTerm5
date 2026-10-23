import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import { BinanceApiError, BinanceRest, signer } from './binance-rest';

const key = { apiKey: 'fixture-key', apiSecret: 'fixture-secret' };

const failure = (status: number, body: unknown) => ({ isFailure: true, status, body });

function recorder(answers: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    const failed = answer as ReturnType<typeof failure>;
    if (failed?.isFailure) return new Response(JSON.stringify(failed.body), { status: failed.status });
    return new Response(JSON.stringify(answer));
  };
  return { calls, fetch };
}

test('HMAC signatures match the example in the Binance documentation', () => {
  const sign = signer('NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j');
  assert.equal(sign('symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'), 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
});

test('a PEM secret signs with Ed25519, and other key types are refused', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signature = signer(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())('symbol=BTCUSDT&timestamp=1');
  assert.ok(verify(null, Buffer.from('symbol=BTCUSDT&timestamp=1'), publicKey, Buffer.from(signature, 'base64')));
  const flattened = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, ' ');
  const fromField = signer(flattened)('symbol=BTCUSDT&timestamp=1');
  assert.ok(verify(null, Buffer.from('symbol=BTCUSDT&timestamp=1'), publicKey, Buffer.from(fromField, 'base64')), 'a key pasted into a one-line field still signs');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.throws(() => signer(rsa), /must be Ed25519/);
  assert.throws(() => signer('-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----'), /could not be read/);
});

test('signed requests carry the timestamp, receive window and signature in the query, with the key in a header', async () => {
  const { calls, fetch } = recorder([{ orderId: 1 }]);
  const rest = new BinanceRest('https://fapi.example', key, fetch, () => 1_700_000_000_000);
  await rest.post('/fapi/v1/order', { symbol: 'BTCUSDT', side: 'BUY', quantity: '0.010', price: undefined });
  const url = new URL(calls[0].url);
  const payload = 'symbol=BTCUSDT&side=BUY&quantity=0.010&recvWindow=5000&timestamp=1700000000000';
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(url.search, `?${payload}&signature=${signer(key.apiSecret)(payload)}`);
  assert.equal((calls[0].init.headers as Record<string, string>)['X-MBX-APIKEY'], 'fixture-key');
});

test('a rejected timestamp resyncs the clock and retries a read once, never a write', async () => {
  const rejected = failure(400, { code: -1021, msg: 'Timestamp for this request is outside of the recvWindow.' });
  const { calls, fetch } = recorder([rejected, { serverTime: 1_700_000_005_000 }, { ok: true }, rejected]);
  const rest = new BinanceRest('https://fapi.example', key, fetch, () => 1_700_000_000_000);
  assert.deepEqual(await rest.get('/fapi/v3/account', {}, true), { ok: true });
  assert.equal(new URL(calls[2].url).searchParams.get('timestamp'), '1700000005000');
  await assert.rejects(rest.post('/fapi/v1/order', {}), (error) => error instanceof BinanceApiError && error.code === -1021);
  assert.equal(calls.length, 4);
});

test('error codes become readable messages and network failures stay distinct', async () => {
  const { fetch } = recorder([failure(401, { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }), failure(429, {}), failure(503, { code: -1000, msg: 'Unknown error, please check your request or try again later.' }), new Error('ECONNRESET')]);
  const rest = new BinanceRest('https://fapi.example', key, fetch);
  await assert.rejects(rest.get('/fapi/v3/account', {}, true), /lacks the Futures permission/);
  await assert.rejects(rest.get('/fapi/v3/account', {}, true), /rate limit/);
  await assert.rejects(rest.post('/fapi/v1/order', {}), (error) => !(error instanceof BinanceApiError) && /did not say whether/.test((error as Error).message));
  await assert.rejects(rest.get('/fapi/v3/account', {}, true), (error) => !(error instanceof BinanceApiError) && /could not be reached/.test((error as Error).message));
});
