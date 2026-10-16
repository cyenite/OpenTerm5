import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { CopierConfig, CopierLogEntry } from '../shared/automation';
import type { CopyMapping } from './copier';
import { buildCopierAudit } from './copier-audit';
import { defaultFollower } from './copier-math';
import { JsonLog } from './json-store';

const config = (id: string, masterId: string, followerId: string): CopierConfig => ({ id, name: id, status: 'enabled', masterId, followers: [defaultFollower(`${id}-f`, followerId)], createdAt: 0 });

const entry = (copierId: string, time: number): CopierLogEntry => ({ id: `${copierId}-${time}`, time, event: 'open', status: 'ok', symbol: 'EURUSD', message: 'copied', copierId, followerId: `${copierId}-f`, masterTicket: 7, followerTicket: 901 });

const mapping = (copierId: string): CopyMapping => ({
  id: copierId, kind: 'position', status: 'open', symbol: 'EURUSD', copierId, followerId: `${copierId}-f`, masterTicket: 7, followerTicket: 901,
  masterVolume: 1, followerVolume: 0.5, masterStop: 0, masterTarget: 0, masterPrice: 1.1, createdAt: Date.UTC(2026, 9, 15, 9),
});

test('an audit for one copier holds only its configuration, copies, log and accounts', () => {
  const audit = buildCopierAudit({
    copierId: 'a', clientId: 'ab'.repeat(16), appVersion: '0.2.0', exportedAt: Date.UTC(2026, 9, 16),
    configs: [config('a', 'm|1', 'f|2'), config('b', 'm|1', 'f|3')], mappings: [mapping('a'), mapping('b')],
    log: [entry('a', Date.UTC(2026, 9, 15, 9)), entry('b', 0), entry('', 0)],
    account: (id) => ({ id, login: Number(id.split('|')[1]), holder: 'Jane Trader' }),
  });
  assert.equal(audit.format, 'openterm5.copier-audit');
  assert.equal(audit.clientId, 'ab'.repeat(16));
  assert.deepEqual(audit.copiers.map((item) => item.id), ['a']);
  assert.deepEqual(audit.accounts.map((item) => item.id), ['m|1', 'f|2']);
  assert.equal(audit.log.length, 1);
  assert.equal(audit.log[0].time, '2026-10-15T09:00:00.000Z');
  assert.equal(audit.copies[0].createdAt, '2026-10-15T09:00:00.000Z');
  assert.equal(audit.exportedAt, '2026-10-16T00:00:00.000Z');
});

test('the full log includes the rotated file, oldest first', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-log-')), 'copier-log.jsonl');
  await fs.writeFile(`${file}.1`, `${JSON.stringify({ n: 1 })}\n`);
  const log = new JsonLog<{ n: number }>(file);
  log.append({ n: 2 });
  assert.deepEqual(await log.all(), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(await log.tail(1), [{ n: 2 }]);
});
