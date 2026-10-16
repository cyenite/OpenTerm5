import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { JournalingApiError, JournalingClient, retryAfterMs, signRequest } from './journaling-http';

interface Sent {
  url: string;
  init: RequestInit;
}

function fakeFetch(replies: Response[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('No reply queued');
    return reply;
  };
  return { sent, fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const credentials = { key: 'tsk_test', secret: 'tss_secret' };

test('signature is HMAC-SHA256 of timestamp, a dot and the raw body, as Tradescribe documents', () => {
  const body = '{"id":"order-123"}';
  const expected = createHmac('sha256', 'tss_secret').update(`1790790000.${body}`).digest('hex');
  assert.equal(signRequest('tss_secret', '1790790000', body), `sha256=${expected}`);
  assert.equal(signRequest('tss_secret', '1790790000', ''), `sha256=${createHmac('sha256', 'tss_secret').update('1790790000.').digest('hex')}`);
});

test('signed requests carry the key, a seconds timestamp and the signature of the exact bytes sent, never the secret', async () => {
  const { sent, fetch } = fakeFetch([json(200, { data: { ok: true } }, { etag: '"abc"' })]);
  const client = new JournalingClient('https://tradescribe.io', () => credentials, fetch, () => 1_790_790_000_500);
  const reply = await client.request<{ ok: boolean }>({ method: 'PATCH', path: '/trades/a%7Cb', body: { rating: 4 }, etag: '"old"' });
  assert.deepEqual(reply, { data: { ok: true }, etag: '"abc"' });
  const [{ url, init }] = sent;
  const headers = init.headers as Record<string, string>;
  assert.equal(url, 'https://tradescribe.io/api/v1/trades/a%7Cb');
  assert.equal(init.body, '{"rating":4}');
  assert.equal(headers['x-tradescribe-key'], 'tsk_test');
  assert.equal(headers['x-tradescribe-timestamp'], '1790790000');
  assert.equal(headers['x-tradescribe-signature'], signRequest('tss_secret', '1790790000', '{"rating":4}'));
  assert.equal(headers['if-match'], '"old"');
  assert.ok(!JSON.stringify(init).includes('tss_secret'));
});

test('public connect requests are not signed and queries are encoded', async () => {
  const { sent, fetch } = fakeFetch([json(200, { data: [] })]);
  const client = new JournalingClient('http://localhost:3000', () => null, fetch);
  await client.request({ path: '/connect/preview', method: 'POST', body: { code: 'ABCD-EFGH' }, isPublic: true, query: { from: '2026-10-15', limit: 100, skip: undefined } });
  const headers = sent[0].init.headers as Record<string, string>;
  assert.equal(sent[0].url, 'http://localhost:3000/api/v1/connect/preview?from=2026-10-15&limit=100');
  assert.equal(headers['x-tradescribe-key'], undefined);
});

test('errors keep the code, upgrade link and Retry-After', async () => {
  const { fetch } = fakeFetch([
    json(429, { error: { code: 'rate_limited', message: 'Slow down' } }, { 'retry-after': '7' }),
    json(401, { error: { code: 'invalid_credentials', message: 'Revoked' } }),
    json(401, { error: { code: 'stale_signature', message: 'Old' } }),
    json(402, { error: { code: 'plan_limit', message: 'Limit', upgradeUrl: 'https://tradescribe.io/billing' } }),
  ]);
  const client = new JournalingClient('https://tradescribe.io', () => credentials, fetch);
  const failure = (): Promise<JournalingApiError> => client.request({ path: '/me' }).then(() => assert.fail('expected an error'), (error: JournalingApiError) => error);
  const limited = await failure();
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfterMs, 7000);
  const revoked = await failure();
  assert.equal(revoked.isAuthLost, true);
  const stale = await failure();
  assert.equal(stale.isAuthLost, false);
  assert.match(stale.message, /clock/);
  const capped = await failure();
  assert.equal(capped.upgradeUrl, 'https://tradescribe.io/billing');
});

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs('soon'), null);
});

test('a request without credentials fails before reaching the network', async () => {
  const { sent, fetch } = fakeFetch([]);
  const client = new JournalingClient('https://tradescribe.io', () => null, fetch);
  await assert.rejects(client.request({ path: '/me' }), /not connected/);
  assert.equal(sent.length, 0);
});
