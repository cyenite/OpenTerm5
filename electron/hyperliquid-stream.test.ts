import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeSocket } from './bybit-fixtures';
import { HyperliquidStream, type StreamMessage } from './hyperliquid-stream';

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

const opened = (stream: HyperliquidStream) => new Promise((resolve) => stream.once('open', resolve));

test('sync sends only the difference and a reconnect resubscribes everything', async () => {
  const { sockets, open } = opener();
  const stream = new HyperliquidStream('wss://api.example/ws', open);
  stream.sync([{ coin: 'BTC', type: 'candle', interval: '1m' }, { coin: 'BTC', type: 'bbo' }]);
  stream.start();
  await opened(stream);
  assert.deepEqual(sockets[0].sent, [
    { method: 'subscribe', subscription: { coin: 'BTC', type: 'candle', interval: '1m' } },
    { method: 'subscribe', subscription: { coin: 'BTC', type: 'bbo' } },
  ]);
  stream.sync([{ coin: 'BTC', type: 'bbo' }, { coin: 'BTC', type: 'bbo' }, { coin: 'ETH', type: 'bbo' }]);
  assert.deepEqual(sockets[0].sent.slice(2), [
    { method: 'unsubscribe', subscription: { coin: 'BTC', type: 'candle', interval: '1m' } },
    { method: 'subscribe', subscription: { coin: 'ETH', type: 'bbo' } },
  ]);
  sockets[0].emit('close');
  await opened(stream);
  assert.deepEqual(sockets[1].sent.map((message) => (message.subscription as { coin: string }).coin), ['BTC', 'ETH']);
  stream.stop();
});

test('channel data is emitted; acknowledgements and pongs are not', async () => {
  const { sockets, open } = opener();
  const stream = new HyperliquidStream('wss://api.example/ws', open);
  const messages: StreamMessage[] = [];
  const journal: string[] = [];
  stream.on('data', (message: StreamMessage) => messages.push(message));
  stream.on('journal', (message: string) => journal.push(message));
  stream.start();
  await opened(stream);
  sockets[0].push({ channel: 'subscriptionResponse', data: {} });
  sockets[0].push({ channel: 'pong' });
  sockets[0].push({ channel: 'candle', data: { s: 'BTC' } });
  sockets[0].push({ channel: 'error', data: 'Invalid subscription' });
  assert.deepEqual(messages, [{ channel: 'candle', data: { s: 'BTC' } }]);
  assert.deepEqual(journal, ['Hyperliquid refused a request: Invalid subscription']);
  stream.stop();
});
