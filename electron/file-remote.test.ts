import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileRemote, SyncFileDamagedError, SyncFileUnavailableError } from './file-remote';
import { deriveKeys, newRootKey } from './sync-crypto';
import { SyncEngine } from './sync-engine';
import { MemorySource, MemoryStore } from './sync-engine-fixtures';

async function folder(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openterm-sync-file-'));
}

test('a new sync file is created on the first commit, then commits need the current head', async () => {
  const file = path.join(await folder(), 'OpenTerm5.ot5sync');
  const creating = new FileRemote(file, true);
  assert.equal(await creating.head(), null);
  const first = (await creating.commit(null, new Map([['format.json', Buffer.from('{}')], ['objects/aa/bb', Buffer.from([1, 2, 3])]])))!;
  const remote = new FileRemote(file);
  assert.equal(await remote.head(), first);
  assert.deepEqual((await remote.read(first, ['objects/aa/bb'])).get('objects/aa/bb'), Buffer.from([1, 2, 3]));
  const second = (await remote.commit(first, new Map([['objects/aa/bb', null]])))!;
  assert.equal(await remote.commit(first, new Map([['x.json', Buffer.from('1')]])), null);
  assert.equal((await remote.read(second, ['objects/aa/bb'])).get('objects/aa/bb'), null);
  await assert.rejects(remote.read(first, ['format.json']), SyncFileUnavailableError);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('a missing file reads as unavailable, never as empty, once sync is set up', async () => {
  const dir = await folder();
  await assert.rejects(new FileRemote(path.join(dir, 'gone.ot5sync')).head(), SyncFileUnavailableError);
  await assert.rejects(new FileRemote(path.join(dir, 'no-such-folder', 'new.ot5sync'), true).head(), SyncFileUnavailableError);
  const other = path.join(dir, 'notes.txt');
  await fs.writeFile(other, 'hello');
  await assert.rejects(new FileRemote(other).head(), SyncFileDamagedError);
});

test('two engines sync through one file', async () => {
  const file = path.join(await folder(), 'shared.ot5sync');
  const rootKey = newRootKey();
  const computer = (id: string, isNew: boolean) => {
    const source = new MemorySource('layout');
    const engine = new SyncEngine({
      epoch: 1, repoId: 123, keys: deriveKeys(rootKey), remote: new FileRemote(file, isNew), store: new MemoryStore(), sources: [source],
      device: { id, name: id, platform: 'linux', publicKey: 'k', appVersion: '0.12.0' }, pause: async () => undefined,
    });
    return { source, engine };
  };
  const a = computer('a', true);
  a.source.data = { L1: { name: 'Gold' } };
  await a.engine.sync();
  const b = computer('b', false);
  b.source.data = { L2: { name: 'Silver' } };
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.source.data, { L1: { name: 'Gold' }, L2: { name: 'Silver' } });
  assert.deepEqual(b.source.data, a.source.data);
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('Gold'));
});
