import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { decodePairing, type HubEventMessage, type HubReady, type HubScope } from '../../shared/hub';
import { fromBase64Url } from '../../shared/hub-session';
import { nodeHubCrypto } from '../../electron/hub-crypto';
import { HubDevices, emptyHubFile, type HubFile } from '../../electron/hub-devices';
import { HubServer, type HubCaller } from '../../electron/hub-server';
import { browserHubCrypto } from './hub-crypto';
import { HubClient, newPairing, type HubState, type StoredPairing } from './hub-client';

const cipher = { canEncrypt: () => true, encrypt: (value: string) => `enc:${value}`, decrypt: (value: string) => value.slice(4) };
const servers: HubServer[] = [];
const clients: HubClient[] = [];
after(async () => {
  for (const client of clients) client.close();
  for (const server of servers) await server.stop();
});

async function setup(webRoot: string | null = null) {
  let file: HubFile = emptyHubFile();
  const devices = new HubDevices({ load: async () => file, save: async (next) => { file = next; } }, cipher, nodeHubCrypto);
  await devices.init();
  const calls: { api: string; method: string; params: unknown; caller: HubCaller }[] = [];
  const watching = new Set<string>();
  const server = new HubServer({
    devices, crypto: nodeHubCrypto, version: '0.0.0-test', webRoot, hubName: () => 'Desk',
    call: async (caller, api, method, params) => {
      calls.push({ api, method, params, caller });
      return { echoed: method };
    },
    wants: (connectionId, _api, event, data) => event !== 'tick' || watching.has(`${connectionId}:${(data as { symbol: string }).symbol}`),
    closed: () => undefined,
    journal: () => undefined,
  });
  servers.push(server);
  await server.apply({ port: 0, isEnabled: true });
  assert.equal(server.isRunning, true);
  const address = `127.0.0.1:${server.boundPort}`;
  return { devices, server, calls, address, watching, file: () => file };
}

function connect(pairing: StoredPairing, token?: Uint8Array) {
  const states: { state: HubState; detail: string | null }[] = [];
  const events: HubEventMessage[] = [];
  let ready: HubReady | undefined;
  let settle: (value: HubState) => void;
  const settled = new Promise<HubState>((resolve) => { settle = resolve; });
  const client = new HubClient({
    name: 'Test phone', crypto: browserHubCrypto, pairing, token,
    onState: (state, detail) => {
      states.push({ state, detail });
      if (state !== 'connecting') settle(state);
    },
    onEvent: (message) => events.push(message),
    onReady: (value) => { ready = value; },
  });
  clients.push(client);
  client.start();
  return { client, states, events, settled, ready: () => ready };
}

async function pair(hub: Awaited<ReturnType<typeof setup>>, scope: HubScope) {
  const offer = hub.devices.createOffer(scope, 'Desk', [hub.address]);
  const pairing = await newPairing(browserHubCrypto, { key: offer.key, name: offer.name, scope, addresses: offer.addresses });
  const phone = connect(pairing, fromBase64Url(offer.token));
  assert.equal(await phone.settled, 'ready');
  return { pairing, phone };
}

const until = async (check: () => boolean) => {
  for (let index = 0; index < 100 && !check(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check());
};

test('a phone pairs with a code, then reconnects with its own key alone', async () => {
  const hub = await setup();
  const { pairing, phone } = await pair(hub, 'view');
  assert.equal(phone.ready()?.device.scope, 'view');
  assert.equal(phone.ready()?.device.name, 'Test phone');
  assert.equal(hub.devices.devices.length, 1);
  assert.equal(hub.devices.activeOffer(), null);
  assert.equal(hub.file().devices.length, 1);
  assert.match(hub.file().hubKey!.privateKey, /^enc:/);
  phone.client.close();
  const again = connect(pairing);
  assert.equal(await again.settled, 'ready');
  assert.equal(again.ready()?.device.id, phone.ready()?.device.id);
});

test('the scope decides what a phone may call, and unlisted methods never reach the computer', async () => {
  const hub = await setup();
  const { phone } = await pair(hub, 'view');
  assert.deepEqual(await phone.client.request('terminal', 'rates.get', { symbol: 'EURUSD' }), { echoed: 'rates.get' });
  await assert.rejects(phone.client.request('terminal', 'order.send', { action: 'deal' }), /can only view charts/);
  await assert.rejects(phone.client.request('terminal', 'account.login', {}), /not available from a phone/);
  await assert.rejects(phone.client.request('automation', 'copier.save', {}), /not available from a phone/);
  assert.deepEqual(hub.calls.map((call) => call.method), ['rates.get']);
  await hub.devices.setScope(phone.ready()!.device.id, 'trade');
  assert.deepEqual(await phone.client.request('terminal', 'order.send', { action: 'deal' }), { echoed: 'order.send' });
});

test('a spent or wrong code is refused, and a guessed code stops working', async () => {
  const hub = await setup();
  const offer = hub.devices.createOffer('trade', 'Desk', [hub.address]);
  const pairing = await newPairing(browserHubCrypto, { key: offer.key, name: offer.name, scope: 'trade', addresses: offer.addresses });
  const wrong = connect(pairing, nodeHubCrypto.random(16));
  assert.equal(await wrong.settled, 'refused');
  assert.equal(hub.devices.devices.length, 0);
  hub.devices.cancelOffer();
  const late = connect(pairing, fromBase64Url(offer.token));
  assert.equal(await late.settled, 'refused');
  assert.match(late.states.at(-1)!.detail!, /expired/);
});

test('an unknown phone is told it is not paired', async () => {
  const hub = await setup();
  const offer = hub.devices.createOffer('view', 'Desk', [hub.address]);
  const stranger = await newPairing(browserHubCrypto, { key: offer.key, name: 'Desk', scope: 'view', addresses: [hub.address] });
  const phone = connect(stranger);
  assert.equal(await phone.settled, 'refused');
  assert.match(phone.states.at(-1)!.detail!, /no longer paired/);
});

test('unpairing on the computer disconnects the phone for good', async () => {
  const hub = await setup();
  const { phone } = await pair(hub, 'view');
  await hub.devices.revoke(phone.ready()!.device.id);
  hub.server.drop(phone.ready()!.device.id);
  await until(() => phone.states.at(-1)?.state === 'refused');
});

test('events reach only the phones that want them, ticks coalesced to the latest', async () => {
  const hub = await setup();
  const { phone } = await pair(hub, 'view');
  const [connectionId] = [...(hub.server as unknown as { connections: Map<string, unknown> }).connections.keys()];
  hub.watching.add(`${connectionId}:EURUSD`);
  hub.server.broadcast('terminal', 'tick', { symbol: 'EURUSD', bid: 1 });
  hub.server.broadcast('terminal', 'tick', { symbol: 'EURUSD', bid: 2 });
  hub.server.broadcast('terminal', 'tick', { symbol: 'GBPUSD', bid: 3 });
  hub.server.broadcast('terminal', 'accountChanged', { id: null });
  await until(() => phone.events.length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(phone.events.map((event) => [event.event, event.data]), [['tick', { symbol: 'EURUSD', bid: 2 }], ['accountChanged', { id: null }]]);
});

test('the computer serves the phone app with a strict policy and nothing outside it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-web-'));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'mobile.html'), '<!doctype html><title>Phone</title>');
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'export {}');
  await fs.writeFile(path.join(root, 'index.html'), 'desktop');
  const hub = await setup(root);
  const page = await fetch(`http://${hub.address}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', new RegExp(`connect-src 'self' ws://${hub.address.replace(/\./g, '\\.')}`));
  assert.equal((await fetch(`http://${hub.address}/assets/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`http://${hub.address}/index.html`)).status, 404);
  assert.equal((await fetch(`http://${hub.address}/assets/..%2findex.html`)).status, 404);
  assert.equal((await fetch(`http://${hub.address}/`, { method: 'POST' })).status, 405);
});

test('pairing links from the desktop decode on the phone', async () => {
  const hub = await setup();
  const offer = hub.devices.createOffer('trade', 'Desk', [hub.address]);
  const { expiresAt, ...payload } = offer;
  assert.ok(expiresAt > Date.now());
  const { encodePairing } = await import('../../shared/hub');
  assert.deepEqual(decodePairing(encodePairing(payload)), payload);
});

test('a scope change reconnects the phone with its new access', async () => {
  const hub = await setup();
  const { phone } = await pair(hub, 'trade');
  const id = phone.ready()!.device.id;
  await hub.devices.setScope(id, 'view');
  hub.server.refresh(hub.devices.get(id)!);
  await until(() => phone.ready()?.device.scope === 'view');
  await assert.rejects(phone.client.request('terminal', 'order.send', {}), /can only view/);
});

test('pairing codes leave out container and virtual machine bridges', async () => {
  const { lanAddresses } = await import('../../electron/hub-server');
  const item = (address: string) => ({ address, family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }) as const;
  const addresses = lanAddresses(8788, { docker0: [item('172.17.0.1')], 'br-1a2b': [item('172.18.0.1')], tailscale0: [item('100.101.1.2')], wlan0: [item('192.168.1.20')], lo: [{ ...item('127.0.0.1'), internal: true }] });
  assert.deepEqual(addresses, ['192.168.1.20:8788', '100.101.1.2:8788']);
});
