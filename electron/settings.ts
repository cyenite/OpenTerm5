import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ConnectionSettings } from '../shared/protocol';
import { defaultEndpoint, parseSettings } from './connection-settings';

const file = () => path.join(app.getPath('userData'), 'connection.json');

export function defaultSettings(): ConnectionSettings {
  return { webEndpoint: defaultEndpoint };
}

export async function loadSettings(): Promise<ConnectionSettings> {
  try {
    return parseSettings(JSON.parse(await fs.readFile(file(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Connection settings unreadable, using defaults');
      return defaultSettings();
    }
  }
  try {
    const settings = parseSettings(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'bridge.json'), 'utf8')));
    await saveSettings(settings);
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Legacy connection settings unreadable, using defaults');
    }
    return defaultSettings();
  }
}

export async function saveSettings(settings: ConnectionSettings): Promise<void> {
  const stored = parseSettings(settings);
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(stored, null, 2), { mode: 0o600 });
}
