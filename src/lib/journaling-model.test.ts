import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AccountSync, JournalingView } from '../../shared/journaling';
import { accountRows, formatPnl, journalStatus, relativeTime, splitList } from './journaling-model';

const now = Date.UTC(2026, 9, 15, 12, 0, 0);

const sync = (patch: Partial<AccountSync> = {}): AccountSync => ({ key: '5012345@MetaQuotes-Demo', server: 'MetaQuotes-Demo', state: 'synced', login: 5012345, cursor: null, retryAt: null, lastSyncAt: now - 120_000, message: null, isActive: true, isEnabled: true, ...patch });

const view = (patch: Partial<JournalingView> = {}): JournalingView => ({
  flow: 'idle', user: { id: 'u1', name: 'Aaron', plan: 'free', email: 'aaron@example.com' }, usage: null, error: null, features: [],
  accounts: [sync()], platformUrl: 'https://tradescribe.io', pendingLink: null, isConnected: true, isStored: true, isReconnectNeeded: false, ...patch,
});

test('the status bar summarises the active account', () => {
  assert.deepEqual(journalStatus(view(), now), { text: 'Journal synced 2m ago', tone: 'good' });
  assert.deepEqual(journalStatus(view({ accounts: [sync({ state: 'held' })] }), now), { text: 'Journal paused: monthly limit', tone: 'warn' });
  assert.deepEqual(journalStatus(view({ isReconnectNeeded: true, isConnected: false }), now), { text: 'Journal: reconnect', tone: 'bad' });
  assert.equal(journalStatus(view({ isConnected: false, user: null }), now), null);
  assert.equal(journalStatus(null, now), null);
  assert.equal(journalStatus(view({ accounts: [sync({ isActive: false })] }), now)?.text, 'Journal connected');
});

test('relative times', () => {
  assert.equal(relativeTime(now - 10_000, now), 'just now');
  assert.equal(relativeTime(now - 5 * 60_000, now), '5m ago');
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3h ago');
  assert.equal(relativeTime(now - 2 * 86_400_000, now), '2d ago');
});

test('saved accounts show with their sync, and unseen ones default to on', () => {
  const rows = accountRows([{ label: 'Demo', login: 5012345, server: 'MetaQuotes-Demo' }, { label: '', login: 77, server: 'Other-Live' }], [sync(), sync({ key: '9@Gone', login: 9, server: 'Gone', isActive: false })]);
  assert.deepEqual(rows.map((row) => [row.key, row.label, row.sync.isEnabled]), [['5012345@MetaQuotes-Demo', 'Demo', true], ['77@Other-Live', '77', true], ['9@Gone', '9', true]]);
});

test('lists and P/L', () => {
  assert.deepEqual(splitList(' breakout, a-plus ,, breakout'), ['breakout', 'a-plus']);
  assert.equal(formatPnl(42.1), '+42.10');
  assert.equal(formatPnl(-3), '-3.00');
  assert.equal(formatPnl(null), '');
});
