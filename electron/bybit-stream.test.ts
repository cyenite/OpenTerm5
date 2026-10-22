import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeSocket } from './bybit-fixtures';
import { BybitStream } from './bybit-stream';

const settle = () => new Promise((resolve) => setImmediate(resolve));

function opener() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    open: (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      setImmediate(() => socket.emit('open'));
      return socket;
    },
  };
}

test('subscriptions are sent in batches of ten and restored after a reconnect', async () => {
  const { sockets, open } = opener();
  const stream = new BybitStream('wss://stream.example/v5/public/linear', open);
  stream.subscribe(Array.from({ length: 12 }, (_, index) => `tickers.S${index}`));
  stream.start();
  await stream.ready();
  assert.deepEqual(sockets[0].sent.map((message) => (message.args as string[]).length), [10, 2]);
  sockets[0].emit('close');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].sent.filter((message) => message.op === 'subscribe').length, 2);
  stream.unsubscribe(['tickers.S0']);
  assert.deepEqual(sockets[1].sent.at(-1), { op: 'unsubscribe', args: ['tickers.S0'] });
  stream.stop();
});

test('a refused stream login fails readiness and stops reconnecting', async () => {
  const sockets: FakeSocket[] = [];
  const stream = new BybitStream('wss://stream.example/v5/private', (url) => {
    const socket = new FakeSocket(url);
    socket.send = (data: string) => {
      socket.sent.push(JSON.parse(data));
      setImmediate(() => socket.push({ op: 'auth', success: false, ret_msg: 'Invalid apikey' }));
    };
    sockets.push(socket);
    setImmediate(() => socket.emit('open'));
    return socket;
  }, () => ['key', 1, 'signature']);
  stream.start();
  await assert.rejects(stream.ready(), /Invalid apikey/);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(sockets.length, 1);
  assert.deepEqual(sockets[0].sent[0], { op: 'auth', args: ['key', 1, 'signature'] });
});

test('topic messages are emitted; replies to commands are not', async () => {
  const { sockets, open } = opener();
  const stream = new BybitStream('wss://stream.example/v5/public/linear', open);
  const messages: unknown[] = [];
  stream.on('data', (message) => messages.push(message));
  stream.start();
  await stream.ready();
  sockets[0].push({ op: 'subscribe', success: true });
  sockets[0].push({ topic: 'tickers.BTCUSDT', data: { symbol: 'BTCUSDT' } });
  await settle();
  assert.deepEqual(messages, [{ topic: 'tickers.BTCUSDT', data: { symbol: 'BTCUSDT' } }]);
  stream.stop();
});
