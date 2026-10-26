// The sync ledger, in IndexedDB: it keeps TradingView's whole record for every synced drawing, and
// an account's thousand-odd drawings would crowd localStorage's quota.

const DATABASE = 'openterm-tradingview-sync';
const DRAWINGS = 'drawings';

let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DRAWINGS);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The TradingView sync store could not be opened.'));
  }));
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('The TradingView sync store could not be written.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Writing the TradingView sync store was cancelled.'));
  });
}

export async function loadLedger(): Promise<[string, unknown][]> {
  const db = await open();
  const store = db.transaction(DRAWINGS).objectStore(DRAWINGS);
  const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()].map((request) => new Promise<unknown[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error ?? new Error('The TradingView sync store could not be read.'));
  })));
  return keys.map((key, index) => [String(key), values[index]]);
}

// Writes entries (by drawing id) and deletes ids, in one transaction.
export async function saveLedger(entries: readonly [string, unknown][], removals: readonly string[]): Promise<void> {
  if (!entries.length && !removals.length) return;
  const db = await open();
  const transaction = db.transaction(DRAWINGS, 'readwrite');
  const store = transaction.objectStore(DRAWINGS);
  for (const [id, entry] of entries) store.put(entry, id);
  for (const id of removals) store.delete(id);
  await finished(transaction);
}
