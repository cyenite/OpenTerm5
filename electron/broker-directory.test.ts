import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BrokerDirectory, brokerDomains, candidateTerminals, rankServers } from './broker-directory';
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

test('known directory entries accept unlisted servers of the same broker and say so', async () => {
  const brokers = await directory({ 'https://mt5webterminal.ftmo.com/terminal': page('FTMO Global Markets Ltd', ['FTMO-Server']) });
  const resolved = await brokers.resolve('FTMO-Server4');
  assert.equal(resolved.isListed, false);
  assert.equal(resolved.source, 'known');
  assert.equal(resolved.webEndpoint, 'wss://mt5webterminal.ftmo.com/terminal');
  await assert.rejects(brokers.resolve('bad/name'), /trade server name/);
});

test('a manually entered address is checked but needs approval and is not remembered by itself', async () => {
  const brokers = await directory({ 'https://custom.example.org/terminal': page('Acme Markets', ['Acme-Live']) });
  const manual = await brokers.inspect('Acme-Live', 'https://custom.example.org/terminal');
  assert.deepEqual([manual.isListed, manual.source], [true, 'manual']);
  await assert.rejects(brokers.resolve('Acme-Live'), /Could not find/);
  await assert.rejects(brokers.inspect('Acme-Live', 'http://custom.example.org/terminal'), /HTTPS/);
  assert.deepEqual((await brokers.search('acme')).map((item) => item.server), ['Acme-Demo', 'Acme-Live']);
});

test('when only bot-checked hosts answer, the failure names the bot check', async () => {
  const brokers = new BrokerDirectory(await mkdtemp(path.join(tmpdir(), 'brokers-')), fakeFetch({}, [], ['webtrader.acme.com']));
  await assert.rejects(brokers.resolve('Acme-Demo'), /webtrader\.acme\.com is protected by a Cloudflare bot check/);
});
