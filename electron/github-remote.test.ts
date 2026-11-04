import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHubAuthError } from './github-auth';
import { FakeGitHub } from './github-fixtures';
import { GitHubApi, GitHubNetworkError, GitHubRateLimitError, GitHubRemote, type RepositoryInfo } from './github-remote';
import { deriveKeys, newRootKey } from './sync-crypto';
import { SyncEngine } from './sync-engine';
import { MemorySource, MemoryStore } from './sync-engine-fixtures';

const REPO: RepositoryInfo = { id: 42, branch: 'main', fullName: 'octotrader/openterm5-sync', isPrivate: true };
const HOUR = 3_600_000;

function setup() {
  const github = new FakeGitHub();
  github.addRepository(REPO.id, REPO.fullName);
  const api = new GitHubApi(github.fetch, async () => 'ghu_test', () => 1_800_000_000_000 + 1234);
  return { github, api, remote: new GitHubRemote(api, REPO, () => 1_800_000_000_000 + 1234) };
}

test('an empty repository is seeded, then files round-trip byte for byte', async () => {
  const { github, remote } = setup();
  assert.equal(await remote.head(), null);
  const envelope = Buffer.from([0, 1, 2, 250, 255]);
  const head = await remote.commit(null, new Map([['objects/ab/cd', envelope], ['format.json', Buffer.from('{"v":1}')]]));
  assert.ok(head);
  assert.equal(await remote.head(), head);
  const files = await remote.read(head!, ['objects/ab/cd', 'format.json', 'missing']);
  assert.deepEqual(files.get('objects/ab/cd'), envelope);
  assert.equal(files.get('format.json')!.toString(), '{"v":1}');
  assert.equal(files.get('missing'), null);
  const stored = github.contents(REPO.id);
  assert.equal(stored.get('format.json')!.toString(), '{"v":1}', 'JSON stays readable on github.com');
  assert.equal(stored.get('objects/ab/cd')!.toString(), envelope.toString('base64'));
  assert.match(stored.get('README.md')!.toString(), /Encrypted OpenTerm5 sync data/);
});

test('an unchanged head is a 304 that costs no rate limit', async () => {
  const { github, remote } = setup();
  await remote.commit(null, new Map([['a.json', Buffer.from('1')]]));
  await remote.head();
  const before = github.rateRemaining;
  await remote.head();
  assert.equal(github.rateRemaining, before);
  assert.match(github.requests.at(-1)!.headers['if-none-match'], /^W\//);
});

test('a commit on a stale parent is refused, and the winner keeps the branch', async () => {
  const { api, remote } = setup();
  const parent = (await remote.commit(null, new Map([['a.json', Buffer.from('1')]])))!;
  const other = new GitHubRemote(api, REPO);
  const winner = await other.commit(parent, new Map([['b.json', Buffer.from('2')]]));
  assert.equal(await remote.commit(parent, new Map([['c.json', Buffer.from('3')]])), null);
  assert.equal(await remote.head(), winner);
  assert.equal(await remote.commit(null, new Map([['d.json', Buffer.from('4')]])), null, 'a non-empty repository is never seeded again');
});

test('deleting a path removes it, and deleting one that is not there is skipped', async () => {
  const { remote } = setup();
  const first = (await remote.commit(null, new Map([['a.json', Buffer.from('1')]])))!;
  const second = (await remote.commit(first, new Map([['a.json', null], ['never.json', null], ['b.json', Buffer.from('2')]])))!;
  const files = await remote.read(second, ['a.json', 'b.json']);
  assert.equal(files.get('a.json'), null);
  assert.equal(files.get('b.json')!.toString(), '2');
  assert.equal(await remote.commit(second, new Map([['gone.json', null]])), second, 'nothing to write');
});

test('commits are signed off as OpenTerm5 Sync at the hour, with no device name', async () => {
  const { github, remote } = setup();
  await remote.commit(null, new Map([['a.json', Buffer.from('1')]]));
  const commit = JSON.parse(github.requests.find((request) => request.url.endsWith('/git/commits') && request.method === 'POST')!.body);
  assert.deepEqual(commit.author, { name: 'OpenTerm5 Sync', email: 'sync@openterm5.invalid', date: new Date(Math.floor((1_800_000_000_000 + 1234) / HOUR) * HOUR).toISOString().replace('.000Z', 'Z') });
  assert.equal(commit.message, 'sync');
});

test('requests go only to api.github.com, refuse redirects and carry the token nowhere else', async () => {
  const { github, remote } = setup();
  await remote.commit(null, new Map([['a.json', Buffer.from('1')]]));
  for (const request of github.requests) {
    assert.ok(request.url.startsWith('https://api.github.com/'));
    assert.equal(request.headers.authorization, 'Bearer ghu_test');
  }
});

test('rate limits, a revoked token and being offline are told apart', async () => {
  const { github, api, remote } = setup();
  github.failNext = { path: /git\/ref/, status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000600' } };
  await assert.rejects(remote.head(), (error) => error instanceof GitHubRateLimitError && error.until > 1_800_000_000_000);
  github.failNext = { path: /git\/ref/, status: 429, headers: { 'retry-after': '30' } };
  await assert.rejects(remote.head(), (error) => error instanceof GitHubRateLimitError);
  github.isTokenRevoked = true;
  await assert.rejects(remote.head(), (error) => error instanceof GitHubAuthError && error.reason === 'reconnect');
  github.isTokenRevoked = false;
  github.isOffline = true;
  await assert.rejects(api.login(), GitHubNetworkError);
});

test('the installed repositories are listed, and a repository is found by id', async () => {
  const { github, api } = setup();
  github.addRepository(7, 'octotrader/aaa-public', false);
  assert.deepEqual((await api.repositories()).map((repo) => [repo.fullName, repo.isPrivate]), [['octotrader/aaa-public', false], ['octotrader/openterm5-sync', true]]);
  assert.equal((await api.repository(42))?.fullName, 'octotrader/openterm5-sync');
  assert.equal(await api.repository(99), null);
  assert.equal(await api.login(), 'octotrader');
});

test('two engines sync through GitHub end to end', async () => {
  const { api } = setup();
  const rootKey = newRootKey();
  const computer = (id: string) => {
    const source = new MemorySource('layout');
    const engine = new SyncEngine({
      epoch: 1, repoId: REPO.id, keys: deriveKeys(rootKey), remote: new GitHubRemote(api, REPO), store: new MemoryStore(), sources: [source],
      device: { id, name: id, platform: 'linux', publicKey: 'k', appVersion: '0.12.0' }, pause: async () => undefined,
    });
    return { source, engine };
  };
  const [a, b] = [computer('a'), computer('b')];
  a.source.data = { L1: { name: 'Gold' } };
  await a.engine.sync();
  b.source.data = { L2: { name: 'Silver' } };
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.source.data, { L1: { name: 'Gold' }, L2: { name: 'Silver' } });
  assert.deepEqual(b.source.data, a.source.data);
});
