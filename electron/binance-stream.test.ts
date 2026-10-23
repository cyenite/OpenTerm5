import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeSocket } from './bybit-fixtures';
import { BinanceStream } from './binance-stream';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

test('subscriptions go out in batches, spaced to stay under the message limit, and come back after a reconnect', async () => {
  const { sockets, open } = opener();
  const stream = new BinanceStream(() => 'wss://stream.example/market/stream', open);
  stream.subscribe(Array.from({ length: 60 }, (_, index) => `s${index}@bookticker`));
  stream.start();
  await stream.ready();
  assert.deepEqual(sockets[0].sent.map((message) => (message.params as string[]).length), [50], 'the second batch waits its turn');
  await wait(300);
  assert.deepEqual(sockets[0].sent.map((message) => (message.params as string[]).length), [50, 10]);
  stream.unsubscribe(['s0@bookticker']);
  sockets[0].emit('close');
  await wait(600);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].sent[0].method, 'SUBSCRIBE');
  assert.equal((sockets[1].sent[0].params as string[]).includes('s0@bookticker'), false);
  stream.stop();
});

test('combined stream events are unwrapped, raw events pass through, and the address is asked for on every connection', async () => {
  const { sockets, open } = opener();
  let keys = 0;
  const stream = new BinanceStream(async () => `wss://stream.example/private/ws/key${++keys}`, open);
  const events: [Record<string, unknown>, string | undefined][] = [];
  stream.on('data', (data, name) => events.push([data, name]));
  stream.start();
  await stream.ready();
  sockets[0].push({ stream: 'btcusdt@bookTicker', data: { e: 'bookTicker', s: 'BTCUSDT' } });
  sockets[0].push({ e: 'ORDER_TRADE_UPDATE', o: { s: 'BTCUSDT' } });
  sockets[0].push({ result: null, id: 1 });
  assert.deepEqual(events.map(([data, name]) => [data.e, name]), [['bookTicker', 'btcusdt@bookTicker'], ['ORDER_TRADE_UPDATE', undefined]]);
  stream.restart();
  await wait(600);
  assert.deepEqual(sockets.map((socket) => socket.url), ['wss://stream.example/private/ws/key1', 'wss://stream.example/private/ws/key2']);
  stream.stop();
});

test('an address that cannot be had fails the first connection', async () => {
  const { open } = opener();
  const stream = new BinanceStream(() => { throw new Error('listen key refused'); }, open);
  stream.start();
  await assert.rejects(stream.ready(), /listen key refused/);
  stream.stop();
});
