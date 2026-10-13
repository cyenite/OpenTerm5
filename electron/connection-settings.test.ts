import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEndpoint, parseSettings } from './connection-settings';

test('legacy simulator settings migrate to direct web without retaining secrets or process options', () => {
  assert.deepEqual(parseSettings({ connectionMode: 'bridge', isSimulator: true, python: 'python3', url: 'ws://localhost:8765', token: 'legacy-secret' }), { webEndpoint: defaultEndpoint });
});

test('migration preserves a broker web endpoint and strips obsolete fields', () => {
  assert.deepEqual(parseSettings({ webEndpoint: 'wss://broker.example/terminal', connectionMode: 'bridge', password: 'obsolete-secret' }), { webEndpoint: 'wss://broker.example/terminal' });
});

test('settings reject endpoints with plaintext transport, credentials, fragments or invalid types', () => {
  for (const webEndpoint of ['ws://broker.example/terminal', 'https://broker.example', 'wss://user:secret@broker.example', 'wss://broker.example/#fragment', '', null, 5]) {
    assert.throws(() => parseSettings({ webEndpoint }));
  }
  assert.throws(() => parseSettings(null));
});
