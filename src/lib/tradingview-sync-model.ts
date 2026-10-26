import type { SerializedDrawing } from '@meridian/charts';
import { fromTradingViewLineTool, patchTradingViewLineTool, tradingViewDrawingId } from '@meridian/charts/interop/tradingview';
import { displaySymbol, tradingViewScopes, type TradingViewChange, type TradingViewLineToolData, type TradingViewSource, type TradingViewSymbol } from '../../shared/tradingview';
import { migrateDrawing } from './chart-model';

// A TradingView symbol whose drawings are kept in step with an account symbol's.
export interface SyncLink {
  readonly symbol: string;
  readonly tradingView: TradingViewSymbol;
}

// A synced drawing as last agreed with TradingView, keyed by its Meridian id in the ledger.
export interface SyncedDrawing {
  readonly tvId: string;
  readonly symbol: string;
  readonly drawing: SerializedDrawing;
  // TradingView's record of the tool, which edits are written onto.
  readonly record: Readonly<Record<string, unknown>>;
  readonly source: TradingViewSource;
  readonly serverUpdateTime: number;
  // When an edit or deletion not yet saved to TradingView was first seen.
  readonly editedAt?: number;
  // Deleted in TradingView at this app's request. Kept for the session so that undoing the
  // deletion re-creates the drawing there; never stored.
  readonly isDeleted?: boolean;
}

export type Ledger = ReadonlyMap<string, SyncedDrawing>;

export interface SyncOptions {
  now: number;
  tickSize?: number;
  serverOffsetAt: (utcMs: number) => number;
}

export type RemoteEvent =
  | { kind: 'saved'; tool: TradingViewLineToolData }
  | { kind: 'removed'; drawingId: string };

export interface RemoteResult {
  // The symbol's drawings after the events, in their order.
  drawings: SerializedDrawing[];
  upserts: SyncedDrawing[];
  removals: string[];
  // What a conflict cost, for the Journal.
  notes: string[];
}

export interface PushPlan {
  source: TradingViewSource;
  records: Record<string, Readonly<Record<string, unknown>> | null>;
  // The ledger once TradingView accepts the push.
  entries: { drawingId: string; entry: SyncedDrawing }[];
}

export interface Outgoing {
  pushes: PushPlan[];
  // Entries that just got an unsaved edit, to remember when it was first seen.
  edited: SyncedDrawing[];
  unwritable: { drawing: SerializedDrawing; reason: string }[];
  unwritten: { drawing: SerializedDrawing; keys: string[] }[];
  // Deletions past the limit, waiting for the user to confirm them or restore the drawings.
  heldDeletions: SyncedDrawing[];
}

// More deletions than this in one go (Delete All Objects, say) wait for the user.
export const MASS_DELETE_LIMIT = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (isRecord(inner) ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => left.localeCompare(right))) : inner));

const same = (left: unknown, right: unknown) => stableJson(left) === stableJson(right);

// The same drawing, whenever it was made.
export const sameDrawing = (left: SerializedDrawing, right: SerializedDrawing) => same({ ...left, createdAt: 0 }, { ...right, createdAt: 0 });

function sourceOf(value: unknown): TradingViewSource | null {
  if (!isRecord(value) || !tradingViewScopes.some((scope) => scope.key === value.scope)) return null;
  const { layoutId, layoutUrl, layoutName, chartId, storageSymbol, seriesId } = value;
  if (typeof layoutId !== 'string' || typeof layoutUrl !== 'string' || typeof layoutName !== 'string' || typeof storageSymbol !== 'string') return null;
  return { scope: value.scope as TradingViewSource['scope'], layoutId, layoutUrl, layoutName, storageSymbol, ...(typeof chartId === 'string' ? { chartId } : {}), ...(typeof seriesId === 'string' ? { seriesId } : {}) };
}

// Saved links; one that no longer reads is dropped.
export function restoreLinks(value: unknown): SyncLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SyncLink[] => {
    if (!isRecord(item) || typeof item.symbol !== 'string' || !item.symbol || !isRecord(item.tradingView)) return [];
    const { symbol, count, ids, sources } = item.tradingView;
    const read = Array.isArray(sources) ? sources.map(sourceOf) : [];
    if (typeof symbol !== 'string' || !read.length || read.some((source) => source === null)) return [];
    return [{ symbol: item.symbol, tradingView: { symbol, count: typeof count === 'number' ? count : 0, ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [], sources: read as TradingViewSource[] } }];
  });
}

// A ledger entry from storage, or null when it no longer reads.
export function restoreSyncedDrawing(value: unknown): SyncedDrawing | null {
  if (!isRecord(value) || typeof value.tvId !== 'string' || typeof value.symbol !== 'string' || !isRecord(value.record) || typeof value.serverUpdateTime !== 'number') return null;
  const drawing = migrateDrawing(value.drawing);
  const source = sourceOf(value.source);
  if (!drawing || !source) return null;
  return { tvId: value.tvId, symbol: value.symbol, drawing, record: value.record, source, serverUpdateTime: value.serverUpdateTime, ...(typeof value.editedAt === 'number' ? { editedAt: value.editedAt } : {}) };
}

export const sourceKey = (source: TradingViewSource) => `${source.layoutId}|${source.scope}|${source.chartId ?? ''}`;

export function linkFor(links: readonly SyncLink[], storageSymbol: string): SyncLink | undefined {
  const symbol = displaySymbol(storageSymbol);
  return links.find((link) => link.tradingView.symbol === symbol);
}

// The ledger entry and drawing for a TradingView tool, or why it does not sync. A tool already
// shown keeps its creation time, so converting it again is not an edit.
export function syncedFrom(tool: TradingViewLineToolData, symbol: string, existing: SerializedDrawing | undefined, options: SyncOptions): SyncedDrawing | string {
  if (!tool.origin) return 'it is saved inside an older TradingView layout';
  if (!tool.isOnPrice) return 'it is drawn on an indicator, and Meridian draws only on the price chart';
  const conversion = fromTradingViewLineTool(tool, { serverOffsetAt: options.serverOffsetAt, tickSize: options.tickSize, now: existing?.createdAt ?? options.now });
  if (conversion.kind === 'skipped') return conversion.reason;
  return { tvId: tool.id, symbol, drawing: conversion.drawing, record: tool.origin.record, source: tool.origin.source, serverUpdateTime: tool.origin.serverUpdateTime ?? 0 };
}

// A drawing's settings one by one, so two edits to different settings both survive.
function fieldsOf(drawing: SerializedDrawing): Map<string, unknown> {
  const fields = new Map<string, unknown>([['anchors', drawing.anchors], ['text', drawing.text], ['locked', drawing.locked], ['visible', drawing.visible], ['zIndex', drawing.zIndex]]);
  for (const [key, value] of Object.entries(drawing.style)) fields.set(`style.${key}`, value);
  for (const [key, value] of Object.entries(drawing.props ?? {})) fields.set(`props.${key}`, value);
  return fields;
}

// Edits made here and in TradingView since `base`, merged setting by setting. A setting both
// changed takes the newer edit. Returns the merged drawing and the settings that conflicted.
export function mergeDrawings(base: SerializedDrawing, local: SerializedDrawing, remote: SerializedDrawing, isLocalNewer: boolean): { drawing: SerializedDrawing; conflicts: string[] } {
  const [before, mine, theirs] = [fieldsOf(base), fieldsOf(local), fieldsOf(remote)];
  const style: Record<string, unknown> = {};
  const props: Record<string, unknown> = {};
  const top: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of new Set([...before.keys(), ...mine.keys(), ...theirs.keys()])) {
    const isMine = !same(before.get(key), mine.get(key));
    const isTheirs = !same(before.get(key), theirs.get(key));
    if (isMine && isTheirs && !same(mine.get(key), theirs.get(key))) conflicts.push(key);
    const value = isMine && (!isTheirs || isLocalNewer) ? mine.get(key) : theirs.get(key);
    if (value === undefined) continue;
    if (key.startsWith('style.')) style[key.slice(6)] = value;
    else if (key.startsWith('props.')) props[key.slice(6)] = value;
    else top[key] = value;
  }
  const { text: _text, props: _props, ...rest } = remote;
  const drawing = { ...rest, ...top, style: style as unknown as SerializedDrawing['style'], ...(Object.keys(props).length ? { props } : {}) } as SerializedDrawing;
  return { drawing, conflicts };
}

const nameOf = (drawing: SerializedDrawing) => drawing.text ? `"${drawing.text}"` : drawing.type;

// Applies what TradingView changed to a linked symbol's drawings. Newer TradingView saves replace
// a drawing; an edit here not yet saved there is merged in, the newer edit winning a setting both
// changed; a deletion in TradingView removes the drawing.
export function applyRemote(ledger: Ledger, link: SyncLink, local: readonly SerializedDrawing[], events: readonly RemoteEvent[], options: SyncOptions): RemoteResult {
  const drawings = [...local];
  const upserts = new Map<string, SyncedDrawing>();
  const removals = new Set<string>();
  const notes: string[] = [];
  const entryOf = (id: string) => (removals.has(id) ? undefined : upserts.get(id) ?? ledger.get(id));
  // A drawing TradingView saves again after this app deleted it there is simply new.
  const liveEntryOf = (id: string) => {
    const entry = entryOf(id);
    return entry?.isDeleted ? undefined : entry;
  };
  const indexOf = (id: string) => drawings.findIndex((drawing) => drawing.id === id);
  const put = (drawing: SerializedDrawing) => {
    const index = indexOf(drawing.id);
    if (index < 0) drawings.push(drawing);
    else drawings[index] = drawing;
  };
  for (const event of events) {
    if (event.kind === 'removed') {
      const entry = entryOf(event.drawingId);
      if (!entry) continue;
      const index = indexOf(event.drawingId);
      if (index >= 0 && !sameDrawing(drawings[index], entry.drawing)) notes.push(`${link.symbol}: ${nameOf(drawings[index])} was deleted in TradingView, so the edit made here is lost.`);
      if (index >= 0) drawings.splice(index, 1);
      upserts.delete(event.drawingId);
      removals.add(event.drawingId);
      continue;
    }
    const { tool } = event;
    const id = tradingViewDrawingId(tool.id);
    const entry = liveEntryOf(id);
    const current = drawings[indexOf(id)];
    const time = tool.origin?.serverUpdateTime ?? 0;
    if (entry && tool.origin && (time <= entry.serverUpdateTime || same(tool.origin.record.state, entry.record.state))) {
      if (time > entry.serverUpdateTime || sourceKey(tool.origin.source) !== sourceKey(entry.source)) upserts.set(id, { ...entry, record: tool.origin.record, source: tool.origin.source, serverUpdateTime: Math.max(time, entry.serverUpdateTime) });
      continue;
    }
    const synced = syncedFrom(tool, link.symbol, current ?? entry?.drawing, options);
    if (typeof synced === 'string') continue;
    removals.delete(id);
    const isPending = !!entry && (!current || !sameDrawing(current, entry.drawing));
    if (!entry || !isPending) {
      upserts.set(id, synced);
      put(synced.drawing);
      continue;
    }
    const editedAt = entry.editedAt ?? options.now;
    const isLocalNewer = editedAt > time;
    if (!current) {
      if (isLocalNewer) {
        upserts.set(id, { ...synced, editedAt });
        notes.push(`${link.symbol}: ${nameOf(synced.drawing)} changed in TradingView before it was deleted here; it stays deleted.`);
      } else {
        upserts.set(id, synced);
        put(synced.drawing);
        notes.push(`${link.symbol}: ${nameOf(synced.drawing)} changed in TradingView after it was deleted here, so it is back.`);
      }
      continue;
    }
    const { drawing, conflicts } = mergeDrawings(entry.drawing, current, synced.drawing, isLocalNewer);
    upserts.set(id, sameDrawing(drawing, synced.drawing) ? synced : { ...synced, editedAt });
    put(drawing);
    if (conflicts.length) notes.push(`${link.symbol}: ${nameOf(drawing)} was edited here and in TradingView; the ${isLocalNewer ? 'edit made here' : 'TradingView edit'} was newer and kept for ${conflicts.join(', ')}.`);
  }
  return { drawings, upserts: [...upserts.values()], removals: [...removals], notes };
}

// The events a change-stream message holds for one link: saves of its symbol's tools, deletions of
// tools it holds at that target.
export function eventsOf(change: TradingViewChange, link: SyncLink, ledger: Ledger): RemoteEvent[] {
  const target = sourceKey(change.source);
  const atTarget = [...ledger.values()].filter((entry) => entry.symbol === link.symbol && sourceKey(entry.source) === target);
  const saved = change.tools.filter((tool) => tool.origin && linkFor([link], tool.origin.source.storageSymbol)).map((tool): RemoteEvent => ({ kind: 'saved', tool }));
  const removedIds = new Set(change.removedIds.map(tradingViewDrawingId));
  const cleared = change.isSymbolCleared && linkFor([link], change.source.storageSymbol) ? atTarget.filter((entry) => linkFor([link], entry.source.storageSymbol)) : [];
  const removed = [...atTarget.filter((entry) => removedIds.has(tradingViewDrawingId(entry.tvId))), ...cleared].map((entry): RemoteEvent => ({ kind: 'removed', drawingId: tradingViewDrawingId(entry.tvId) }));
  return [...saved, ...removed];
}

// The events of a fresh read of a link's drawings: every tool read, and a deletion for each held
// tool that is gone from a target read in full.
export function eventsOfReload(tools: readonly TradingViewLineToolData[], link: SyncLink, ledger: Ledger, isTargetRead: (source: TradingViewSource) => boolean): RemoteEvent[] {
  const seen = new Set(tools.map((tool) => tradingViewDrawingId(tool.id)));
  const gone = [...ledger.entries()].filter(([id, entry]) => entry.symbol === link.symbol && !entry.isDeleted && !seen.has(id) && isTargetRead(entry.source));
  return [...tools.map((tool): RemoteEvent => ({ kind: 'saved', tool })), ...gone.map(([drawingId]): RemoteEvent => ({ kind: 'removed', drawingId }))];
}

// What this app changed in a linked symbol's synced drawings since TradingView last agreed, as
// one push per TradingView target.
export function outgoing(ledger: Ledger, link: SyncLink, local: readonly SerializedDrawing[], options: SyncOptions & { isMassDeleteAllowed: boolean }): Outgoing {
  const byId = new Map(local.map((drawing) => [drawing.id, drawing]));
  const pushes = new Map<string, PushPlan>();
  const result: Outgoing = { pushes: [], edited: [], unwritable: [], unwritten: [], heldDeletions: [] };
  const planFor = (source: TradingViewSource) => {
    const key = sourceKey(source);
    const plan = pushes.get(key) ?? { source, records: {}, entries: [] };
    pushes.set(key, plan);
    return plan;
  };
  const deletions: [string, SyncedDrawing][] = [];
  for (const [id, entry] of ledger) {
    if (entry.symbol !== link.symbol || entry.source.scope === 'layout') continue;
    const current = byId.get(id);
    if (entry.isDeleted ? !current : current && sameDrawing(current, entry.drawing)) continue;
    if (entry.editedAt === undefined && !entry.isDeleted) result.edited.push({ ...entry, editedAt: options.now });
    if (!current) {
      deletions.push([id, entry]);
      continue;
    }
    const tool = isRecord(entry.record.state) ? entry.record.state : {};
    const patch = patchTradingViewLineTool(tool, entry.drawing, current, options);
    if (patch.kind === 'unwritable') {
      result.unwritable.push({ drawing: current, reason: patch.reason });
      continue;
    }
    if (patch.unwritten.length) result.unwritten.push({ drawing: current, keys: patch.unwritten });
    const record = { ...entry.record, state: patch.tool };
    const plan = planFor(entry.source);
    plan.records[entry.tvId] = record;
    plan.entries.push({ drawingId: id, entry: { ...entry, drawing: current, record, editedAt: undefined, isDeleted: undefined } });
  }
  if (deletions.length > MASS_DELETE_LIMIT && !options.isMassDeleteAllowed) result.heldDeletions = deletions.map(([, entry]) => entry);
  else {
    for (const [id, entry] of deletions) {
      const plan = planFor(entry.source);
      plan.records[entry.tvId] = null;
      plan.entries.push({ drawingId: id, entry: { ...entry, editedAt: undefined, isDeleted: true } });
    }
  }
  result.pushes = [...pushes.values()];
  return result;
}
