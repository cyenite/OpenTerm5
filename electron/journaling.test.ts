import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { JournalingEvent } from '../shared/journaling';
import type { History } from '../shared/protocol';
import type { PasswordCipher } from './account-registry';
import { account, deal } from './journaling-fixtures';
import { JournalingService } from './journaling';

const HOUR = 3_600_000;
const now = Date.UTC(2026, 9, 15, 12, 0, 0);

const cipher = (canEncrypt: boolean): PasswordCipher => ({
  canEncrypt: () => canEncrypt,
  encrypt: (value) => `enc:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.slice(4), 'base64').toString(),
});

type Handler = (body: unknown, headers: Record<string, string>) => Response;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function harness(options: { canEncrypt?: boolean; file?: string; history?: History } = {}) {
  const file = options.file ?? path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-journal-')), 'journaling.json');
  const routes = new Map<string, Handler>();
  const requests: { route: string; body: unknown; headers: Record<string, string> }[] = [];
  const events: { event: JournalingEvent; data: unknown }[] = [];
  const opened: string[] = [];
  const service = new JournalingService({
    file,
    cipher: cipher(options.canEncrypt ?? true),
    deviceName: 'test-box',
    now: () => now,
    send: (event, data) => { events.push({ event, data }); },
    journal: () => undefined,
    openExternal: async (url) => { opened.push(url); },
    history: async () => options.history ?? { deals: [], orders: [] },
    fetch: async (url, init) => {
      const route = `${init.method} ${new URL(url).pathname}`;
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ route, body, headers: init.headers as Record<string, string> });
      const handler = routes.get(route);
      return handler ? handler(body, init.headers as Record<string, string>) : json(404, { error: { code: 'not_found', message: route } });
    },
  });
  routes.set('POST /api/v1/connect/token', () => json(201, { data: { key: 'tsk_k', secret: 'tss_s', scopes: ['read', 'write', 'journal'], user: { id: 'u1', email: 'aaron@example.com', name: 'Aaron', plan: 'free' }, platform: { name: 'Tradescribe', url: 'https://tradescribe.io' } } }));
  routes.set('GET /api/v1/me', () => json(200, { data: { user: { id: 'u1', plan: 'free' }, usage: { monthlyTrades: { used: 3, limit: 20, resetsAt: '2026-11-01T00:00:00.000Z' } }, features: [] } }));
  await service.init();
  return { file, routes, requests, events, opened, service };
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), 'condition not reached');
}

const tick = (service: JournalingService, offsetMinutes: number) => {
  for (let index = 0; index < 3; index++) service.onTerminal('tick', { symbol: 'EURUSD', bid: 1, ask: 1, last: 0, volume: 0, time: now + offsetMinutes * 60_000 - 500 });
};

test('a pasted code is exchanged with the device and stored encrypted, never in plain text', async () => {
  const { file, requests, service } = await harness();
  const view = await service.handle('journaling.redeem', { code: 'abcd efgh' });
  assert.equal(view.isConnected, true);
  assert.equal(view.isStored, true);
  assert.equal(view.user?.email, 'aaron@example.com');
  const exchange = requests.find((request) => request.route === 'POST /api/v1/connect/token')!;
  const body = exchange.body as Record<string, unknown>;
  assert.equal(body.code, 'ABCD-EFGH');
  assert.equal(body.verifier, undefined);
  assert.equal(body.deviceName, 'test-box');
  assert.match(String(body.deviceId), /^[0-9a-f-]{36}$/);
  assert.equal(exchange.headers['x-tradescribe-key'], undefined);
  const saved = await fs.readFile(file, 'utf8');
  assert.ok(!saved.includes('tss_s') && !saved.includes('tsk_k'));
  await until(() => requests.some((request) => request.route === 'GET /api/v1/me'));
  assert.equal(requests.find((request) => request.route === 'GET /api/v1/me')!.headers['x-tradescribe-key'], 'tsk_k');
});

test('without a usable keychain the connection lives in memory and asks to reconnect after a restart', async () => {
  const first = await harness({ canEncrypt: false });
  const view = await first.service.handle('journaling.redeem', { code: 'ABCD-EFGH' });
  assert.equal(view.isConnected, true);
  assert.equal(view.isStored, false);
  assert.ok(!(await fs.readFile(first.file, 'utf8')).includes('tss_s'));
  const second = await harness({ canEncrypt: false, file: first.file });
  const restarted = second.service.view();
  assert.equal(restarted.isConnected, false);
  assert.equal(restarted.isReconnectNeeded, true);
  assert.match(restarted.error ?? '', /keychain/);
});

test('sync waits for the server clock, then sends the deals with the estimated offset', async () => {
  const { routes, requests, service } = await harness({ history: { deals: [deal(9001, now + 3 * HOUR - 60_000)], orders: [] } });
  const posted: unknown[] = [];
  routes.set('POST /api/v1/platforms/mt5/deals', (body) => { posted.push(body); return json(200, { data: { accountId: 'mt5-5012345-metaquotes-demo', inserted: 1, duplicates: 0, skipped: 0, skippedReasons: [], held: null, trades: [], usage: { monthlyTrades: { used: 4, limit: 20, resetsAt: '2026-11-01T00:00:00.000Z' } } } }); });
  await service.handle('journaling.redeem', { code: 'ABCD-EFGH' });
  service.setActive(account);
  await until(() => service.view().accounts[0]?.state === 'waiting');
  assert.equal(posted.length, 0);
  tick(service, 180);
  await until(() => service.view().accounts[0]?.state === 'synced');
  assert.equal((posted[0] as { serverTimeOffsetMinutes: number }).serverTimeOffsetMinutes, 180);
  const view = service.view();
  assert.equal(view.accounts[0].cursor, now + 3 * HOUR);
  assert.equal(view.usage?.monthlyTrades.used, 4);
  assert.ok(requests.every((request) => request.route.startsWith('POST /api/v1/connect') || request.headers['x-tradescribe-signature']?.startsWith('sha256=')));
});

test('a held sync keeps the cursor at held.fromTime', async () => {
  const fromTime = now + 3 * HOUR - 30_000;
  const { routes, service } = await harness({ history: { deals: [deal(1, now + 3 * HOUR - 60_000), deal(2, fromTime)], orders: [] } });
  routes.set('POST /api/v1/platforms/mt5/deals', () => json(200, { data: { accountId: 'a', inserted: 1, duplicates: 0, skipped: 0, skippedReasons: [], held: { fromTime, message: 'Free plan limit reached' }, trades: [] } }));
  await service.handle('journaling.redeem', { code: 'ABCD-EFGH' });
  tick(service, 180);
  service.setActive(account);
  tick(service, 180);
  await until(() => service.view().accounts[0]?.state === 'held');
  const [entry] = service.view().accounts;
  assert.equal(entry.cursor, fromTime);
  assert.equal(entry.message, 'Free plan limit reached');
  assert.equal(entry.retryAt, now + HOUR);
  service.shutdown();
});

test('a revoked key turns into a reconnect prompt', async () => {
  const { routes, service } = await harness({ history: { deals: [deal(1, now)], orders: [] } });
  routes.set('POST /api/v1/platforms/mt5/deals', () => json(401, { error: { code: 'invalid_credentials', message: 'Revoked' } }));
  await service.handle('journaling.redeem', { code: 'ABCD-EFGH' });
  service.setActive(account);
  tick(service, 0);
  await until(() => service.view().isReconnectNeeded);
  assert.equal(service.view().isConnected, false);
  assert.equal(service.view().accounts[0].state, 'failed');
});

test('a protocol link for another platform is refused; a matching one is previewed and needs confirmation', async () => {
  const { routes, requests, events, service } = await harness();
  await service.receiveLink('openterm5://journaling/connect?code=ABCD-EFGH&platform=https://evil.example');
  assert.match(service.view().error ?? '', /evil\.example/);
  assert.equal(requests.length, 0);
  assert.deepEqual(events.at(-1), { event: 'link', data: { error: service.view().error } });
  routes.set('POST /api/v1/connect/preview', () => json(200, { data: { user: { email: 'aaron@example.com', name: 'Aaron' }, expiresAt: '2026-10-15T12:10:00.000Z' } }));
  await service.receiveLink('openterm5://journaling/connect?code=ABCD-EFGH&platform=https://tradescribe.io');
  assert.equal(service.view().pendingLink?.email, 'aaron@example.com');
  assert.equal(service.view().isConnected, false);
  assert.ok(!requests.some((request) => request.route === 'POST /api/v1/connect/token'));
  await service.handle('journaling.confirmLink', {});
  assert.equal(service.view().isConnected, true);
  assert.equal(service.view().pendingLink, null);
});

test('disconnect revokes the key; changing the platform disconnects and resets cursors', async () => {
  const { routes, requests, service } = await harness();
  routes.set('DELETE /api/v1/keys/current', () => json(200, { data: { revoked: true } }));
  await service.handle('journaling.redeem', { code: 'ABCD-EFGH' });
  service.setActive(account);
  const view = await service.handle('journaling.setPlatform', { url: 'http://localhost:3000' });
  assert.ok(requests.some((request) => request.route === 'DELETE /api/v1/keys/current' && request.headers['x-tradescribe-key'] === 'tsk_k'));
  assert.equal(view.isConnected, false);
  assert.equal(view.platformUrl, 'http://localhost:3000');
  await assert.rejects(service.handle('journaling.setPlatform', { url: 'http://example.com' }), /https/);
});

test('links open only on the configured platform', async () => {
  const { opened, service } = await harness();
  await service.handle('journaling.open', { kind: 'link', link: 'calendar' });
  await service.handle('journaling.open', { kind: 'trade', url: 'https://tradescribe.io/trades/abc' });
  await service.handle('journaling.open', { kind: 'day', date: '2026-10-15' });
  await service.handle('journaling.open', { kind: 'upgrade' });
  assert.deepEqual(opened, ['https://tradescribe.io/calendar', 'https://tradescribe.io/trades/abc', 'https://tradescribe.io/journal/2026-10-15', 'https://tradescribe.io/billing']);
  await assert.rejects(service.handle('journaling.open', { kind: 'trade', url: 'https://evil.example/trades/abc' }), /not on the journaling platform/);
});
