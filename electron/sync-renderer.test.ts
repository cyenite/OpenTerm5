import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SyncSourceReply, SyncSourceRequest } from '../shared/sync';
import { SyncSourceUnavailableError } from './sync-engine';
import { RendererSources } from './sync-renderer';

function setup(answer: (request: SyncSourceRequest) => SyncSourceReply | null, timeoutMs = 50) {
  const asked: SyncSourceRequest[] = [];
  let hasWindow = true;
  const host: RendererSources = new RendererSources({
    timeoutMs,
    send: (id, request) => {
      if (!hasWindow) return false;
      asked.push(request);
      const reply = answer(request);
      if (reply) queueMicrotask(() => host.receive(id, reply));
      return true;
    },
  });
  const source = (kind: SyncSourceRequest['kind']) => host.sources().find((candidate) => candidate.kind === kind)!;
  return { host, asked, source, closeWindow: () => { hasWindow = false; } };
}

test('nothing is asked before the renderer says its stores have loaded', async () => {
  const { host, asked, source } = setup(() => ({ result: { values: {}, invalid: [] } }));
  await assert.rejects(source('chart').snapshot(), SyncSourceUnavailableError);
  host.setReady(true);
  assert.deepEqual(await source('chart').snapshot(), {});
  assert.equal(asked.length, 1);
});

test('values a snapshot returned are checked without asking again; others are asked about', async () => {
  const values = { c1: { symbol: 'EURUSD' }, c2: { symbol: '' } };
  const { host, asked, source } = setup((request) => request.method === 'snapshot'
    ? { result: { values, invalid: ['c2'] } }
    : request.method === 'validate' && (request.value as { symbol: string }).symbol ? { result: null } : { error: 'Chart c3 is not readable.' });
  host.setReady(true);
  const chart = source('chart');
  const snapshot = await chart.snapshot();
  await chart.validate(snapshot.c1, 'c1');
  await assert.rejects(Promise.resolve(chart.validate(snapshot.c2, 'c2')), /failed its checks/);
  assert.equal(asked.length, 1);
  await chart.validate({ symbol: 'GBPUSD' }, 'c3');
  await assert.rejects(Promise.resolve(chart.validate({ symbol: '' }, 'c3')), (error: Error) => !(error instanceof SyncSourceUnavailableError) && /not readable/.test(error.message));
  assert.deepEqual(asked.slice(1).map((request) => request.method === 'validate' && request.id), ['c3', 'c3']);
});

test('a renderer that stops answering, reloads or has no window fails as unavailable', async () => {
  const { host, source, closeWindow } = setup(() => null, 20);
  host.setReady(true);
  await assert.rejects(source('watchlists').snapshot(), SyncSourceUnavailableError);
  const pending = source('watchlists').apply({ upserts: {}, deletes: [] });
  host.setReady(false);
  await assert.rejects(pending, SyncSourceUnavailableError);
  host.setReady(true);
  closeWindow();
  await assert.rejects(source('watchlists').snapshot(), SyncSourceUnavailableError);
});

test('a malformed snapshot is refused rather than read as empty', async () => {
  const { host, source } = setup(() => ({ result: { values: [], invalid: [] } }));
  host.setReady(true);
  await assert.rejects(source('chart').snapshot(), /malformed/);
});
