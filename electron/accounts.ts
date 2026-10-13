import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AccountRegistry, type PasswordCipher } from './account-registry';

// Linux's basic_text backend obfuscates rather than encrypts, so it does not count.
export const secretCipher: PasswordCipher = {
  canEncrypt: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
};

export async function loadAccounts(): Promise<AccountRegistry> {
  const file = path.join(app.getPath('userData'), 'accounts.json');
  const registry = new AccountRegistry(secretCipher, async (profiles) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(profiles, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  });
  try { registry.load(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Saved accounts could not be read. Account storage is disabled for this session.');
  }
  return registry;
}
