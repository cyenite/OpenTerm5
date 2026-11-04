// Account and chart sync: the kinds of synced record and the plain JSON they carry. The engine and
// its crypto live in electron/sync-*.ts; this file stays free of Node so renderer adapters can use it.

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

// How concurrent edits to a record merge (electron/sync-merge.ts):
// - fields: one entry per field; a field missing from a snapshot is unchanged, never deleted.
// - map: one entry per item; an item missing from a snapshot was deleted.
// - set: one entry per member; a concurrent add and remove keeps the member.
// - list: one ordered value; the newer order wins and the other side's additions and removals are kept.
// - text: one value; when both sides changed it, the remote one stays and the local one is copied.
// - value: one value; the newer write wins.
export type SyncShape = 'fields' | 'map' | 'set' | 'list' | 'text' | 'value';

// Declaration order is the order kinds sync in and are listed in. Raise `schema` when a kind's body
// changes shape; older builds then leave records of the newer schema alone instead of rewriting them.
export const syncKinds = [
  { key: 'account', label: 'Accounts', shape: 'fields', schema: 1, isSecret: false },
  { key: 'accountSecret', label: 'Saved passwords and API keys', shape: 'value', schema: 1, isSecret: true },
  { key: 'identity', label: 'CID', shape: 'value', schema: 1, isSecret: true },
  { key: 'webhookSecrets', label: 'Webhook settings', shape: 'fields', schema: 1, isSecret: true },
  { key: 'layout', label: 'Layouts', shape: 'fields', schema: 1, isSecret: false },
  { key: 'layoutOrder', label: 'Layout order', shape: 'list', schema: 1, isSecret: false },
  { key: 'chart', label: 'Charts', shape: 'fields', schema: 1, isSecret: false },
  { key: 'chartDrawings', label: 'Chart drawings', shape: 'map', schema: 1, isSecret: false },
  { key: 'symbolDrawings', label: 'Symbol drawings', shape: 'map', schema: 1, isSecret: false },
  { key: 'chartProfile', label: 'Chart profiles', shape: 'fields', schema: 1, isSecret: false },
  { key: 'chartTemplate', label: 'Chart templates', shape: 'fields', schema: 1, isSecret: false },
  { key: 'drawingTemplates', label: 'Drawing templates', shape: 'map', schema: 1, isSecret: false },
  { key: 'drawingLooks', label: 'Drawing looks', shape: 'map', schema: 1, isSecret: false },
  { key: 'theme', label: 'Themes', shape: 'fields', schema: 1, isSecret: false },
  { key: 'watchlists', label: 'Watchlists', shape: 'map', schema: 1, isSecret: false },
  { key: 'indicatorFavorites', label: 'Indicator favourites', shape: 'set', schema: 1, isSecret: false },
  { key: 'timeframeFavorites', label: 'Timeframe favourites', shape: 'set', schema: 1, isSecret: false },
  { key: 'drawingFavorites', label: 'Drawing favourites', shape: 'set', schema: 1, isSecret: false },
  { key: 'customColors', label: 'Custom colours', shape: 'list', schema: 1, isSecret: false },
  { key: 'priceAlert', label: 'Price alerts', shape: 'fields', schema: 1, isSecret: false },
  { key: 'pineScript', label: 'Pine scripts', shape: 'text', schema: 1, isSecret: false },
  { key: 'preferences', label: 'Preferences', shape: 'fields', schema: 1, isSecret: false },
  { key: 'journalingLink', label: 'Journaling connection', shape: 'fields', schema: 1, isSecret: false },
  { key: 'copierConfig', label: 'Copier settings', shape: 'fields', schema: 1, isSecret: false },
  { key: 'automationRule', label: 'Automation rules', shape: 'fields', schema: 1, isSecret: false },
] as const satisfies readonly { key: string; label: string; shape: SyncShape; schema: number; isSecret: boolean }[];

export type SyncKind = (typeof syncKinds)[number]['key'];

export const isSyncKind = (value: string): value is SyncKind => syncKinds.some((kind) => kind.key === value);

export const syncKindInfo = (kind: SyncKind) => syncKinds.find((item) => item.key === kind)!;

export const recordKey = (kind: SyncKind, id: string) => `${kind}:${id}`;

// Unknown kinds (from a newer build) still split, so their records can be carried along untouched.
export function splitRecordKey(key: string): { kind: string; id: string } {
  const index = key.indexOf(':');
  if (index <= 0) throw new Error(`Invalid sync record key: ${key}`);
  return { kind: key.slice(0, index), id: key.slice(index + 1) };
}

// Object keys sorted at every level, so equal values always serialise, hash and compare the same.
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as { readonly [key: string]: Json };
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Sync values must be finite numbers.');
  return JSON.stringify(value);
}

export const isSameJson = (left: Json | undefined, right: Json | undefined) =>
  left === undefined || right === undefined ? left === right : canonicalJson(left) === canonicalJson(right);
