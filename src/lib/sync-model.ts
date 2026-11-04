import { restoreSettings } from '@meridian/charts/settings';
import { markets, type Market } from '../../shared/protocol';
import type { Json, SyncSourceChange } from '../../shared/sync';
import { drawingSyncs, isLayoutKey, layoutOf, layoutSyncs, restoreSizes, type LayoutKey, type SplitSizes } from './chart-layouts';
import { migrateDrawing, type Drawing } from './chart-model';
import { makeTab, type ChartTab } from './chart-tabs';
import { presetName, restoreChart, restoreProfiles, restoreTemplates, type ChartProfile, type ChartTemplate } from './presets';
import { replayModes, replaySpeeds } from './replay-model';
import type { ChartConfig, WorkspaceState } from './workspace';

// How the workspace and the other renderer stores turn into sync records and back. A record
// applied and read again must come out the same, or every computer would keep re-sending it.

export type Records = Readonly<Record<string, Json>>;

// Singleton kinds (favourites, templates, looks, colours) hold one record under this id.
export const SINGLETON = 'all';

// Maps whose items have an order carry it as one more item: the ids in order. Items it does not
// list (added on another computer at the same time) follow in id order, so nothing is lost when
// two orders race and the newer one wins.
export const ORDER = '#order';

type JsonObject = { readonly [key: string]: Json };

export const isObject = (value: Json | undefined): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

// What a store holds, as plain JSON: undefined fields go, as they would through storage.
export const toJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

function fail(message: string): never {
  throw new Error(message);
}

export function orderedMap<T extends { readonly id: string }>(items: readonly T[], value: (item: T) => unknown = (item) => item): JsonObject {
  return toJson({ ...Object.fromEntries(items.map((item) => [item.id, value(item)])), [ORDER]: items.map((item) => item.id) }) as JsonObject;
}

export function orderedItems(map: JsonObject): [string, Json][] {
  const order = Array.isArray(map[ORDER]) ? (map[ORDER] as readonly Json[]).filter((id): id is string => typeof id === 'string' && id !== ORDER && id in map) : [];
  const listed = [...new Set(order)];
  const rest = Object.keys(map).filter((id) => id !== ORDER && !listed.includes(id)).sort();
  return [...listed, ...rest].map((id) => [id, map[id]]);
}

function checkOrder(map: JsonObject): void {
  const order = map[ORDER];
  if (order !== undefined && (!Array.isArray(order) || order.some((id) => typeof id !== 'string'))) fail('The order is not a list of ids.');
}

// Profile and template names are their record ids, so they must already be valid names.
function presetId(id: string): string {
  const isValid = (() => { try { return presetName(id) === id; } catch { return false; } })();
  return isValid ? id : fail(`"${id}" is not a valid name.`);
}

function restoreDrawingItem(id: string, value: Json): Drawing {
  const drawing = migrateDrawing(value);
  if (!drawing || drawing.id !== id) fail(`Drawing ${id} is not readable.`);
  return drawing;
}

// A drawings map in drawing order; throws when any drawing does not read.
export function restoreDrawingMap(value: Json): Drawing[] {
  if (!isObject(value)) fail('Drawings must be a map.');
  checkOrder(value);
  return orderedItems(value).map(([id, item]) => restoreDrawingItem(id, item));
}

export const drawingMap = (drawings: readonly Drawing[]) => orderedMap(drawings);

// Charts: everything but the id and drawings, which sync apart. Optional fields are written as
// null, because a field missing from a record means "unchanged", not "removed".
export function chartRecord(chart: ChartConfig): Json {
  const { id, drawings, settings, theme, linkGroup, ...fields } = chart;
  return toJson({ ...fields, settings: settings ?? null, theme: theme ?? null, linkGroup: linkGroup ?? null });
}

export function restoreChartRecord(id: string, value: Json, drawings: Drawing[]): ChartConfig {
  if (!isObject(value)) fail('A chart must be an object.');
  const fields = Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
  return restoreChart({ ...fields, id, drawings }) ?? fail(`Chart ${id} is not readable.`);
}

// Layouts: the tab's own fields. Its charts, their order and its shared drawings sync apart, and
// which chart is active stays with each computer.
export function layoutRecord(tab: ChartTab): Json {
  return toJson({ layout: tab.layout, market: tab.market, syncs: tab.syncs, sizes: tab.sizes });
}

export function restoreLayoutRecord(value: Json): Pick<ChartTab, 'layout' | 'market' | 'syncs' | 'sizes'> {
  if (!isObject(value) || !isLayoutKey(value.layout)) fail('A layout needs a known layout.');
  const market = markets.find((candidate) => candidate.key === value.market)?.key ?? fail('A layout needs a known market.');
  const syncs = Array.isArray(value.syncs) ? value.syncs : fail('Layout syncs must be a list.');
  if (syncs.some((sync) => !layoutSyncs.some((candidate) => candidate.key === sync))) fail('A layout sync is unknown.');
  if (!isObject(value.sizes)) fail('Layout sizes must be a map.');
  const sizes = Object.fromEntries(Object.entries(value.sizes).filter(([key]) => isLayoutKey(key)).map(([key, shares]) => [key, restoreSizes(shares, layoutOf(key as LayoutKey).tree)])) as Partial<Record<LayoutKey, SplitSizes>>;
  return { layout: value.layout as LayoutKey, market, syncs: syncs as ChartTab['syncs'], sizes };
}

export function restoreIdList(value: Json): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) fail('Expected a list of ids.');
  return [...value] as string[];
}

// Drawings shared across a layout, by instrument: one map item per drawing, carrying its instrument.
export function layoutDrawingsRecord(tab: ChartTab): Json {
  const items = Object.entries(tab.drawings).flatMap(([symbol, drawings]) => drawings.map((drawing) => ({ id: drawing.id, symbol, drawing })));
  return orderedMap(items, ({ symbol, drawing }) => ({ symbol, drawing }));
}

export function restoreLayoutDrawings(value: Json): Record<string, Drawing[]> {
  if (!isObject(value)) fail('Layout drawings must be a map.');
  checkOrder(value);
  const bySymbol: Record<string, Drawing[]> = {};
  for (const [id, item] of orderedItems(value)) {
    if (!isObject(item) || typeof item.symbol !== 'string' || !item.symbol) fail(`Layout drawing ${id} has no instrument.`);
    (bySymbol[item.symbol] ??= []).push(restoreDrawingItem(id, item.drawing));
  }
  return bySymbol;
}

export function restoreProfile(name: string, value: Json): ChartProfile {
  if (!isObject(value)) fail('A profile must be an object.');
  const [profile] = restoreProfiles([{ ...value, name }]);
  return profile ?? fail(`Profile ${name} is not readable.`);
}

export const profileRecord = ({ name, ...profile }: ChartProfile): Json => toJson(profile);

export function restoreTemplate(name: string, value: Json): ChartTemplate {
  if (!isObject(value)) fail('A template must be an object.');
  const [template] = restoreTemplates([{ name, settings: value.settings }]);
  return template ?? fail(`Template ${name} is not readable.`);
}

export const templateRecord = (template: ChartTemplate): Json => toJson({ settings: template.settings });

const workspacePreferenceChecks: Readonly<Record<string, (value: Json) => boolean>> = {
  theme: (value) => typeof value === 'string' && !!value,
  drawingSync: (value) => drawingSyncs.some((candidate) => candidate.key === value),
  isCrosshairSyncedByDefault: (value) => typeof value === 'boolean',
  replayMode: (value) => replayModes.some((candidate) => candidate.key === value),
  replaySpeed: (value) => replaySpeeds.some((candidate) => candidate.key === value),
  defaultChartSettings: (value) => value === null || isObject(value),
  defaultChartTheme: (value) => value === null || typeof value === 'string',
  activeProfile: (value) => typeof value === 'string' && (() => { try { return presetId(value) === value; } catch { return false; } })(),
};

// The workspace settings that follow the user rather than the screen. Panels, docks, the page and
// the one-click consent stay with each computer.
export function workspacePreferences(state: WorkspaceState): Json {
  return toJson({
    theme: state.theme,
    drawingSync: state.drawingSync,
    isCrosshairSyncedByDefault: state.isCrosshairSyncedByDefault,
    replayMode: state.replayMode,
    replaySpeed: state.replaySpeed,
    defaultChartSettings: state.defaultChartSettings ?? null,
    defaultChartTheme: state.defaultChartTheme ?? null,
    activeProfile: state.activeProfile,
  });
}

// Fields a newer build added are left alone; the known ones must hold valid values.
export function checkWorkspacePreferences(value: Json): void {
  if (!isObject(value)) fail('Preferences must be an object.');
  for (const [key, field] of Object.entries(value)) if (workspacePreferenceChecks[key] && !workspacePreferenceChecks[key](field)) fail(`The ${key} preference is invalid.`);
}

function applyWorkspacePreferences(state: WorkspaceState, value: JsonObject): Partial<WorkspaceState> {
  const patch: Partial<WorkspaceState> = {};
  const known = (key: string) => key in value && !!workspacePreferenceChecks[key];
  if (known('theme')) patch.theme = value.theme as string;
  if (known('drawingSync')) patch.drawingSync = value.drawingSync as WorkspaceState['drawingSync'];
  if (known('isCrosshairSyncedByDefault')) patch.isCrosshairSyncedByDefault = value.isCrosshairSyncedByDefault as boolean;
  if (known('replayMode')) patch.replayMode = value.replayMode as WorkspaceState['replayMode'];
  if (known('replaySpeed')) patch.replaySpeed = value.replaySpeed as WorkspaceState['replaySpeed'];
  if (known('defaultChartSettings')) patch.defaultChartSettings = value.defaultChartSettings === null ? undefined : restoreSettings(value.defaultChartSettings);
  if (known('defaultChartTheme')) patch.defaultChartTheme = value.defaultChartTheme === null ? undefined : value.defaultChartTheme as string;
  // The layouts of the other profile arrive as their own records; a profile this computer does not
  // have yet keeps the current one.
  if (known('activeProfile') && state.profiles.some((profile) => profile.name === value.activeProfile)) patch.activeProfile = value.activeProfile as string;
  return patch;
}

export const workspaceKinds = ['chart', 'chartDrawings', 'layout', 'layoutCharts', 'layoutDrawings', 'layoutOrder', 'chartProfile', 'chartTemplate'] as const;

export type WorkspaceKind = (typeof workspaceKinds)[number];

export function workspaceRecords(state: WorkspaceState, kind: WorkspaceKind): Records {
  const byId = <T extends { readonly id: string }>(items: readonly T[], record: (item: T) => Json) => Object.fromEntries(items.map((item) => [item.id, record(item)]));
  if (kind === 'chart') return byId(state.charts, chartRecord);
  if (kind === 'chartDrawings') return byId(state.charts, (chart) => drawingMap(chart.drawings));
  if (kind === 'layout') return byId(state.tabs, layoutRecord);
  if (kind === 'layoutCharts') return byId(state.tabs, (tab) => toJson(tab.chartIds));
  if (kind === 'layoutDrawings') return byId(state.tabs, layoutDrawingsRecord);
  if (kind === 'layoutOrder') return Object.fromEntries(markets.map(({ key }) => [key, state.tabs.filter((tab) => tab.market === key).map((tab) => tab.id)]));
  if (kind === 'chartProfile') return Object.fromEntries(state.profiles.map((profile) => [profile.name, profileRecord(profile)]));
  return Object.fromEntries(state.templates.map((template) => [template.name, templateRecord(template)]));
}

export function checkWorkspaceRecord(kind: WorkspaceKind, id: string, value: Json): void {
  if (kind === 'chart') restoreChartRecord(id, value, []);
  else if (kind === 'chartDrawings') restoreDrawingMap(value);
  else if (kind === 'layout') restoreLayoutRecord(value);
  else if (kind === 'layoutCharts' || kind === 'layoutOrder') restoreIdList(value);
  else if (kind === 'layoutDrawings') restoreLayoutDrawings(value);
  else if (kind === 'chartProfile') restoreProfile(presetId(id), value);
  else restoreTemplate(presetId(id), value);
  if (kind === 'layoutOrder' && !markets.some((market) => market.key === id)) fail(`Unknown market ${id}.`);
}

// Tabs of `market` in the order given, in the places that market's tabs held; tabs the order does
// not list keep their order after the listed ones.
function reorderTabs(tabs: readonly ChartTab[], market: Market, order: readonly string[]): ChartTab[] {
  const rank = (tab: ChartTab) => { const index = order.indexOf(tab.id); return index < 0 ? Infinity : index; };
  const sorted = tabs.filter((tab) => tab.market === market).sort((left, right) => rank(left) - rank(right));
  return tabs.map((tab) => tab.market === market ? sorted.shift()! : tab);
}

// The state after a change from sync, for one kind. `markSynced` tags drawing lists that came from
// another computer, so the chart does not offer them for undo.
export function applyWorkspaceChange(state: WorkspaceState, kind: WorkspaceKind, change: SyncSourceChange, markSynced: (drawings: Drawing[]) => Drawing[] = (drawings) => drawings): Partial<WorkspaceState> {
  const deleted = new Set(change.deletes);
  const upserts = Object.entries(change.upserts);
  const patchTabs = (patch: (tab: ChartTab) => ChartTab) => state.tabs.map(patch);
  if (kind === 'chart') {
    const charts = state.charts.filter((chart) => !deleted.has(chart.id));
    for (const [id, value] of upserts) {
      const index = charts.findIndex((chart) => chart.id === id);
      const chart = restoreChartRecord(id, value, index < 0 ? [] : charts[index].drawings);
      if (index < 0) charts.push(chart);
      else charts[index] = chart;
    }
    const tabs = deleted.size ? patchTabs((tab) => tab.chartIds.some((id) => deleted.has(id)) ? { ...tab, chartIds: tab.chartIds.filter((id) => !deleted.has(id)) } : tab) : state.tabs;
    return { charts, tabs };
  }
  if (kind === 'chartDrawings') {
    const values = new Map(upserts);
    return {
      charts: state.charts.map((chart) => {
        if (values.has(chart.id)) return { ...chart, drawings: markSynced(restoreDrawingMap(values.get(chart.id)!)) };
        return deleted.has(chart.id) && chart.drawings.length ? { ...chart, drawings: markSynced([]) } : chart;
      }),
    };
  }
  if (kind === 'layout') {
    const tabs = state.tabs.filter((tab) => !deleted.has(tab.id));
    for (const [id, value] of upserts) {
      const fields = restoreLayoutRecord(value);
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) tabs.push({ ...makeTab(id, [], fields.layout, fields.syncs, fields.market), sizes: fields.sizes });
      else tabs[index] = { ...tabs[index], ...fields };
    }
    return { tabs };
  }
  if (kind === 'layoutCharts') {
    const values = new Map(upserts);
    return { tabs: patchTabs((tab) => values.has(tab.id) ? { ...tab, chartIds: restoreIdList(values.get(tab.id)!) } : tab) };
  }
  if (kind === 'layoutDrawings') {
    const values = new Map(upserts);
    return { tabs: patchTabs((tab) => values.has(tab.id) ? { ...tab, drawings: restoreLayoutDrawings(values.get(tab.id)!) } : deleted.has(tab.id) ? { ...tab, drawings: {} } : tab) };
  }
  if (kind === 'layoutOrder') {
    let tabs = [...state.tabs];
    for (const [market, value] of upserts) tabs = reorderTabs(tabs, market as Market, restoreIdList(value));
    return { tabs };
  }
  if (kind === 'chartProfile') {
    // The profile in use is the live workspace, so it is never removed from under it.
    const profiles = state.profiles.filter((profile) => !deleted.has(profile.name) || profile.name === state.activeProfile);
    for (const [name, value] of upserts) {
      const profile = restoreProfile(name, value);
      const index = profiles.findIndex((candidate) => candidate.name === name);
      if (index < 0) profiles.push(profile);
      else profiles[index] = profile;
    }
    return { profiles };
  }
  const templates = state.templates.filter((template) => !deleted.has(template.name));
  for (const [name, value] of upserts) {
    const template = restoreTemplate(name, value);
    const index = templates.findIndex((candidate) => candidate.name === name);
    if (index < 0) templates.push(template);
    else templates[index] = template;
  }
  return { templates };
}

export function applyPreferencesChange(state: WorkspaceState, value: Json): Partial<WorkspaceState> {
  checkWorkspacePreferences(value);
  return applyWorkspacePreferences(state, value as JsonObject);
}
