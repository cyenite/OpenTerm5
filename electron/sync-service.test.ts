import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { SyncView } from '../shared/sync';
import type { PasswordCipher } from './account-registry';
import { FakeGitHub } from './github-fixtures';
import { GitHubApi, GitHubRemote } from './github-remote';
import { newRootKey } from './sync-crypto';
import type { SyncSource } from './sync-engine';
import { FakeTimers, MemorySource } from './sync-engine-fixtures';
import { inspectRepository, updateKeyring, withDeviceWrap } from './sync-keyring';
import { SyncService, type SyncServiceDeps } from './sync-service';

const REPO = 42;
const cipher: PasswordCipher = {
  canEncrypt: () => true,
  encrypt: (value) => Buffer.from(value).reverse().toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').reverse().toString(),
};

const turn = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let index = 0; index < 50; index++) await turn(); };

// Waits on the clock rather than a count of turns: a slow Windows runner outran 20,000 turns
// before sign-in finished, and the test went on as if it had.
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the sync service');
    await turn();
  }
  await settle();
}

async function computer(github: FakeGitHub, name: string, dir?: string, file?: string, sources: readonly SyncSource[] = [], extra: Partial<SyncServiceDeps> = {}) {
  const folder = dir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-sync-service-'));
  const timers = new FakeTimers();
  const views: SyncView[] = [];
  const opened: string[] = [];
  const journal: string[] = [];
  const service = new SyncService({
    dir: folder, fetch: github.fetch, cipher, platform: 'linux', appVersion: '0.12.0', deviceName: name,
    send: (view) => views.push(view), journal: (message) => journal.push(message), openExternal: async (url) => { opened.push(url); }, chooseFile: async () => file ?? null,
    now: () => 1_800_000_000_000 + timers.time, timers, pause: async () => undefined, passphraseCost: { N: 2 ** 14, r: 8, p: 1 }, sources: () => sources, ...extra,
  });
  await service.init();
  const tick = async (ms = 0) => {
    await timers.advance(ms);
    for (let round = 0; round < 20; round++) {
      await until(() => service.view().status !== 'syncing');
      if (!timers.hasDue()) break;
      await timers.advance(0);
    }
  };
  return { service, views, opened, journal, timers, dir: folder, tick, view: () => service.view() };
}

async function signIn(device: Awaited<ReturnType<typeof computer>>) {
  await device.service.handle('sync.connect', {});
  await until(() => device.view().userCode === null);
}

async function setUpFirst(github: FakeGitHub, passphrase: string | null = null, sources: readonly SyncSource[] = [], extra: Partial<SyncServiceDeps> = {}) {
  const first = await computer(github, 'Office PC', undefined, undefined, sources, extra);
  await signIn(first);
  await first.service.handle('sync.chooseRepository', { id: REPO });
  const view = await first.service.handle('sync.create', { passphrase });
  const groups = view.recoveryCode!.split('-');
  await first.service.handle('sync.confirmRecovery', { answers: view.recoveryCheck.map((group) => groups[group - 1].toLowerCase()) });
  await first.tick();
  return { first, recoveryCode: view.recoveryCode! };
}

function fakeGitHub() {
  const github = new FakeGitHub();
  github.addRepository(REPO, 'octotrader/openterm5-sync');
  return github;
}

test('the first computer signs in, chooses a repository, saves its code and syncs', async () => {
  const github = fakeGitHub();
  const first = await computer(github, 'Office PC');
  assert.equal(first.view().phase, 'off');
  github.pendingPolls = 2;
  await first.service.handle('sync.connect', {});
  assert.deepEqual([first.view().phase, first.view().userCode], ['signingIn', 'WDJB-MJHT']);
  assert.deepEqual(first.opened, ['https://github.com/login/device']);
  await until(() => first.view().userCode === null);
  assert.equal(first.view().phase, 'choosingRepository');
  assert.equal(first.view().login, 'octotrader');
  assert.deepEqual(first.view().repositories, [{ id: REPO, fullName: 'octotrader/openterm5-sync', isPrivate: true }]);

  await first.service.handle('sync.chooseRepository', { id: REPO });
  assert.equal(first.view().phase, 'creating');
  const saving = await first.service.handle('sync.create', { passphrase: null });
  assert.equal(saving.phase, 'savingCode');
  assert.match(saving.recoveryCode!, /^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
  assert.equal(saving.recoveryCheck.length, 2);
  await assert.rejects(first.service.handle('sync.confirmRecovery', { answers: ['AAAA', 'BBBB'] }), /do not match/);
  const groups = saving.recoveryCode!.split('-');
  await first.service.handle('sync.confirmRecovery', { answers: saving.recoveryCheck.map((group) => ` ${groups[group - 1].toLowerCase()} `) });
  assert.equal(first.view().phase, 'on');
  assert.equal(first.view().recoveryCode, null);

  await first.tick();
  const view = first.view();
  assert.equal(view.status, 'idle');
  assert.ok(view.lastSyncedAt);
  assert.deepEqual(view.devices.map((device) => [device.name, device.isThisComputer]), [['Office PC', true]]);
  const files = github.contents(REPO);
  assert.ok(files.has('format.json') && files.has('keyring.json') && files.has('manifest'));
  for (const content of files.values()) assert.ok(!content.includes('Office PC'), 'the device name is never stored in the clear');
});

test('a second computer joins with the recovery code and both list each other', async () => {
  const github = fakeGitHub();
  const { first, recoveryCode } = await setUpFirst(github);
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  assert.equal(second.view().phase, 'joining');
  await assert.rejects(second.service.handle('sync.join', { recoveryCode: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345' }), /mistyped|Wrong recovery code/);
  await second.service.handle('sync.join', { recoveryCode: recoveryCode.toLowerCase() });
  await second.tick();
  assert.equal(second.view().status, 'idle');
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.deepEqual(first.view().devices.map((device) => device.name).sort(), ['Laptop', 'Office PC']);
  const keyring = JSON.parse(github.contents(REPO).get('keyring.json')!.toString()) as { wraps: { kind: string }[] };
  assert.equal(keyring.wraps.filter((wrap) => wrap.kind === 'device').length, 2);
});

test('a passphrase unlocks sync on another computer', async () => {
  const github = fakeGitHub();
  await setUpFirst(github, 'four words make a phrase');
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await assert.rejects(second.service.handle('sync.join', { passphrase: 'not the phrase at all' }), /Wrong passphrase/);
  await second.service.handle('sync.join', { passphrase: 'four words make a phrase' });
  assert.equal(second.view().phase, 'on');
});

test('short passphrases, public repositories and repositories with other files are refused', async () => {
  const github = fakeGitHub();
  github.addRepository(7, 'octotrader/website', false);
  github.addRepository(9, 'octotrader/notes');
  await github.fetch('https://api.github.com/repos/octotrader/notes/contents/notes.md', { method: 'PUT', headers: { Authorization: 'Bearer ghu_x' }, body: JSON.stringify({ content: Buffer.from('hi').toString('base64') }) });
  const first = await computer(github, 'Office PC');
  await signIn(first);
  await assert.rejects(first.service.handle('sync.chooseRepository', { id: 7 }), /public/);
  await assert.rejects(first.service.handle('sync.chooseRepository', { id: 9 }), /other files/);
  await assert.rejects(first.service.handle('sync.chooseRepository', { id: 99 }), /cannot reach/);
  await first.service.handle('sync.chooseRepository', { id: REPO });
  await assert.rejects(first.service.handle('sync.create', { passphrase: 'short' }), /14 characters/);
});

test('after a restart sync carries on without asking again', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  const again = await computer(github, 'Office PC', first.dir);
  assert.equal(again.view().phase, 'on');
  await again.tick();
  assert.equal(again.view().status, 'idle');
});

test('a revoked GitHub sign-in asks to reconnect, and reconnecting resumes', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  github.isTokenRevoked = true;
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.equal(first.view().attention?.reason, 'reconnect');
  await assert.rejects(first.service.handle('sync.syncNow', {}), /Reconnect GitHub first/);
  github.isTokenRevoked = false;
  await first.service.handle('sync.connect', {});
  await until(() => first.view().userCode === null);
  await first.tick();
  assert.equal(first.view().attention, null);
  assert.equal(first.view().status, 'idle');
});

test('being offline retries later instead of stopping', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  github.isOffline = true;
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.equal(first.view().status, 'offline');
  assert.equal(first.view().attention, null);
  assert.ok(first.view().nextRunAt);
  github.isOffline = false;
  await first.tick(30_000);
  assert.equal(first.view().status, 'idle');
});

test('an unexpected failure retries quietly, is journalled once and clears on its own', async () => {
  const github = fakeGitHub();
  const chart = new MemorySource('chart');
  const { first } = await setUpFirst(github, null, [chart]);
  const snapshot = chart.snapshot.bind(chart);
  let failures = 2;
  chart.snapshot = async () => {
    if (failures-- > 0) throw new Error('disk busy');
    return snapshot();
  };
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.equal(first.view().status, 'retrying');
  assert.equal(first.view().attention, null);
  assert.ok(first.view().nextRunAt);
  await first.tick(30_000);
  assert.equal(first.view().status, 'retrying');
  assert.equal(first.journal.filter((line) => line.includes('disk busy')).length, 1);
  await first.tick(60_000);
  assert.equal(first.view().status, 'idle');
  assert.equal(first.view().error, null);
});

test('an altered manifest stops sync and says why', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  github.tamper(REPO, 'manifest', (content) => {
    const bytes = Buffer.from(content.toString(), 'base64');
    bytes[30] ^= 1;
    return Buffer.from(bytes.toString('base64'));
  });
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.equal(first.view().attention?.reason, 'tampered');
  assert.equal(first.view().status, 'attention');
});

test('a new recovery code replaces the old one', async () => {
  const github = fakeGitHub();
  const { first, recoveryCode } = await setUpFirst(github);
  const renewed = await first.service.handle('sync.newRecoveryCode', {});
  assert.equal(renewed.phase, 'savingCode');
  assert.notEqual(renewed.recoveryCode, recoveryCode);
  assert.equal(renewed.isRecoveryConfirmed, false);
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await assert.rejects(second.service.handle('sync.join', { recoveryCode }), /Wrong recovery code/);
  await second.service.handle('sync.join', { recoveryCode: renewed.recoveryCode! });
  assert.equal(second.view().phase, 'on');
});

test('disconnecting forgets this computer\'s keys and state but leaves the repository', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  const before = github.contents(REPO);
  await first.service.handle('sync.disconnect', {});
  assert.equal(first.view().phase, 'off');
  await assert.rejects(fs.access(path.join(first.dir, 'sync-state.json')));
  const stored = JSON.parse(await fs.readFile(path.join(first.dir, 'sync-credentials.json'), 'utf8')) as { secrets: unknown; target: unknown };
  assert.deepEqual([stored.secrets, stored.target], [null, null]);
  assert.deepEqual([...github.contents(REPO).keys()].sort(), [...before.keys()].sort());
});

test('a new computer joins by approval from a linked one, after comparing six words', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  const waiting = await second.service.handle('sync.requestPairing', {});
  assert.equal(waiting.phase, 'pairing');
  assert.equal(waiting.pairingWords.length, 6);

  await first.service.handle('sync.syncNow', {});
  await first.tick();
  const [request] = first.view().pairingRequests;
  assert.deepEqual(request.words, waiting.pairingWords);
  await first.service.handle('sync.answerPairing', { deviceId: request.deviceId, isApproved: true });
  assert.deepEqual(first.view().pairingRequests, []);

  const confirmation = first.view().pairingConfirmation;
  assert.equal(confirmation.length, 3);

  await second.timers.advance(5000);
  await until(() => second.view().isPairingApproved);
  assert.equal(second.view().phase, 'pairing', 'a received key is not trusted until confirmed');
  await assert.rejects(second.service.handle('sync.confirmPairing', { words: 'apple apple apple' }), /do not match/);
  await second.service.handle('sync.confirmPairing', { words: ` ${confirmation.join('  ').toUpperCase()} ` });
  assert.equal(second.view().phase, 'on');
  await second.tick();
  assert.equal(second.view().status, 'idle');
  assert.deepEqual(second.view().pairingWords, []);
  await first.service.handle('sync.dismissConfirmation', {});
  assert.deepEqual(first.view().pairingConfirmation, []);
});

// What someone holding the GitHub token can do while a computer waits: wrap a key of their own to it.
async function plantKey(github: FakeGitHub, isManifestDeleted: boolean) {
  const repository = { id: REPO, fullName: 'octotrader/openterm5-sync', branch: 'main', isPrivate: true };
  const remote = new GitHubRemote(new GitHubApi(github.fetch, async () => 'ghu_attacker'), repository);
  const setup = await inspectRepository(remote, REPO);
  const [request] = setup.kind === 'sync' ? setup.pairing : [];
  await updateKeyring(remote, REPO, (keyring) => withDeviceWrap(keyring, newRootKey(), REPO, { id: request.deviceId, publicKey: request.publicKey }));
  if (isManifestDeleted) await remote.commit(await remote.head(), new Map([['manifest', null]]));
}

test('a key planted for a waiting computer that does not open the synced data is refused', async () => {
  const github = fakeGitHub();
  await setUpFirst(github);
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await second.service.handle('sync.requestPairing', {});
  await plantKey(github, false);
  await second.timers.advance(5000);
  await until(() => second.view().error !== null);
  assert.match(second.view().error!, /does not open the synced data/);
  assert.equal(second.view().isPairingApproved, false);
  assert.notEqual(second.view().phase, 'on');
});

test('a planted key that passes the data check still needs the words, and three misses refuse it', async () => {
  const github = fakeGitHub();
  await setUpFirst(github);
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await second.service.handle('sync.requestPairing', {});
  await plantKey(github, true);
  await second.timers.advance(5000);
  await until(() => second.view().isPairingApproved);
  for (const guess of ['apple banana cherry', 'tiger zebra whale']) await assert.rejects(second.service.handle('sync.confirmPairing', { words: guess }), /do not match/);
  await assert.rejects(second.service.handle('sync.confirmPairing', { words: 'owl fox swan' }), /refused/);
  assert.deepEqual([second.view().phase, second.view().isPairingApproved], ['joining', false]);
  const stored = JSON.parse(await fs.readFile(path.join(second.dir, 'sync-credentials.json'), 'utf8')) as { target: unknown };
  assert.equal(stored.target, null, 'nothing about the planted key was kept');
});

test('a declined or cancelled pairing request goes away', async () => {
  const github = fakeGitHub();
  const { first } = await setUpFirst(github);
  const second = await computer(github, 'Laptop');
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await second.service.handle('sync.requestPairing', {});
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  await first.service.handle('sync.answerPairing', { deviceId: first.view().pairingRequests[0].deviceId, isApproved: false });
  await second.timers.advance(5000);
  await settle();
  assert.equal(second.view().phase, 'pairing', 'still waiting, nothing was granted');
  await second.service.handle('sync.cancelPairing', {});
  assert.equal(second.view().phase, 'joining');
});

test('without GitHub, two computers sync through a sync file', async () => {
  const github = new FakeGitHub();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-sync-file-'));
  const file = path.join(dir, 'OpenTerm5.ot5sync');
  const first = await computer(github, 'Office PC', undefined, file);
  await first.service.handle('sync.useFile', { mode: 'new' });
  assert.deepEqual([first.view().phase, first.view().backend, first.view().repository], ['creating', 'file', file]);
  const saving = await first.service.handle('sync.create', { passphrase: null });
  const groups = saving.recoveryCode!.split('-');
  await first.service.handle('sync.confirmRecovery', { answers: saving.recoveryCheck.map((group) => groups[group - 1]) });
  await first.tick();
  assert.equal(first.view().status, 'idle');

  const second = await computer(github, 'Laptop', undefined, file);
  await second.service.handle('sync.useFile', { mode: 'open' });
  assert.equal(second.view().phase, 'joining');
  await second.service.handle('sync.join', { recoveryCode: saving.recoveryCode! });
  await second.tick();
  assert.equal(second.view().status, 'idle');
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.deepEqual(first.view().devices.map((device) => device.name).sort(), ['Laptop', 'Office PC']);
  assert.equal(github.requests.length, 0, 'GitHub is never contacted');

  await fs.rename(file, `${file}.away`);
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.equal(first.view().status, 'offline');
  assert.equal(first.view().attention, null);
});

test('a computer joining synced layouts asks whether to merge its own or use the synced ones', async () => {
  const github = fakeGitHub();
  const office = new MemorySource('chart');
  office.data = { c1: { symbol: 'XAUUSD' } };
  const { recoveryCode } = await setUpFirst(github, null, [office]);
  const laptop = new MemorySource('chart');
  laptop.data = { c9: { symbol: 'EURUSD' } };
  const second = await computer(github, 'Laptop', undefined, undefined, [laptop]);
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await second.service.handle('sync.join', { recoveryCode });
  await second.tick(60_000);
  assert.equal(second.view().attention?.reason, 'join');
  assert.deepEqual(laptop.data, { c9: { symbol: 'EURUSD' } });
  await second.service.handle('sync.resolve', { choice: 'useSynced' });
  await second.tick();
  assert.equal(second.view().status, 'idle');
  assert.deepEqual(laptop.data, { c1: { symbol: 'XAUUSD' } });
});

test('a computer joining a repository with no layouts yet syncs without asking', async () => {
  const github = fakeGitHub();
  const { recoveryCode } = await setUpFirst(github, null, [new MemorySource('chart')]);
  const laptop = new MemorySource('chart');
  laptop.data = { c9: { symbol: 'EURUSD' } };
  const second = await computer(github, 'Laptop', undefined, undefined, [laptop]);
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await second.service.handle('sync.join', { recoveryCode });
  await second.tick();
  assert.equal(second.view().attention, null);
  assert.equal(second.view().status, 'idle');
});

async function joinSecond(github: FakeGitHub, recoveryCode: string, sources: readonly SyncSource[], dir?: string) {
  const second = await computer(github, 'Laptop', dir, undefined, sources);
  await signIn(second);
  await second.service.handle('sync.chooseRepository', { id: REPO });
  await second.service.handle('sync.join', { recoveryCode });
  await second.tick();
  return second;
}

test('turning on one CID asks which to keep when the synced one differs, then adopts it', async () => {
  const github = fakeGitHub();
  const officeCid = new MemorySource('identity');
  officeCid.data = { cid: { cid: 'a'.repeat(32), isUnique: true } };
  const { first, recoveryCode } = await setUpFirst(github, null, [officeCid]);
  await first.service.handle('sync.setSharing', { isSecretsSynced: false, isIdentitySynced: true });
  await first.tick();
  assert.equal(first.view().isIdentitySynced, true);
  const laptopCid = new MemorySource('identity');
  laptopCid.data = { cid: { cid: 'b'.repeat(32), isUnique: true } };
  const second = await joinSecond(github, recoveryCode, [laptopCid]);
  await second.service.handle('sync.setSharing', { isSecretsSynced: false, isIdentitySynced: true });
  assert.deepEqual([second.view().isIdentityChoiceNeeded, second.view().isIdentitySynced], [true, false]);
  await second.service.handle('sync.setSharing', { isSecretsSynced: false, isIdentitySynced: true, identityChoice: 'synced' });
  await second.tick();
  assert.deepEqual(laptopCid.data, officeCid.data);
  assert.equal(second.view().isIdentityChoiceNeeded, false);
});

test('passwords stay on a computer until it opts in, and only computers that opted in receive them', async () => {
  const github = fakeGitHub();
  const officeSecrets = new MemorySource('accountSecret');
  officeSecrets.data = { 'wss://broker.example/terminal|1': { secret: 'pw', savedAt: 1 } };
  const { first, recoveryCode } = await setUpFirst(github, null, [officeSecrets]);
  const laptopSecrets = new MemorySource('accountSecret');
  const second = await joinSecond(github, recoveryCode, [laptopSecrets]);
  await second.service.handle('sync.setSharing', { isSecretsSynced: true, isIdentitySynced: false });
  await second.tick();
  assert.deepEqual(laptopSecrets.data, {});
  await first.service.handle('sync.setSharing', { isSecretsSynced: true, isIdentitySynced: false });
  await first.tick();
  await second.service.handle('sync.syncNow', {});
  await second.tick();
  assert.deepEqual(laptopSecrets.data, officeSecrets.data);
});

test('the merge question survives a restart, and Merge keeps the synced settings', async () => {
  const github = fakeGitHub();
  const office = new MemorySource('preferences');
  office.data = { workspace: { theme: 'dark' } };
  const { recoveryCode } = await setUpFirst(github, null, [office]);
  const laptop = new MemorySource('preferences');
  laptop.data = { workspace: { theme: 'light', replayMode: 'allCharts' } };
  const second = await joinSecond(github, recoveryCode, [laptop]);
  assert.equal(second.view().attention?.reason, 'join');
  second.service.shutdown();
  const restarted = await computer(github, 'Laptop', second.dir, undefined, [laptop]);
  await restarted.tick(60_000);
  assert.equal(restarted.view().attention?.reason, 'join');
  assert.deepEqual(laptop.data, { workspace: { theme: 'light', replayMode: 'allCharts' } });
  await restarted.service.handle('sync.resolve', { choice: 'merge' });
  await restarted.tick();
  assert.deepEqual(laptop.data, { workspace: { theme: 'dark', replayMode: 'allCharts' } });
  assert.equal(restarted.view().attention, null);
});

test('an account open on one computer shows there, and moving it here logs that computer out', async () => {
  const github = fakeGitHub();
  const account = 'wss://broker.example/terminal|1234';
  let live = [{ id: account, since: 0 }];
  const released: [readonly string[], string][] = [];
  const { first, recoveryCode } = await setUpFirst(github, null, [], {
    liveAccounts: () => live,
    releaseAccounts: async (ids, to) => { released.push([ids, to]); live = []; },
  });
  first.service.presenceChanged();
  await first.tick(5000);
  const second = await joinSecond(github, recoveryCode, []);
  assert.deepEqual(await second.service.whereOpen(account), ['Office PC']);
  assert.equal(await second.service.moveHere(account), false);
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.deepEqual(released, [[[account], 'Laptop']]);
  assert.deepEqual(await second.service.whereOpen(account), []);
  assert.equal(await second.service.moveHere(account), true);
});

test('a login made after the move request is a choice to come back, so it stays', async () => {
  const github = fakeGitHub();
  const account = 'wss://broker.example/terminal|1234';
  let live = [{ id: account, since: 0 }];
  const released: string[] = [];
  const { first, recoveryCode } = await setUpFirst(github, null, [], { liveAccounts: () => live, releaseAccounts: async (ids) => { released.push(...ids); } });
  first.service.presenceChanged();
  await first.tick(5000);
  const second = await joinSecond(github, recoveryCode, []);
  await second.service.moveHere(account);
  live = [{ id: account, since: Number.MAX_SAFE_INTEGER }];
  await first.service.handle('sync.syncNow', {});
  await first.tick();
  assert.deepEqual(released, []);
});
