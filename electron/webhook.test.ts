import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { SignalRecord, WebhookSettings, WebhookSource } from '../shared/automation';
import { FakeLink, memoryStore, position } from './automation-fixtures';
import { SessionPool } from './session-pool';
import { SignalExecutor } from './signal-executor';
import { SignalOwnership, type OwnedTickets } from './signal-ownership';
import { TradeManager, type ManagerState } from './trade-manager';
import { WebhookServer, signBody } from './webhook-server';

const ACCOUNT = 'wss://fake|1';

function source(patch: Partial<WebhookSource> = {}): WebhookSource {
  return {
    id: 'src-token-1', name: 'TradingView', auth: 'token', secret: 'correct horse battery staple', accountId: ACCOUNT,
    sizing: { mode: 'percentBalance', value: 1, maxLots: 5 }, symbolMap: {}, symbolSuffix: '', allowedSymbols: [], allowedActions: [],
    maxPerMinute: 30, createdAt: 0, isEnabled: true, isDryRun: false, isStopRequired: false, ...patch,
  };
}

const servers: WebhookServer[] = [];
after(async () => { for (const server of servers) await server.stop(); });

async function setup(settings: Partial<WebhookSettings> = {}) {
  const link = new FakeLink();
  const pool = new SessionPool(link, () => undefined, () => new FakeLink());
  pool.afterUiChange(ACCOUNT, null);
  const manager = new TradeManager(pool, memoryStore<ManagerState>({ rules: [], guards: [], guardStates: [] }), () => {});
  await manager.init();
  const ownership = new SignalOwnership(memoryStore<OwnedTickets>({}));
  const executor = new SignalExecutor(pool, manager, ownership);
  const records: SignalRecord[] = [];
  const server = new WebhookServer({ execute: (item, signal) => executor.execute(item, signal), append: (record) => records.push(record) });
  servers.push(server);
  const status = await server.apply({ host: '127.0.0.1', port: 0, sources: [source(), source({ id: 'src-hmac-1', auth: 'hmac', secret: 'hmac secret', sizing: { mode: 'signal', value: 0, maxLots: 2 } })], isEnabled: true, isPaused: false, ...settings });
  assert.equal(status.isRunning, true);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${status.url}${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
  return { link, server, records, status, post, manager, ownership };
}

test('a bearer-authenticated signal is sized by risk and executed', async () => {
  const { link, post, ownership } = await setup();
  const response = await post('/v1/signals?wait=1', { action: 'buy', symbol: 'EURUSD', sl_pips: 50, id: 'x1' }, { authorization: 'Bearer correct horse battery staple' });
  assert.equal(response.status, 200);
  const record = await response.json() as SignalRecord;
  assert.equal(record.status, 'executed');
  assert.equal(link.sent[0].volume, 0.2);
  assert.equal(link.sent[0].comment, '', 'entries carry no OpenTerm5 tag');
  assert.equal(await ownership.owns('src-token-1', link.positions[0].ticket), true);
  assert.equal('secret' in record.payload, false);
});

test('TradingView route accepts the secret in the body and never echoes it', async () => {
  const { link, post, records } = await setup();
  const response = await post('/v1/hooks/src-token-1', { secret: 'correct horse battery staple', action: 'sell', ticker: 'FX:EURUSD', sl_points: 300 });
  assert.equal(response.status, 202);
  const { id } = await response.json() as { id: string };
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(link.sent[0].type, 'sell');
  assert.equal(records.at(-1)!.id, id);
  assert.ok(!JSON.stringify(records).includes('battery'));
});

test('wrong secrets, unknown sources and missing auth are rejected', async () => {
  const { post, link } = await setup();
  assert.equal((await post('/v1/signals', { action: 'buy', symbol: 'EURUSD' }, { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await post('/v1/signals', { action: 'buy', symbol: 'EURUSD' })).status, 401);
  assert.equal((await post('/v1/hooks/src-hmac-1', { secret: 'hmac secret', action: 'buy', symbol: 'EURUSD' })).status, 401, 'HMAC sources do not accept body secrets');
  assert.equal(link.sent.length, 0);
});

test('HMAC signatures are verified with a replay window', async () => {
  const { post, link } = await setup();
  const body = JSON.stringify({ action: 'buy', symbol: 'EURUSD', volume: 0.3 });
  const now = Math.floor(Date.now() / 1000);
  const ok = await post('/v1/signals?wait=1', body, { 'x-openterm-source': 'src-hmac-1', 'x-openterm-timestamp': String(now), 'x-openterm-signature': signBody('hmac secret', now, body) });
  assert.equal(ok.status, 200);
  assert.equal(link.sent[0].volume, 0.3);
  const stale = now - 600;
  assert.equal((await post('/v1/signals', body, { 'x-openterm-source': 'src-hmac-1', 'x-openterm-timestamp': String(stale), 'x-openterm-signature': signBody('hmac secret', stale, body) })).status, 401);
  const legacyBody = JSON.stringify({ action: 'buy', symbol: 'EURUSD', volume: 0.2 });
  const legacy = await post('/v1/signals?wait=1', legacyBody, { 'x-t5-source': 'src-hmac-1', 'x-t5-timestamp': String(now), 'x-t5-signature': signBody('hmac secret', now, legacyBody) });
  assert.equal(legacy.status, 200, 'pre-rename X-T5-* headers are still accepted');
  assert.equal((await post('/v1/signals', body.replace('0.3', '3'), { 'x-t5-source': 'src-hmac-1', 'x-t5-timestamp': String(now), 'x-t5-signature': signBody('hmac secret', now, body) })).status, 401, 'tampered body');
});

test('duplicate ids are answered without trading twice', async () => {
  const { post, link } = await setup();
  const headers = { authorization: 'Bearer correct horse battery staple' };
  await post('/v1/signals?wait=1', { action: 'buy', symbol: 'EURUSD', sl_pips: 50, id: 'same' }, headers);
  const second = await post('/v1/signals?wait=1', { action: 'buy', symbol: 'EURUSD', sl_pips: 50, id: 'same' }, headers);
  assert.equal(((await second.json()) as { status: string }).status, 'duplicate');
  assert.equal(link.sent.length, 1);
});

test('rate limit, kill switch and validation errors use the right status codes', async () => {
  const { post, server, link } = await setup();
  const headers = { authorization: 'Bearer correct horse battery staple' };
  assert.equal((await post('/v1/signals', { action: 'explode', symbol: 'EURUSD' }, headers)).status, 422);
  assert.equal((await post('/v1/signals', '{broken', headers)).status, 400);
  await server.apply({ host: '127.0.0.1', port: 0, sources: [source({ maxPerMinute: 1 })], isEnabled: true, isPaused: true });
  assert.equal((await post('/v1/signals', { action: 'close_all' }, headers)).status, 503);
  assert.equal((await post('/v1/signals', { action: 'close_all' }, headers)).status, 429);
  assert.equal(link.sent.length, 0);
});

test('repeated authentication failures lock the caller out', async () => {
  const { post } = await setup();
  for (let index = 0; index < 20; index++) await post('/v1/signals', { action: 'buy', symbol: 'EURUSD' }, { authorization: 'Bearer wrong' });
  assert.equal((await post('/v1/signals', { action: 'buy', symbol: 'EURUSD' }, { authorization: 'Bearer correct horse battery staple' })).status, 429);
});

test('close only touches positions opened by the source unless scope is symbol', async () => {
  const { post, link, ownership } = await setup();
  link.positions = [position({ ticket: 1 }), position({ ticket: 2, comment: 'manual' })];
  await ownership.add('src-token-1', [1, 77]);
  const headers = { authorization: 'Bearer correct horse battery staple' };
  const first = await (await post('/v1/signals?wait=1', { action: 'close', symbol: 'EURUSD' }, headers)).json() as SignalRecord;
  assert.equal(first.status, 'executed');
  assert.deepEqual(link.positions.map((item) => item.ticket), [2]);
  assert.equal(await ownership.owns('src-token-1', 77), false, 'tickets that no longer exist are forgotten');
  await post('/v1/signals?wait=1', { action: 'close', symbol: 'EURUSD', scope: 'symbol' }, headers);
  assert.equal(link.positions.length, 0);
});

test('source policies reject disallowed symbols, missing stops and unknown broker symbols', async () => {
  const { server, post, link } = await setup();
  await server.apply({ host: '127.0.0.1', port: 0, sources: [source({ allowedSymbols: ['EURUSD'], isStopRequired: true })], isEnabled: true, isPaused: false });
  const headers = { authorization: 'Bearer correct horse battery staple' };
  const blocked = await (await post('/v1/signals?wait=1', { action: 'buy', symbol: 'GBPUSD', sl_pips: 10 }, headers)).json() as SignalRecord;
  assert.equal(blocked.status, 'rejected');
  const noStop = await (await post('/v1/signals?wait=1', { action: 'buy', symbol: 'EURUSD' }, headers)).json() as SignalRecord;
  assert.match(noStop.message, /requires a stop loss/);
  assert.equal(link.sent.length, 0);
});

test('dry run sources plan but never send', async () => {
  const { server, post, link } = await setup();
  await server.apply({ host: '127.0.0.1', port: 0, sources: [source({ isDryRun: true })], isEnabled: true, isPaused: false });
  const record = await (await post('/v1/signals?wait=1', { action: 'buy', symbol: 'EURUSD', sl_pips: 50, tp_r: 2 }, { authorization: 'Bearer correct horse battery staple' })).json() as SignalRecord;
  assert.equal(record.status, 'dryRun');
  assert.match(record.message, /0.2 EURUSD/);
  assert.equal(link.sent.length, 0);
});

test('allowed symbols are checked against the broker symbol and never widen across instruments', async () => {
  const { server, post, link } = await setup();
  link.specs = { 'BRK.A': { ...link.specs.EURUSD, name: 'BRK.A' }, 'BRK.B': { ...link.specs.EURUSD, name: 'BRK.B' }, 'EURUSD.m': { ...link.specs.EURUSD, name: 'EURUSD.m' } };
  await server.apply({ host: '127.0.0.1', port: 0, sources: [source({ allowedSymbols: ['BRK.A', 'EURUSD'] })], isEnabled: true, isPaused: false });
  const headers = { authorization: 'Bearer correct horse battery staple' };
  const widened = await (await post('/v1/signals?wait=1', { action: 'buy', symbol: 'BRK.B', sl_pips: 10 }, headers)).json() as SignalRecord;
  assert.equal(widened.status, 'rejected');
  assert.match(widened.message, /BRK\.B is not in this source's allowed symbols/);
  assert.equal(link.sent.length, 0);
  const decorated = await (await post('/v1/signals?wait=1', { action: 'buy', symbol: 'EURUSD', sl_pips: 10 }, headers)).json() as SignalRecord;
  assert.equal(decorated.status, 'executed', decorated.message);
  assert.equal(link.sent[0]?.symbol, 'EURUSD.m');
});
