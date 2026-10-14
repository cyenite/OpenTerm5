import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BotCheckError, isBotCheck } from './bot-check';
import { fetchTerminalPage } from './mt5-web-discovery';

test('Cloudflare challenges are recognised from fetch and upgrade headers', () => {
  assert.equal(isBotCheck(403, new Headers({ 'cf-mitigated': 'challenge' })), true);
  assert.equal(isBotCheck(403, { server: 'cloudflare', 'cf-ray': 'abc-MRS' }), true);
  assert.equal(isBotCheck(403, { server: 'nginx' }), false);
  assert.equal(isBotCheck(200, new Headers({ server: 'cloudflare', 'cf-ray': 'abc' })), false);
});

test('a challenged terminal page explains the bot check instead of a bare HTTP status', async () => {
  const challenged = (async () => new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } })) as typeof fetch;
  await assert.rejects(fetchTerminalPage('https://demo.broker.example/terminal', challenged), (error: unknown) => error instanceof BotCheckError && error.host === 'demo.broker.example' && /bot check/.test(error.message));
});
