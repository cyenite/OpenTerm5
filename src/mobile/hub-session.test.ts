import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserHubCrypto } from './hub-crypto';
import { acceptDevice, HubChannel, HubHandshakeError, parseHello, refusal, startDeviceHandshake, type HubCrypto, type HubKeys } from '../../shared/hub-session';
import { decodePairing, encodePairing, hubMethodScope } from '../../shared/hub';
import { nodeHubCrypto } from '../../electron/hub-crypto';

async function connect(hubCrypto: HubCrypto, deviceCrypto: HubCrypto, options: { token?: Uint8Array; hubToken?: Uint8Array | null; pinnedKey?: Uint8Array } = {}) {
  const hub = await hubCrypto.generateKeyPair();
  const device = await deviceCrypto.generateKeyPair();
  const handshake = await startDeviceHandshake(deviceCrypto, device, options.pinnedKey ?? hub.publicKey, options.token);
  const accepted = await acceptDevice(hubCrypto, hub, handshake.hello, options.hubToken === undefined ? options.token ?? null : options.hubToken);
  const deviceKeys = await handshake.finish(accepted.reply);
  return { hub, device, accepted, deviceKeys };
}

function wire(hubCrypto: HubCrypto, deviceCrypto: HubCrypto, hubKeys: HubKeys, deviceKeys: HubKeys) {
  const toHub: Uint8Array[] = [];
  const toDevice: Uint8Array[] = [];
  return {
    toHub, toDevice,
    hub: new HubChannel(hubCrypto, hubKeys, (frame) => toDevice.push(frame)),
    device: new HubChannel(deviceCrypto, deviceKeys, (frame) => toHub.push(frame)),
  };
}

const pairs = [['node hub, browser phone', nodeHubCrypto, browserHubCrypto], ['browser hub, node phone', browserHubCrypto, nodeHubCrypto]] as const;

for (const [name, hubCrypto, deviceCrypto] of pairs) {
  test(`${name}: both ends derive the same keys and exchange messages`, async () => {
    const { accepted, deviceKeys, device } = await connect(hubCrypto, deviceCrypto);
    assert.deepEqual(accepted.keys.receiveKey, deviceKeys.sendKey);
    assert.deepEqual(accepted.keys.sendKey, deviceKeys.receiveKey);
    assert.deepEqual(accepted.deviceKey, device.publicKey);
    const link = wire(hubCrypto, deviceCrypto, accepted.keys, deviceKeys);
    await link.device.send({ kind: 'auth', name: 'Phone' });
    await link.device.send({ kind: 'request', id: 1 });
    assert.deepEqual(await link.hub.receive(link.toHub[0]), { kind: 'auth', name: 'Phone' });
    assert.deepEqual(await link.hub.receive(link.toHub[1]), { kind: 'request', id: 1 });
    await link.hub.send({ kind: 'ready' });
    assert.deepEqual(await link.device.receive(link.toDevice[0]), { kind: 'ready' });
  });
}

test('a pairing hello needs the token from the link', async () => {
  const token = nodeHubCrypto.random(16);
  const paired = await connect(nodeHubCrypto, browserHubCrypto, { token });
  assert.deepEqual(paired.accepted.keys.receiveKey, paired.deviceKeys.sendKey);
  const guessed = await connect(nodeHubCrypto, browserHubCrypto, { token, hubToken: nodeHubCrypto.random(16) });
  assert.notDeepEqual(guessed.accepted.keys.receiveKey, guessed.deviceKeys.sendKey);
  const link = wire(nodeHubCrypto, browserHubCrypto, guessed.accepted.keys, guessed.deviceKeys);
  await link.device.send({ kind: 'auth', name: 'Phone' });
  await assert.rejects(link.hub.receive(link.toHub[0]));
});

test('a phone talking to a computer other than the paired one cannot read its replies', async () => {
  const impostor = await nodeHubCrypto.generateKeyPair();
  const { accepted, deviceKeys } = await connect(nodeHubCrypto, browserHubCrypto, { pinnedKey: impostor.publicKey });
  const link = wire(nodeHubCrypto, browserHubCrypto, accepted.keys, deviceKeys);
  await link.hub.send({ kind: 'ready' });
  await assert.rejects(link.device.receive(link.toDevice[0]));
});

test('replayed, reordered and altered frames fail to open', async () => {
  const { accepted, deviceKeys } = await connect(nodeHubCrypto, browserHubCrypto);
  const replay = wire(nodeHubCrypto, browserHubCrypto, accepted.keys, deviceKeys);
  await replay.device.send({ id: 1 });
  await replay.device.send({ id: 2 });
  assert.deepEqual(await replay.hub.receive(replay.toHub[0]), { id: 1 });
  await assert.rejects(replay.hub.receive(replay.toHub[0]));

  const reorder = wire(nodeHubCrypto, browserHubCrypto, accepted.keys, deviceKeys);
  await reorder.device.send({ id: 1 });
  await reorder.device.send({ id: 2 });
  await assert.rejects(reorder.hub.receive(reorder.toHub[1]));

  const alter = wire(nodeHubCrypto, browserHubCrypto, accepted.keys, deviceKeys);
  await alter.device.send({ id: 1 });
  const frame = alter.toHub[0].slice();
  frame[0] ^= 1;
  await assert.rejects(alter.hub.receive(frame));
});

test('the phone reports why the computer refused it', async () => {
  const hub = await nodeHubCrypto.generateKeyPair();
  const device = await browserHubCrypto.generateKeyPair();
  const handshake = await startDeviceHandshake(browserHubCrypto, device, hub.publicKey);
  await assert.rejects(handshake.finish(refusal('unknown')), (error: Error) => error instanceof HubHandshakeError && /no longer paired/.test(error.message));
});

test('hellos with malformed or low-order keys are refused', async () => {
  assert.throws(() => parseHello('{"t":"hello","v":1,"device":"abc","ephemeral":"abc"}'), HubHandshakeError);
  assert.throws(() => parseHello('{"t":"hello","v":2}'), (error: HubHandshakeError) => error.reason === 'version');
  const hub = await nodeHubCrypto.generateKeyPair();
  const zero = 'A'.repeat(43);
  await assert.rejects(acceptDevice(browserHubCrypto, hub, JSON.stringify({ t: 'hello', v: 1, device: zero, ephemeral: zero, isPairing: false }), null));
});

test('pairing links round-trip and reject damage', () => {
  const payload = { v: 1, key: 'k'.repeat(43), name: 'Desk', token: 't'.repeat(22), scope: 'trade', addresses: ['192.168.1.5:8788'] } as const;
  assert.deepEqual(decodePairing(encodePairing(payload)), payload);
  assert.throws(() => decodePairing('not-a-link'), /damaged|supported/);
  assert.throws(() => decodePairing(encodePairing({ ...payload, scope: 'admin' as never })), /supported/);
});

test('only listed methods reach the computer, each with its scope', () => {
  assert.equal(hubMethodScope('terminal', 'order.send'), 'trade');
  assert.equal(hubMethodScope('terminal', 'rates.get'), 'view');
  assert.equal(hubMethodScope('terminal', 'account.login'), null);
  assert.equal(hubMethodScope('terminal', 'accounts.connect'), null);
  assert.equal(hubMethodScope('automation', 'copier.save'), null);
  assert.equal(hubMethodScope('automation', 'manager.setGuard'), null);
  assert.equal(hubMethodScope('terminal', 'toString'), null);
  assert.equal(hubMethodScope('settings', 'save'), null);
});
