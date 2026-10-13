import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { once } from 'node:events';
import { createCipheriv, createDecipheriv, webcrypto } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { Mt5WebTransport, WebProtocolError, decryptPayload, encryptPayload } from './mt5-web-transport';

const initialKey = Buffer.from('02de02a1a65cc794684fcbea1ecb0fd74ae657e43662c11eee885d2fd64f4964', 'hex');
const sessionKey = Buffer.alloc(32, 0x55);

interface Fixture {
  readonly transport: Mt5WebTransport;
  readonly requests: number[];
}

async function fixture(
  context: TestContext,
  handler: (command: number, payload: Buffer, reply: (status: number, payload: Buffer, command?: number) => void, socket: WebSocket) => void,
  timeoutMs = 1_000,
): Promise<Fixture> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const requests: number[] = [];
  server.on('connection', (socket) => {
    let key = initialKey;
    socket.on('message', (raw) => {
      const frame = Buffer.from(raw as Buffer);
      assert.equal(frame.readUInt32LE(0), frame.length - 8);
      assert.equal(frame.readUInt32LE(4), 1);
      const cipher = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
      const plain = Buffer.concat([cipher.update(frame.subarray(8)), cipher.final()]);
      const command = plain.readUInt16LE(2);
      requests.push(command);
      const reply = (status: number, payload: Buffer, responseCommand = command) => {
        const response = Buffer.alloc(5 + payload.length);
        response.writeUInt16LE(responseCommand, 2);
        response.writeUInt8(status, 4);
        payload.copy(response, 5);
        const cipher = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
        const ciphertext = Buffer.concat([cipher.update(response), cipher.final()]);
        const frame = Buffer.alloc(8 + ciphertext.length);
        frame.writeUInt32LE(ciphertext.length, 0);
        ciphertext.copy(frame, 8);
        socket.send(frame);
      };
      if (command === 0) {
        assert.deepEqual(plain.subarray(4), Buffer.alloc(64));
        const hello = Buffer.alloc(98);
        hello.writeUInt16LE(6258);
        sessionKey.copy(hello, 66);
        reply(0, hello);
        key = sessionKey;
      } else handler(command, plain.subarray(4), reply, socket);
    });
  });
  const transport = new Mt5WebTransport('wss://fixture.invalid/terminal', timeoutMs, (_url, options) =>
    new WebSocket(`ws://127.0.0.1:${address.port}`, options));
  context.after(async () => {
    transport.close();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { transport, requests };
}

test('AES payloads match browser WebCrypto, including padding boundaries', async () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index);
  const imported = await webcrypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  for (const length of [0, 1, 15, 16, 17, 64]) {
    const plain = Uint8Array.from({ length }, (_, index) => index);
    const expected = Buffer.from(await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, imported, plain));
    assert.deepEqual(encryptPayload(plain, key), expected);
    assert.deepEqual(decryptPayload(expected, key), Buffer.from(plain));
  }
  assert.throws(() => decryptPayload(Buffer.alloc(15), key));
});

test('transport negotiates keys and routes responses by command while retaining notifications', async (context) => {
  const { transport, requests } = await fixture(context, (command, payload, reply) => {
    assert.deepEqual(payload, Buffer.from([7]));
    reply(0, Buffer.from([99]), 8);
    reply(0, Buffer.from([42]), command);
  });
  const notification = once(transport, 'notification');
  assert.deepEqual(await transport.connect(), { endpoint: 'wss://fixture.invalid/terminal', version: 6258 });
  assert.deepEqual(await transport.request(41, Buffer.from([7])), Buffer.from([42]));
  assert.equal((await notification)[0].command, 8);
  assert.deepEqual(requests, [0, 41]);
});

test('server status is rejected and duplicate pending commands cannot misroute responses', async (context) => {
  const { transport } = await fixture(context, (_command, _payload, reply) => setTimeout(() => reply(3, Buffer.alloc(0)), 20));
  await transport.connect();
  const pending = transport.request(28);
  await assert.rejects(transport.request(28), /already pending/);
  await assert.rejects(pending, (error: unknown) => error instanceof WebProtocolError && error.status === 3 && error.command === 28);
});

test('timeout discards connection and rejects all outstanding requests', async (context) => {
  const { transport } = await fixture(context, () => {}, 100);
  await transport.connect();
  const first = assert.rejects(transport.request(6), /timed out/);
  const second = assert.rejects(transport.request(9), /timed out/);
  await Promise.all([first, second]);
  await assert.rejects(transport.request(41), /not ready/);
});

test('malformed encrypted frames reject pending requests and close transport', async (context) => {
  const { transport } = await fixture(context, (_command, _payload, _reply, socket) => socket.send(Buffer.alloc(8)));
  await transport.connect();
  await assert.rejects(transport.request(6));
  await assert.rejects(transport.request(9), /not ready/);
});

test('remote closure settles outstanding requests', async (context) => {
  const { transport } = await fixture(context, (_command, _payload, _reply, socket) => socket.close());
  await transport.connect();
  await assert.rejects(transport.request(6), /closed/);
});

test('endpoint validation rejects plaintext and embedded credentials', () => {
  assert.throws(() => new Mt5WebTransport('ws://localhost/terminal'), /WSS/);
  assert.throws(() => new Mt5WebTransport('wss://user:password@example.com/terminal'), /credentials/);
  assert.throws(() => new Mt5WebTransport('wss://example.com/terminal', 0), /timeout/);
});
