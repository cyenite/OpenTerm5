import { customColorList, drawingToolInfo, onCustomColorsChange, saveDrawingFavorites, setCustomColors, type DrawingTemplate } from '@meridian/charts';
import { parseRiskPreferences } from '../../shared/automation';
import { markets, type Market } from '../../shared/protocol';
import type { Json, RendererSyncKind, SyncSourceChange } from '../../shared/sync';
import { automation } from './automation';
import { importedThemes, removeImportedTheme, saveImportedTheme } from './custom-themes';
import { drawingTemplates, restoreDrawingLooks, restoreDrawingTemplates } from './drawing-templates';
import { drawingTools } from './drawing-tools';
import { indicatorFavorites } from './indicator-favorites';
import { isChartTimeframe, type ChartTimeframe } from './mt5-timeframes';
import { pineSourceProblem } from './pine/pine-script';
import { pineScripts, pineScriptSource, pineScriptsReady, putSyncedPineScript, removePineScripts, restorePineScript } from './pine/pine-scripts';
import { priceAlerts, updateAlerts } from './price-alerts';
import { restoreAlerts } from './price-alerts-model';
import { riskPreferences, riskTicketStorageKeys } from './risk-preferences';
import type { Store } from './store';
import { symbolDrawings } from './symbol-drawings';
import {
  applyPreferencesChange, applyWorkspaceChange, checkWorkspacePreferences, checkWorkspaceRecord, drawingMap, isObject, orderedItems, orderedMap, ORDER, restoreDrawingMap,
  SINGLETON, toJson, workspacePreferences, workspaceRecords, type Records, type WorkspaceKind,
} from './sync-model';
import { timeframeFavorites } from './timeframe-favorites';
import { assistantPreferences, restoreAssistantPreferences } from './trade-assistant';
import { restoreThemePatches } from './tradingview-model';
import { restoreWatchlists, type WatchlistsState } from './watchlist-model';
import { savedWatchlists, setSavedWatchlists, watchlists } from './watchlists';
import { markSyncedDrawings, workspace } from './workspace';

// The renderer's side of sync: each kind's records read from and written to its store. The main
// process holds the keys and the engine, and asks for these over IPC.

export interface RendererSource {
  readonly snapshot: () => Records | Promise<Records>;
  // Throws when the record must not be applied under that id.
  readonly validate: (value: Json, id: string) => void;
  readonly apply: (change: SyncSourceChange) => void | Promise<void>;
}

function fail(message: string): never {
  throw new Error(message);
}

const workspaceSource = (kind: WorkspaceKind): RendererSource => ({
  snapshot: () => workspaceRecords(workspace.get(), kind),
  validate: (value, id) => checkWorkspaceRecord(kind, id, value),
  apply: (change) => workspace.set((state) => applyWorkspaceChange(state, kind, change, markSyncedDrawings)),
});

// The singleton's new value, [] when it was deleted, or null when the change leaves it alone.
function singletonValue(change: SyncSourceChange): Json | null {
  if (SINGLETON in change.upserts) return change.upserts[SINGLETON];
  return change.deletes.includes(SINGLETON) ? [] : null;
}

function checkSingleton(id: string): void {
  if (id !== SINGLETON) fail(`Unknown record ${id}.`);
}

// Favourites keep the order they were added in here; ones from elsewhere go at the end.
function setSource(read: () => readonly string[], write: (items: string[]) => void, isMember: (item: string) => boolean): RendererSource {
  return {
    snapshot: () => ({ [SINGLETON]: [...read()] }),
    validate: (value, id) => {
      checkSingleton(id);
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !isMember(item))) fail('Favourites must be known names.');
    },
    apply: (change) => {
      const value = singletonValue(change);
      if (value === null) return;
      const next = value as string[];
      const current = read();
      write([...current.filter((item) => next.includes(item)), ...next.filter((item) => !current.includes(item))]);
    },
  };
}

// Drawing templates are one map item per tool and name.
function templatesFromMap(value: Json): Record<string, DrawingTemplate[]> {
  if (!isObject(value)) fail('Drawing templates must be a map.');
  const byType: Record<string, DrawingTemplate[]> = {};
  for (const [key, item] of Object.entries(value)) {
    const split = key.indexOf('/');
    const [type, name] = [key.slice(0, split), key.slice(split + 1)];
    const restored = split > 0 ? restoreDrawingTemplates({ [type]: [item] })[type]?.[0] : undefined;
    if (!restored || restored.name !== name) fail(`Drawing template ${key} is not readable.`);
    (byType[type] ??= []).push(restored);
  }
  for (const list of Object.values(byType)) list.sort((left, right) => left.name.localeCompare(right.name));
  return byType;
}

function looksFromMap(value: Json): Record<string, DrawingTemplate> {
  if (!isObject(value)) fail('Drawing looks must be a map.');
  const looks = restoreDrawingLooks(value);
  if (Object.keys(looks).length !== Object.keys(value).length) fail('A drawing look is not readable.');
  return looks;
}

function watchlistsFromMap(market: string, value: Json, activeId: string): WatchlistsState {
  if (!markets.some((candidate) => candidate.key === market)) fail(`Unknown market ${market}.`);
  if (!isObject(value) || (value[ORDER] !== undefined && !Array.isArray(value[ORDER]))) fail('Watchlists must be a map.');
  const lists = orderedItems(value).map(([id, list]) => ({ ...(isObject(list) ? list : {}), id }));
  const restored = restoreWatchlists({ activeId, lists });
  const isWhole = restored?.lists.length === lists.length && restored.lists.every((list, index) => list.entries.length === (lists[index] as { entries?: unknown[] }).entries?.length);
  return isWhole ? restored! : fail('A watchlist is not readable.');
}

const conflictPattern = /~conflict~[^~]*~(\d+)$/;

function checkPineScript(value: Json, id: string): void {
  if (!isObject(value) || typeof value.source !== 'string' || pineSourceProblem(value.source) || !restorePineScript({ ...value, id })) fail(`Pine script ${id} is not readable.`);
}

const riskTicketIds = markets.map(({ key }) => `riskTicket:${key}`);

function readRiskTicket(market: Market): Json | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(riskTicketStorageKeys[market]) ?? 'null') as Json;
    return isObject(value) ? toJson(value) : undefined;
  } catch {
    return undefined;
  }
}

export const syncSources: Readonly<Record<RendererSyncKind, RendererSource>> = {
  theme: {
    snapshot: () => Object.fromEntries(restoreThemePatches(importedThemes.get().themes).map((theme) => [theme.id, toJson(theme)])),
    validate: (value, id) => {
      if (restoreThemePatches([value])[0]?.id !== id) fail(`Theme ${id} is not readable.`);
    },
    apply: (change) => {
      change.deletes.forEach(removeImportedTheme);
      for (const value of Object.values(change.upserts)) saveImportedTheme(restoreThemePatches([value])[0]);
    },
  },
  pineScript: {
    // A script whose source is missing is still listed, so it reads as invalid rather than deleted.
    snapshot: async () => {
      await pineScriptsReady;
      const entries = await Promise.all(pineScripts.get().scripts.map(async ({ id, ...script }) => {
        const source = await pineScriptSource(id).catch(() => null);
        return [id, toJson(source === null ? script : { ...script, source })] as const;
      }));
      return Object.fromEntries(entries);
    },
    validate: checkPineScript,
    // Both computers edited a script: the copy kept from this one is named so it can be told apart.
    apply: async (change) => {
      if (change.deletes.length) removePineScripts(change.deletes);
      for (const [id, value] of Object.entries(change.upserts)) {
        checkPineScript(value, id);
        const { source, ...fields } = value as { source: string };
        const script = restorePineScript({ ...fields, id })!;
        const conflict = conflictPattern.exec(id);
        const name = conflict && !script.name.includes('(conflict') ? `${script.name} (conflict, ${new Date(Number(conflict[1])).toISOString().slice(0, 10)})` : script.name;
        await putSyncedPineScript({ ...script, name }, source);
      }
    },
  },
  chart: workspaceSource('chart'),
  chartDrawings: workspaceSource('chartDrawings'),
  layout: workspaceSource('layout'),
  layoutCharts: workspaceSource('layoutCharts'),
  layoutDrawings: workspaceSource('layoutDrawings'),
  layoutOrder: workspaceSource('layoutOrder'),
  symbolDrawings: {
    snapshot: () => Object.fromEntries(Object.entries(symbolDrawings.get().bySymbol).map(([key, drawings]) => [key, drawingMap(drawings)])),
    validate: (value, id) => {
      if (!id) fail('Symbol drawings need an instrument.');
      restoreDrawingMap(value);
    },
    apply: (change) => symbolDrawings.set((state) => {
      const bySymbol = Object.fromEntries(Object.entries(state.bySymbol).filter(([key]) => !change.deletes.includes(key)));
      for (const [key, value] of Object.entries(change.upserts)) {
        const drawings = restoreDrawingMap(value);
        if (drawings.length) bySymbol[key] = drawings;
        else delete bySymbol[key];
      }
      return { bySymbol };
    }),
  },
  chartProfile: workspaceSource('chartProfile'),
  chartTemplate: workspaceSource('chartTemplate'),
  drawingTemplates: {
    snapshot: () => ({ [SINGLETON]: toJson(Object.fromEntries(Object.entries(drawingTemplates.get().byType).flatMap(([type, list]) => list.map((template) => [`${type}/${template.name}`, template])))) }),
    validate: (value, id) => {
      checkSingleton(id);
      templatesFromMap(value);
    },
    apply: (change) => {
      const value = singletonValue(change);
      if (value !== null) drawingTemplates.set({ byType: Array.isArray(value) ? {} : templatesFromMap(value) });
    },
  },
  drawingLooks: {
    snapshot: () => ({ [SINGLETON]: toJson(drawingTemplates.get().lastByType) }),
    validate: (value, id) => {
      checkSingleton(id);
      looksFromMap(value);
    },
    apply: (change) => {
      const value = singletonValue(change);
      if (value !== null) drawingTemplates.set({ lastByType: Array.isArray(value) ? {} : looksFromMap(value) });
    },
  },
  watchlists: {
    snapshot: () => Object.fromEntries(markets.flatMap(({ key }) => {
      const state = savedWatchlists(key);
      return state ? [[key, orderedMap(state.lists, ({ name, entries }) => ({ name, entries }))]] : [];
    })),
    validate: (value, id) => void watchlistsFromMap(id, value, ''),
    // Which list is open stays with each computer. A market's lists are never removed as a whole.
    apply: (change) => {
      for (const [market, value] of Object.entries(change.upserts)) {
        setSavedWatchlists(market as Market, watchlistsFromMap(market, value, savedWatchlists(market as Market)?.activeId ?? ''));
      }
    },
  },
  indicatorFavorites: setSource(() => indicatorFavorites.get().types, (types) => indicatorFavorites.set({ types }), (type) => type.length > 0),
  timeframeFavorites: setSource(() => timeframeFavorites.get().labels, (labels) => timeframeFavorites.set({ labels: labels as ChartTimeframe[] }), isChartTimeframe),
  drawingFavorites: setSource(() => drawingTools.get().favorites, (favorites) => {
    saveDrawingFavorites(favorites);
    drawingTools.set({ favorites });
  }, (type) => drawingToolInfo.has(type)),
  customColors: {
    snapshot: () => ({ [SINGLETON]: [...customColorList()] }),
    validate: (value, id) => {
      checkSingleton(id);
      if (!Array.isArray(value) || value.length > 10 || value.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) fail('Custom colours must be up to ten #rrggbb colours.');
    },
    apply: (change) => {
      const value = singletonValue(change);
      if (value !== null) setCustomColors(value as string[]);
    },
  },
  priceAlert: {
    snapshot: () => Object.fromEntries(priceAlerts.get().alerts.map(({ id, ...alert }) => [id, toJson(alert)])),
    validate: (value, id) => {
      if (!isObject(value) || restoreAlerts([{ ...value, id }]).length !== 1) fail(`Alert ${id} is not readable.`);
    },
    apply: (change) => {
      const alerts = priceAlerts.get().alerts.filter((alert) => !change.deletes.includes(alert.id));
      for (const [id, value] of Object.entries(change.upserts)) {
        const [alert] = restoreAlerts([{ ...(value as object), id }]);
        const index = alerts.findIndex((candidate) => candidate.id === id);
        if (index < 0) alerts.push(alert);
        else alerts[index] = alert;
      }
      updateAlerts(alerts);
    },
  },
  // Preferences are never removed as a whole; a deletion leaves this computer's as they are.
  preferences: {
    snapshot: async () => {
      const records: Record<string, Json> = {
        workspace: workspacePreferences(workspace.get()),
        tradeAssistant: toJson(assistantPreferences.get()),
        risk: toJson(await automation.request('preferences.risk', {})),
      };
      for (const { key } of markets) {
        const ticket = readRiskTicket(key);
        if (ticket !== undefined) records[`riskTicket:${key}`] = ticket;
      }
      return records;
    },
    validate: (value, id) => {
      if (!isObject(value)) fail('Preferences must be an object.');
      if (id === 'workspace') checkWorkspacePreferences(value);
      else if (id !== 'tradeAssistant' && id !== 'risk' && !riskTicketIds.includes(id)) fail(`Unknown preferences ${id}.`);
    },
    apply: async (change) => {
      for (const [id, value] of Object.entries(change.upserts)) {
        if (id === 'workspace') workspace.set((state) => applyPreferencesChange(state, value));
        else if (id === 'tradeAssistant') assistantPreferences.set(restoreAssistantPreferences({ ...assistantPreferences.get(), ...(value as object) }));
        else if (id === 'risk') riskPreferences.set(await automation.request('preferences.setRisk', parseRiskPreferences({ ...riskPreferences.get(), ...(value as object) })));
        else {
          const market = markets.find(({ key }) => id === `riskTicket:${key}`)?.key;
          if (market) localStorage.setItem(riskTicketStorageKeys[market], JSON.stringify({ ...(readRiskTicket(market) as object | undefined), ...(value as object) }));
        }
      }
    },
  },
};

// Every store sync reads, for telling the main process an edit happened. The Risk Ticket saves its
// settings itself, so they are found at the next sync instead.
export const syncedStores: readonly Pick<Store<object>, 'subscribe'>[] = [
  workspace, symbolDrawings, drawingTemplates, importedThemes, watchlists, indicatorFavorites, timeframeFavorites, drawingTools, priceAlerts, pineScripts, assistantPreferences, riskPreferences,
  { subscribe: onCustomColorsChange },
];
