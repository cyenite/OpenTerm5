import type { ConnectionSettings } from '../shared/protocol';

export const defaultEndpoint = 'wss://web.metatrader.app/terminal';

export function parseSettings(value: unknown): ConnectionSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid connection settings.');
  const { webEndpoint } = value as { webEndpoint?: unknown };
  const endpoint = webEndpoint === undefined ? defaultEndpoint : webEndpoint;
  if (typeof endpoint !== 'string') throw new Error('Invalid web endpoint.');
  const url = new URL(endpoint);
  if (url.protocol !== 'wss:' || url.username || url.password || url.hash) {
    throw new Error('Enter a secure WebSocket endpoint without credentials or a fragment.');
  }
  return { webEndpoint: url.href };
}
