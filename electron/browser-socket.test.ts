import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { BotCheckError } from './bot-check';
import { BrowserSocket, chromeUserAgent, type RelayMessage, type RelayPort } from './browser-socket';

class FakePort extends EventEmitter implements RelayPort {
  isClosed = false;
  readonly sent: unknown[] = [];
  start(): void {}
  close(): void { this.isClosed = true; }
  postMessage(message: unknown): void { this.sent.push(message); }
  deliver(data: RelayMessage): void { this.emit('message', { data }); }
}

function socket(isChallenged = false, maxPayload = 64) {
  const port = new FakePort();
  const ended: number[] = [];
  const relay = new BrowserSocket('broker.example', maxPayload, port, () => ended.push(1), async () => isChallenged);
  return { port, relay, ended };
}

test('the user agent reads as Chrome without the Electron or app tokens', () => {
  const agent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) OpenTerm5/0.1.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';
  assert.equal(chromeUserAgent(agent, 'OpenTerm5'), 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36');
});

test('relayed frames arrive as binary buffers and sends go out once open', async () => {
  const { port, relay } = socket();
  const sentEarly = new Promise<Error | undefined>((resolve) => relay.send(Buffer.from([1]), resolve));
  assert.match(String(await sentEarly), /not open/);
  port.deliver({ type: 'open' });
  assert.equal(relay.readyState, 1);
  const received = once(relay, 'message');
  port.deliver({ type: 'message', data: new Uint8Array([7, 8]).buffer });
  const [frame, isBinary] = await received;
  assert.deepEqual([...frame], [7, 8]);
  assert.equal(isBinary, true);
  await new Promise<Error | undefined>((resolve) => relay.send(Buffer.from([9]), resolve));
  assert.deepEqual(port.sent, [{ type: 'send', data: new Uint8Array([9]) }]);
});

test('a socket refused before opening reports a bot check when the host is challenged', async () => {
  const { port, relay, ended } = socket(true);
  const events: unknown[] = [];
  relay.on('error', (error) => events.push(error));
  const closed = new Promise((resolve) => relay.on('close', resolve));
  port.deliver({ type: 'close', code: 1006 });
  assert.equal(await closed, 1006);
  assert.ok(events[0] instanceof BotCheckError && events[0].host === 'broker.example');
  assert.equal(port.isClosed, true);
  assert.deepEqual(ended, [1]);
});

test('an oversized frame closes the socket and terminate releases the relay once', async () => {
  const { port, relay, ended } = socket(false, 4);
  port.deliver({ type: 'open' });
  const failed = once(relay, 'error');
  port.deliver({ type: 'message', data: new Uint8Array(5).buffer });
  assert.match(String((await failed)[0]), /larger/);
  relay.terminate();
  assert.deepEqual(ended, [1]);
});
