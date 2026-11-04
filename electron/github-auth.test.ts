import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHubAuth, GitHubAuthError, type GitHubTokens } from './github-auth';

type Reply = Record<string, unknown> | (() => Record<string, unknown>);

function harness(replies: Reply[]) {
  let time = 1_000_000;
  let saved: GitHubTokens | null = null;
  const saves: (GitHubTokens | null)[] = [];
  const requests: { url: string; body: URLSearchParams; redirect?: string }[] = [];
  const auth = new GitHubAuth({
    fetch: async (url, init) => {
      requests.push({ url, body: new URLSearchParams(String(init?.body)), redirect: init?.redirect });
      const next = replies.shift();
      if (!next) throw new Error('no reply queued');
      return new Response(JSON.stringify(typeof next === 'function' ? next() : next));
    },
    clientId: 'Iv1.test', now: () => time, pause: async (ms) => { time += ms; },
    load: () => saved, save: async (tokens) => { saved = tokens; saves.push(tokens); },
  });
  return { auth, requests, saves, get saved() { return saved; }, set saved(value) { saved = value; }, advance: (ms: number) => { time += ms; }, now: () => time };
}

const granted = { access_token: 'ghu_one', refresh_token: 'ghr_one', expires_in: 28_800, refresh_token_expires_in: 15_638_400 };

test('the device flow polls until approved, honours slow_down and saves the tokens', async () => {
  const h = harness([
    { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 },
    { error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, granted,
  ]);
  const code = await h.auth.start();
  assert.equal(code.userCode, 'ABCD-1234');
  const start = h.now();
  const tokens = await h.auth.poll(code);
  assert.equal(tokens.accessToken, 'ghu_one');
  assert.equal(h.now() - start, 5_000 + 5_000 + 10_000);
  assert.deepEqual(h.saved, tokens);
  assert.ok(h.requests.every((request) => request.url.startsWith('https://github.com/') && request.redirect === 'error'));
  assert.ok(h.requests.every((request) => !request.body.has('client_secret')));
});

test('a declined or expired sign-in says so', async () => {
  const code = { userCode: 'A', deviceCode: 'dc', verificationUri: 'https://github.com/login/device', intervalMs: 5000, expiresAt: 1_000_000 + 60_000 };
  await assert.rejects(harness([{ error: 'access_denied' }]).auth.poll(code), (error) => error instanceof GitHubAuthError && error.reason === 'denied');
  await assert.rejects(harness(Array(20).fill({ error: 'authorization_pending' })).auth.poll(code), (error) => error instanceof GitHubAuthError && error.reason === 'expired');
});

test('a sign-in address off github.com is refused', async () => {
  await assert.rejects(harness([{ device_code: 'dc', user_code: 'X', verification_uri: 'https://github.com.evil.example/login' }]).auth.start(), /unexpected sign-in address/);
});

test('a valid token is used as is; one near expiry is refreshed once, saved first, without a secret', async () => {
  const h = harness([{ access_token: 'ghu_two', refresh_token: 'ghr_two', expires_in: 28_800 }]);
  h.saved = { accessToken: 'ghu_one', refreshToken: 'ghr_one', expiresAt: h.now() + 3_600_000, refreshExpiresAt: h.now() + 86_400_000 };
  assert.equal(await h.auth.accessToken(), 'ghu_one');
  h.advance(3_600_000 - 60_000);
  const [first, second] = await Promise.all([h.auth.accessToken(), h.auth.accessToken()]);
  assert.deepEqual([first, second], ['ghu_two', 'ghu_two']);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body.get('refresh_token'), 'ghr_one');
  assert.equal(h.requests[0].body.has('client_secret'), false);
  assert.equal(h.saves.at(-1)?.refreshToken, 'ghr_two');
});

test('any refresh error forgets the tokens and asks to reconnect; a network failure keeps them', async () => {
  const h = harness([{ error: 'incorrect_client_credentials' }]);
  h.saved = { accessToken: 'ghu_one', refreshToken: 'ghr_one', expiresAt: h.now(), refreshExpiresAt: h.now() + 86_400_000 };
  await assert.rejects(h.auth.accessToken(), (error) => error instanceof GitHubAuthError && error.reason === 'reconnect');
  assert.equal(h.saved, null);

  const offline = harness([]);
  offline.saved = { accessToken: 'ghu_one', refreshToken: 'ghr_one', expiresAt: offline.now(), refreshExpiresAt: offline.now() + 86_400_000 };
  await assert.rejects(offline.auth.accessToken(), (error) => error instanceof GitHubAuthError && error.reason === 'network');
  assert.ok(offline.saved);
});

test('an expired refresh token needs a new sign-in', async () => {
  const h = harness([]);
  h.saved = { accessToken: 'a', refreshToken: 'r', expiresAt: h.now() - 1, refreshExpiresAt: h.now() - 1 };
  assert.equal(h.auth.isSignedIn, false);
  await assert.rejects(h.auth.accessToken(), /Reconnect GitHub/);
});
