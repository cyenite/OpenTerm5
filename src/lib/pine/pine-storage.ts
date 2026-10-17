// Pine scripts on disk, in IndexedDB: a thousand imported scripts are megabytes of source, past
// what localStorage holds. Metadata loads at startup; a source loads when a chart first runs it.

const DATABASE = 'openterm-pine';
const SCRIPTS = 'scripts';
const SOURCES = 'sources';

// Before 2026-10-16 15:50 scripts, sources included, lived in localStorage under this key.
const LEGACY_KEY = 'openterm.pine-scripts.v1';

let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SCRIPTS, { keyPath: 'id' });
      request.result.createObjectStore(SOURCES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The Pine script store could not be opened.'));
  }));
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('The Pine script store could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Writing the Pine script store was cancelled.'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The Pine script store could not be read.'));
  });
}

export async function loadScriptRecords(): Promise<unknown[]> {
  const db = await open();
  await migrateLegacy(db);
  return result(db.transaction(SCRIPTS).objectStore(SCRIPTS).getAll());
}

export async function loadSource(id: string): Promise<string | undefined> {
  const db = await open();
  const source = await result(db.transaction(SOURCES).objectStore(SOURCES).get(id));
  return typeof source === 'string' ? source : undefined;
}

export async function saveScript(record: { id: string }, source: string): Promise<void> {
  const db = await open();
  const transaction = db.transaction([SCRIPTS, SOURCES], 'readwrite');
  transaction.objectStore(SCRIPTS).put(record);
  transaction.objectStore(SOURCES).put(source, record.id);
  await finished(transaction);
}

export async function deleteScripts(ids: readonly string[]): Promise<void> {
  const db = await open();
  const transaction = db.transaction([SCRIPTS, SOURCES], 'readwrite');
  for (const id of ids) {
    transaction.objectStore(SCRIPTS).delete(id);
    transaction.objectStore(SOURCES).delete(id);
  }
  await finished(transaction);
}

// Moves scripts saved in localStorage into the database, then drops the old key.
async function migrateLegacy(db: IDBDatabase): Promise<void> {
  let legacy: unknown;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null');
  } catch {
    legacy = null;
  }
  if (!Array.isArray(legacy)) return;
  const transaction = db.transaction([SCRIPTS, SOURCES], 'readwrite');
  for (const entry of legacy) {
    if (!entry || typeof entry !== 'object') continue;
    const { source, ...record } = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof source !== 'string') continue;
    transaction.objectStore(SCRIPTS).put(record);
    transaction.objectStore(SOURCES).put(source, record.id);
  }
  await finished(transaction);
  localStorage.removeItem(LEGACY_KEY);
}
