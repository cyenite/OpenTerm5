import { app } from 'electron';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const marker = '.migrated-from-terminal5';
const ownFiles = ['connection.json', 'accounts.json', 'automation.json', 'Local Storage'];

// OpenTerm was called Terminal5. Its profile (connection settings, saved accounts, automation state
// and the renderer's local storage) is copied once so upgrading keeps the user's setup. Chromium
// creates the new directory before this runs, so the check looks for OpenTerm's own files rather
// than the directory. Singleton* lock files are skipped: copied, they would point at a dead process.
export function migrateLegacyProfile(): void {
  const current = app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), 'Terminal5');
  if (!existsSync(legacy) || existsSync(path.join(current, marker))) return;
  if (ownFiles.some((name) => existsSync(path.join(current, name)))) return;
  try {
    cpSync(legacy, current, { recursive: true, force: false, filter: (source) => !path.basename(source).startsWith('Singleton') });
    writeFileSync(path.join(current, marker), `${new Date().toISOString()}\n`);
  } catch (error) {
    console.error(`Could not copy the Terminal5 profile: ${(error as Error).message}`);
  }
}
