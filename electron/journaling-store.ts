import { randomUUID } from 'node:crypto';
import { defaultPlatformUrl, journalPlans, parsePlatformUrl, syncStates, type JournalUser, type SyncState } from '../shared/journaling';
import type { PasswordCipher } from './account-registry';
import type { ApiCredentials } from './journaling-http';

export interface StoredAccount {
  readonly key: string;
  readonly server: string;
  readonly state: SyncState;
  readonly login: number;
  readonly cursor: number | null;
  readonly lastSyncAt: number | null;
  readonly message: string | null;
  readonly isEnabled: boolean;
}

export interface StoredJournaling {
  readonly deviceId: string;
  readonly platformUrl: string;
  readonly user: JournalUser | null;
  // The Tradescribe user the cursors were synced for; another user starts again from scratch.
  readonly cursorOwner: string | null;
  // Cipher text of the API key and secret, only when the OS keychain can encrypt.
  readonly credentials: string | null;
  readonly offsets: Readonly<Record<string, number>>;
  readonly accounts: readonly StoredAccount[];
}

// Work that was under way when the app closed is not under way after a restart.
const transientStates: readonly SyncState[] = ['syncing', 'waiting', 'limited'];

export const accountKey = (login: number, server: string) => `${login}@${server}`;

export function emptyJournaling(): StoredJournaling {
  return { deviceId: randomUUID(), platformUrl: defaultPlatformUrl, user: null, cursorOwner: null, credentials: null, offsets: {}, accounts: [] };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 512) => typeof value === 'string' && value.length <= limit ? value : null;
const time = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

function parseUser(value: unknown): JournalUser | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const plan = journalPlans.find((item) => item.key === value.plan)?.key ?? 'free';
  return id ? { id, name: text(value.name) ?? '', plan, email: text(value.email) ?? '' } : null;
}

function parseAccount(value: unknown): StoredAccount | null {
  if (!isRecord(value)) return null;
  const server = text(value.server, 256);
  const login = value.login;
  if (!server || typeof login !== 'number' || !Number.isSafeInteger(login) || login <= 0) return null;
  const saved = syncStates.find((item) => item.key === value.state)?.key ?? 'idle';
  return {
    key: accountKey(login, server), server, login,
    state: transientStates.includes(saved) ? 'idle' : saved,
    cursor: time(value.cursor), lastSyncAt: time(value.lastSyncAt), message: text(value.message, 2000),
    isEnabled: value.isEnabled !== false,
  };
}

export function parseJournaling(value: unknown): StoredJournaling {
  const fallback = emptyJournaling();
  if (!isRecord(value)) return fallback;
  let platformUrl = defaultPlatformUrl;
  try { platformUrl = parsePlatformUrl(String(value.platformUrl ?? defaultPlatformUrl)); } catch { platformUrl = defaultPlatformUrl; }
  const offsets = Object.fromEntries(Object.entries(isRecord(value.offsets) ? value.offsets : {})
    .filter(([server, minutes]) => server.length <= 256 && typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= -720 && minutes <= 840)) as Record<string, number>;
  const accounts = (Array.isArray(value.accounts) ? value.accounts : []).slice(0, 1000).map(parseAccount).filter((account): account is StoredAccount => !!account);
  return {
    deviceId: text(value.deviceId, 64) ?? fallback.deviceId,
    platformUrl,
    user: parseUser(value.user),
    cursorOwner: text(value.cursorOwner),
    credentials: text(value.credentials, 8192),
    offsets,
    accounts: [...new Map(accounts.map((account) => [account.key, account])).values()],
  };
}

export function encodeCredentials(cipher: PasswordCipher, credentials: ApiCredentials): string | null {
  return cipher.canEncrypt() ? cipher.encrypt(JSON.stringify({ key: credentials.key, secret: credentials.secret })) : null;
}

export function decodeCredentials(cipher: PasswordCipher, stored: string | null): ApiCredentials | null {
  if (!stored) return null;
  const value: unknown = JSON.parse(cipher.decrypt(stored));
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.secret !== 'string') throw new Error('Saved journaling credentials are damaged.');
  return { key: value.key, secret: value.secret };
}
