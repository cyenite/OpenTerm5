import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BrokerDirectory, brokerDomains, candidateTerminals, rankServers } from './broker-directory';
import { knownTerminals } from './known-terminals';
import { registrableDomain } from './mt5-web-discovery';

const page = (broker: string, servers: string[]) => `<script>window.__terminal_params = {"broker":{"name":"${broker}"},"servers":[${servers.map((server) => `{"server":"${server}","type":"real"}`).join(',')}]};</script>`;

function fakeFetch(pages: Record<string, string>, calls: string[] = [], challenged: readonly string[] = []): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/trade/servers')) return new Response(JSON.stringify({ mt5: ['Acme-Live', 'Acme-Demo', 'Other-Server'] }));
    if (challenged.some((host) => url.includes(`//${host}/`))) return new Response('Just a moment...', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    const html = pages[url];
    if (html === undefined) throw new TypeError('fetch failed');
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }) as typeof fetch;
}

const directory = async (pages: Record<string, string>, calls?: string[]) => new BrokerDirectory(await mkdtemp(path.join(tmpdir(), 'brokers-')), fakeFetch(pages, calls));

test('server names map to plausible broker domains and access-server hosts', () => {
  assert.deepEqual(brokerDomains('ICMarketsSC-Demo'), ['icmarketssc.com', 'icmarkets.com']);
  assert.deepEqual(brokerDomains('XM-Real'), []);
  assert.deepEqual([registrableDomain('mt5.broker.co.uk'), registrableDomain('a.b.broker.com'), registrableDomain('x.broker.com.cy')], ['broker.co.uk', 'broker.com', 'broker.com.cy']);
  assert.deepEqual(brokerDomains('FTMO-Server3'), ['ftmo.com']);
  const demo = candidateTerminals('Pepperstone-Demo');
  const live = candidateTerminals('Pepperstone-MT5-Live01');
  assert.ok(demo.indexOf('https://mt5-demo01.pepperstone.com/terminal') < demo.indexOf('https://mt5-1.pepperstone.com/terminal'));
  assert.ok(live.indexOf('https://mt5-1.pepperstone.com/terminal') < live.indexOf('https://mt5-demo01.pepperstone.com/terminal'));
});

test('search ranks prefix matches first and labels only obvious demo servers', () => {
  const found = rankServers(['XAcme-Live', 'Acme-Live2', 'Acme-Demo', 'Zeta-Acme'], 'acme');
  assert.deepEqual(found.map((item) => item.server), ['Acme-Demo', 'Acme-Live2', 'Zeta-Acme', 'XAcme-Live']);
  assert.deepEqual(found.map((item) => item.type), ['demo', '', '', '']);
  assert.deepEqual(rankServers(['Acme-Live'], ' '), []);
});

test('a guessed host needs the exact server and is never trusted or saved before a login', async () => {
  const calls: string[] = [];
  const brokers = await directory({
    'https://mt5webterminal.acme.com/terminal': page('Look-alike Ltd', ['Something-Else']),
    'https://mt5-1.acme.com/terminal': page('Acme Markets', ['Acme-Live']),
  }, calls);
  const resolved = await brokers.resolve('Acme-Live');
  assert.deepEqual(resolved, { server: 'Acme-Live', broker: 'Acme Markets', webUrl: 'https://mt5-1.acme.com/terminal', webEndpoint: 'wss://mt5-1.acme.com/terminal', isListed: true, source: 'discovered' });
  const probes = calls.length;
  assert.equal((await brokers.resolve('Acme-Live')).source, 'discovered');
  assert.ok(calls.length > probes, 'an unconfirmed host is probed again rather than cached');
  await brokers.remember('Acme-Live', 'wss://mt5-1.acme.com/terminal', 'Acme Markets');
  const afterLogin = calls.length;
  assert.equal((await brokers.resolve('Acme-Live')).source, 'saved');
  assert.equal(calls.length, afterLogin, 'a server that logged in is served from the cache');
  await assert.rejects(brokers.resolve('Acme-Live7'), /Could not find/);
});

test('branded wrapper pages are followed to the framed terminal on the same domain', async () => {
  const brokers = await directory({
    'https://mt5webterminal.acme.com/terminal': '<iframe src="https://evil.example/terminal"></iframe>',
    'https://webterminal.acme.com/terminal': '<html><iframe src="https://trade.acme.com/terminal" frameborder="0"></iframe></html>',
    'https://trade.acme.com/terminal': page('Acme Markets', ['Acme-Demo']),
  });
  assert.equal((await brokers.resolve('Acme-Demo')).webEndpoint, 'wss://trade.acme.com/terminal');
});

test('a known entry is accepted even when its page stops listing the server, and says so', async () => {
  const brokers = await directory({ 'https://mt5webterminal.ftmo.com/terminal': page('FTMO Global Markets Ltd', ['FTMO-Renamed']) });
  const resolved = await brokers.resolve('FTMO-Server');
  assert.equal(resolved.isListed, false);
  assert.equal(resolved.source, 'known');
  assert.equal(resolved.webEndpoint, 'wss://mt5webterminal.ftmo.com/terminal');
  await assert.rejects(brokers.resolve('bad/name'), /trade server name/);
});

test('a sibling server never borrows another server\'s terminal', async () => {
  const brokers = await directory({
    'https://mt5webterminal.ftmo.com/terminal': page('FTMO Global Markets Ltd', ['FTMO-Server']),
    'https://mt5webterminal4.ftmo.com/terminal': page('FTMO Global Markets Ltd', ['FTMO-Server4']),
    'https://webterminal.ftmo.com/terminal': page('FTMO Global Markets Ltd', ['FTMO-Server9']),
  });
  assert.equal((await brokers.resolve('FTMO-Server4')).webEndpoint, 'wss://mt5webterminal4.ftmo.com/terminal');
  const unlisted = await brokers.resolve('FTMO-Server9');
  assert.deepEqual([unlisted.webEndpoint, unlisted.source], ['wss://webterminal.ftmo.com/terminal', 'known']);
  await assert.rejects(brokers.resolve('FTMO-Server8'), /Could not find/);
});

test('every directory entry is an HTTPS terminal page and names each server once', () => {
  const servers = knownTerminals.flatMap((terminal) => terminal.servers.map((server) => server.toLowerCase()));
  assert.equal(new Set(servers).size, servers.length);
  assert.equal(new Set(knownTerminals.map((terminal) => terminal.webUrl)).size, knownTerminals.length);
  for (const terminal of knownTerminals) {
    const url = new URL(terminal.webUrl);
    assert.deepEqual([url.protocol, url.pathname, url.search], ['https:', '/terminal', ''], terminal.webUrl);
    assert.ok(terminal.servers.length > 0, terminal.webUrl);
  }
});

test('terminals on a port or a domain other than the broker website resolve from the directory', async () => {
  const calls: string[] = [];
  const brokers = await directory({
    'https://live10-webterminal.hfm-ke.com:1951/terminal': page('HFM Investments Ltd', ['HFMarketsKE-Live10']),
    'https://mt5real8.exwebterm.com/terminal': page('Exness Technologies Ltd', ['Exness-MT5Real8']),
  }, calls);
  const hfm = await brokers.resolve('HFMarketsKE-Live10');
  assert.deepEqual([hfm.webEndpoint, hfm.source], ['wss://live10-webterminal.hfm-ke.com:1951/terminal', 'known']);
  assert.equal((await brokers.resolve('Exness-MT5Real8')).webEndpoint, 'wss://mt5real8.exwebterm.com/terminal');
  assert.deepEqual(calls, ['https://live10-webterminal.hfm-ke.com:1951/terminal', 'https://mt5real8.exwebterm.com/terminal']);
});

test('a manually entered address is checked but needs approval and is not remembered by itself', async () => {
  const brokers = await directory({ 'https://custom.example.org/terminal': page('Acme Markets', ['Acme-Live']) });
  const manual = await brokers.inspect('Acme-Live', 'https://custom.example.org/terminal');
  assert.deepEqual([manual.isListed, manual.source], [true, 'manual']);
  await assert.rejects(brokers.resolve('Acme-Live'), /Could not find/);
  await assert.rejects(brokers.inspect('Acme-Live', 'http://custom.example.org/terminal'), /HTTPS/);
  assert.deepEqual((await brokers.search('acme')).map((item) => item.server), ['Acme-Demo', 'Acme-Live']);
});

test('a server the broker routes to a shared host resolves there as known but unlisted', async () => {
  const calls: string[] = [];
  const brokers = await directory({ 'https://real-terminal.ctgl.app/terminal': page('FBS Markets Inc.', ['FBS-Real']) }, calls);
  const resolved = await brokers.resolve('FBS-Real-5');
  assert.deepEqual([resolved.webEndpoint, resolved.source, resolved.isListed], ['wss://real-terminal.ctgl.app/terminal', 'known', false]);
  assert.deepEqual(calls, ['https://real-terminal.ctgl.app/terminal']);
});

test('when only bot-checked hosts answer, the failure names the bot check', async () => {
  const brokers = new BrokerDirectory(await mkdtemp(path.join(tmpdir(), 'brokers-')), fakeFetch({}, [], ['webtrader.acme.com']));
  await assert.rejects(brokers.resolve('Acme-Demo'), /webtrader\.acme\.com is protected by a Cloudflare bot check/);
});


test('known terminals resolve without probing guessed hosts', async () => {
  const calls: string[] = [];
  const brokers = await directory({ 'https://mt5webterminal.ftmo.com/terminal': page('FTMO', ['FTMO-Server']) }, calls);
  assert.equal((await brokers.resolve('FTMO-Server')).source, 'known');
  assert.deepEqual(calls, ['https://mt5webterminal.ftmo.com/terminal']);
});

test('an exact match returns before slow sibling probes and cancels them', { timeout: 1_000 }, async (t) => {
  const signals: AbortSignal[] = [];
  const fetchPage = (async (input: string | URL | Request, options?: RequestInit) => {
    if (String(input) === 'https://webterminal.acme.com/terminal') return new Response(page('Acme', ['Acme-Live']));
    const signal = options!.signal!;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }) as typeof fetch;
  const brokers = new BrokerDirectory(await mkdtemp(path.join(tmpdir(), 'brokers-')), fetchPage);
  const started = performance.now();
  const result = await brokers.resolve('Acme-Live');
  t.diagnostic(`Exact-match lookup with stalled siblings: ${(performance.now() - started).toFixed(2)} ms`);
  assert.equal(result.source, 'discovered');
  assert.equal(result.webUrl, 'https://webterminal.acme.com/terminal');
  assert.equal(signals.length, 9);
  assert.ok(signals.every((signal) => signal.aborted));
});
