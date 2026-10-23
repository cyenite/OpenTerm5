import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Tick } from '../shared/protocol';
import { nodeHubCrypto } from './hub-crypto';
import { emptyHubFile, HubDevices, type HubFile } from './hub-devices';
import { BarInterest, TickInterest } from './hub-interest';

const tick = (symbol: string): Tick => ({ symbol, bid: 1, ask: 1, last: 0, time: 0, volume: 0 });

test('the link subscribes to the union of the window and every phone, the window first', async () => {
  const sent: string[][] = [];
  const interest = new TickInterest(async (symbols) => {
    sent.push(symbols);
    return symbols.map(tick);
  });
  await interest.set(null, ['EURUSD', 'GBPUSD']);
  const phone = await interest.set('phone', ['XAUUSD', 'EURUSD']);
  assert.deepEqual(sent.at(-1), ['EURUSD', 'GBPUSD', 'XAUUSD']);
  assert.deepEqual(phone.map((item) => item?.symbol), ['XAUUSD', 'EURUSD']);
  await interest.set(null, ['USDJPY']);
  assert.deepEqual(sent.at(-1), ['USDJPY', 'XAUUSD', 'EURUSD']);
  await interest.release('phone');
  assert.deepEqual(sent.at(-1), ['USDJPY']);
  assert.equal(interest.has('phone', 'XAUUSD'), false);
  await assert.rejects(interest.set('phone', 'EURUSD'), /Invalid/);
});

test('a phone releases only the bar subscriptions it made', () => {
  const bars = new BarInterest();
  bars.add('phone', 'EURUSD:H1');
  bars.add('phone', 'EURUSD:H1');
  assert.equal(bars.remove('phone', 'EURUSD:M5'), false);
  assert.equal(bars.remove('phone', 'EURUSD:H1'), true);
  assert.equal(bars.has('phone', 'EURUSD:H1'), true);
  assert.deepEqual(bars.release('phone'), ['EURUSD:H1']);
  assert.deepEqual(bars.release('phone'), []);
});

test('without secure storage the hub key and pairings are never written', async () => {
  let file: HubFile = emptyHubFile();
  const store = { load: async () => file, save: async (next: HubFile) => { file = next; } };
  const devices = new HubDevices(store, { canEncrypt: () => false, encrypt: () => { throw new Error('no'); }, decrypt: () => { throw new Error('no'); } }, nodeHubCrypto);
  await devices.init();
  devices.createOffer('view', 'Desk', ['10.0.0.2:8788']);
  await devices.pair(nodeHubCrypto.random(32), 'Phone');
  assert.equal(devices.devices.length, 1);
  assert.equal(file.hubKey, null);
  assert.deepEqual(file.devices, []);
});

test('an offer expires, and repeated failures cancel it', async () => {
  let now = 1_000;
  let file: HubFile = emptyHubFile();
  const devices = new HubDevices({ load: async () => file, save: async (next) => { file = next; } }, { canEncrypt: () => true, encrypt: (value) => value, decrypt: (value) => value }, nodeHubCrypto, () => now);
  await devices.init();
  devices.createOffer('view', 'Desk', ['10.0.0.2:8788']);
  now += 5 * 60_000;
  assert.equal(devices.activeOffer(), null);
  devices.createOffer('view', 'Desk', ['10.0.0.2:8788']);
  for (let index = 0; index < 5; index++) devices.failOffer();
  assert.equal(devices.activeOffer(), null);
  await assert.rejects(devices.pair(nodeHubCrypto.random(32), 'Phone'), /expired/);
});
