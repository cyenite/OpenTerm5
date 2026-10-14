import { app } from 'electron';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const marker = '.migrated-profile';
const legacyNames = ['OpenTerm', 'Terminal5'];
const ownFiles = ['connection.json', 'accounts.json', 'automation.json', 'Local Storage'];

// OpenTerm5 was previously called OpenTerm and, before that, Terminal5. The newest earlier profile
// (connection settings, saved accounts, automation state and the renderer's local storage) is copied
// once so upgrading keeps the user's setup. Chromium creates the new directory before this runs, so
// the check looks for OpenTerm5's own files rather than the directory. Singleton* lock files are
// skipped: copied, they would point at a process that no longer exists.
export function migrateLegacyProfile(): void {
  const current = app.getPath('userData');
  if (existsSync(path.join(current, marker)) || ownFiles.some((name) => existsSync(path.join(current, name)))) return;
  const legacyName = legacyNames.find((name) => existsSync(path.join(app.getPath('appData'), name)));
  if (!legacyName) return;
  try {
    cpSync(path.join(app.getPath('appData'), legacyName), current, { recursive: true, force: false, filter: (source) => !path.basename(source).startsWith('Singleton') });
    writeFileSync(path.join(current, marker), `${legacyName} ${new Date().toISOString()}\n`);
  } catch (error) {
    console.error(`Could not copy the ${legacyName} profile: ${(error as Error).message}`);
  }
}
