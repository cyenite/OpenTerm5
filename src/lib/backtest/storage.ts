// Backtest sessions on disk, in IndexedDB: a long session's deals, trades and equity curve can run
// to megabytes, past what localStorage holds beside the workspace.

const DATABASE = 'openterm-backtests';
const SESSIONS = 'sessions';

let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SESSIONS, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The backtest store could not be opened.'));
  }));
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('The backtest store could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Writing the backtest store was cancelled.'));
  });
}

export async function loadSessionRecords(): Promise<unknown[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SESSIONS).objectStore(SESSIONS).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The backtest store could not be read.'));
  });
}

export async function saveSessionRecord(record: { id: string }): Promise<void> {
  const db = await open();
  const transaction = db.transaction(SESSIONS, 'readwrite');
  transaction.objectStore(SESSIONS).put(record);
  await finished(transaction);
}

export async function deleteSessionRecord(id: string): Promise<void> {
  const db = await open();
  const transaction = db.transaction(SESSIONS, 'readwrite');
  transaction.objectStore(SESSIONS).delete(id);
  await finished(transaction);
}
