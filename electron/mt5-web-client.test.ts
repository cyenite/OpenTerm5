import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLoginPayload, Mt5WebClient, parseAccount } from './mt5-web-client';

test('password login uses the observed fixed offsets and exact unsigned account ID', () => {
  const identity = Buffer.alloc(16, 0x33);
  const payload = buildLoginPayload({ login: 9007199254740993n, password: 'demo', otp: '123456' }, identity);
  assert.equal(payload.length, 912);
  assert.equal(payload.readUInt32LE(0), 0);
  assert.equal(payload.subarray(4, 12).toString('utf16le'), 'demo');
  assert.equal(payload.subarray(68, 80).toString('utf16le'), '123456');
  assert.deepEqual(payload.subarray(196, 212), identity);
  assert.equal(payload.readUInt32LE(476), 0);
  assert.equal(payload.readBigUInt64LE(736), 9007199254740993n);
  assert.deepEqual(payload.subarray(744, 904), Buffer.alloc(160));
  assert.equal(payload.readBigUInt64LE(904), 0n);
});

test('login refuses silently truncated credentials and malformed identity', () => {
  assert.throws(() => buildLoginPayload({ login: 0n, password: 'demo' }, Buffer.alloc(16)), /positive/);
  assert.throws(() => buildLoginPayload({ login: 1n, password: 'x'.repeat(33) }, Buffer.alloc(16)), /32/);
  assert.throws(() => buildLoginPayload({ login: 1n, password: 'demo' }, Buffer.alloc(15)), /16 bytes/);
  assert.throws(() => buildLoginPayload({ login: 1n, password: 'demo', otp: 'x'.repeat(65) }, Buffer.alloc(16)), /exceeds/);
});

test('account parser reads base fields and allows documented trailing extension data', () => {
  const payload = Buffer.alloc(824);
  payload.writeUInt8(1, 0);
  payload.writeInt32LE(8, 1);
  payload.writeDoubleLE(100_000, 9);
  payload.write('USD', 25, 'utf16le');
  payload.write('Demo account', 97, 'utf16le');
  assert.deepEqual(parseAccount(payload), { type: 1, permissions: 8, balance: 100_000, currency: 'USD', name: 'Demo account' });
  assert.throws(() => parseAccount(payload.subarray(0, 815)), /Truncated/);
  payload.writeDoubleLE(NaN, 9);
  assert.throws(() => parseAccount(payload), /balance/);
});

test('read-only client requires login before account, symbol and subscription access', async () => {
  const client = new Mt5WebClient();
  await assert.rejects(client.account(), /login is required/);
  await assert.rejects(client.marketSymbols(), /login is required/);
  await assert.rejects(client.subscribe(['EURUSD']), /login is required/);
  client.close();
});

test('login sends the device identity the client was given', async () => {
  const identity = Buffer.alloc(16, 0x5a);
  const client = new Mt5WebClient('wss://broker.example/terminal', undefined, identity);
  let sent: Buffer | undefined;
  client.transport.request = async (_command, payload) => {
    sent = Buffer.from(payload!);
    return Buffer.alloc(168);
  };
  await client.login({ login: 7n, password: 'demo' });
  client.close();
  assert.deepEqual(sent?.subarray(196, 212), identity);
});
