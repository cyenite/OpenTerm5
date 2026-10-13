import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverServers, parseServerMetadata, validateTerminalUrl } from './mt5-web-discovery';

const html = '<script>window.__terminal_params = {"broker":{"name":"Example } Broker"},"servers":[{"server":"Example-Demo","type":"demo"},{"server":"Example-Live","type":"real"}]};</script>';

test('server catalogue maps declared web servers to same-origin WSS without evaluating scripts', () => {
  const result = parseServerMetadata(html, 'https://trade.example.com/terminal?lang=en');
  assert.equal(result.length, 2);
  assert.equal(result[0].broker, 'Example } Broker');
  assert.equal(result[0].webEndpoint, 'wss://trade.example.com/terminal');
  assert.equal(result[1].type, 'real');
  assert.equal(result[0].isWebAvailable, true);
});

test('desktop server names and unrelated pages are not guessed as endpoints', () => {
  assert.throws(() => validateTerminalUrl('Example-Demo'));
  assert.throws(() => parseServerMetadata('<script>alert(1)</script>', 'https://example.com'));
  assert.throws(() => parseServerMetadata('window.__terminal_params = malicious();', 'https://example.com'));
  assert.throws(() => parseServerMetadata('window.__terminal_params={"servers":[]};', 'https://example.com'));
});

test('lookup rejects credential URLs, insecure URLs and local hostnames', () => {
  for (const url of ['http://broker.example/terminal', 'https://user:secret@broker.example', 'https://localhost/terminal', 'https://127.0.0.1/terminal', 'https://broker.example/#fragment']) {
    assert.throws(() => validateTerminalUrl(url));
  }
});

test('lookup filters broker metadata and uses a bounded read-only request', async () => {
  let target = '';
  const result = await discoverServers({ query: 'demo' }, (async (url: string | URL | Request, options?: RequestInit) => {
    target = String(url);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.headers && (options.headers as Record<string, string>).Accept, 'text/html');
    return new Response(html);
  }) as typeof fetch);
  assert.equal(target, 'https://web.metatrader.app/terminal');
  assert.equal(result.length, 1);
  assert.equal(result[0].server, 'Example-Demo');
});

test('lookup exposes HTTP and oversized response failures', async () => {
  await assert.rejects(discoverServers({}, (async () => new Response('', { status: 503 })) as typeof fetch), /HTTP 503/);
  await assert.rejects(discoverServers({}, (async () => new Response('x'.repeat(1_048_577))) as typeof fetch), /exceeds/);
});
