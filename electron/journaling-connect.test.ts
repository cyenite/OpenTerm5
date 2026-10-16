import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { challengeOf, connectUrl, ConnectCancelledError, createPkce, createState, isStateMatch, startLoopback } from './journaling-connect';

test('the PKCE challenge is the base64url SHA-256 of the verifier', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.notEqual(createPkce().verifier, verifier);
});

test('state comparison needs an exact match', () => {
  const state = createState();
  assert.equal(isStateMatch(state, state), true);
  assert.equal(isStateMatch(state, `${state}x`), false);
  assert.equal(isStateMatch(state, null), false);
  assert.equal(isStateMatch(state, state.replace(/^./, (first) => first === 'a' ? 'b' : 'a')), false);
});

test('the browser opens the platform connect page with the callback, state, challenge and device', () => {
  const url = new URL(connectUrl('https://tradescribe.io', { callback: 'http://127.0.0.1:5123/callback', state: 's1', challenge: 'c1', device: 'aaron laptop' }));
  assert.equal(url.origin + url.pathname, 'https://tradescribe.io/connect/openterm');
  assert.equal(url.searchParams.get('callback'), 'http://127.0.0.1:5123/callback');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('challenge'), 'c1');
  assert.equal(url.searchParams.get('device'), 'aaron laptop');
});

test('the loopback ignores a wrong state and resolves with the code once the right one arrives', async () => {
  const loopback = await startLoopback('right-state');
  assert.match(loopback.callbackUrl, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const wrong = await fetch(`${loopback.callbackUrl}?code=EVIL-CODE&state=wrong-state`);
  assert.equal(wrong.status, 400);
  const missing = await fetch(`http://127.0.0.1:${loopback.port}/other`);
  assert.equal(missing.status, 404);
  const right = await fetch(`${loopback.callbackUrl}?code=ABCD-EFGH&state=right-state`);
  assert.equal(right.status, 200);
  assert.match(await right.text(), /close this tab/);
  assert.equal(await loopback.code, 'ABCD-EFGH');
  await assert.rejects(fetch(loopback.callbackUrl));
});

test('a cancel in Tradescribe rejects the wait, and so do a timeout and closing it', async () => {
  const denied = await startLoopback('s');
  await fetch(`${denied.callbackUrl}?error=access_denied&state=s`);
  await assert.rejects(denied.code, (error: Error) => error instanceof ConnectCancelledError && /cancelled the connection/.test(error.message));
  const timed = await startLoopback('s', 20);
  await assert.rejects(timed.code, /timed out/);
  const closed = await startLoopback('s');
  closed.close();
  await assert.rejects(closed.code, ConnectCancelledError);
});
