import { drawingToolInfo, type ChartSettings } from '@meridian/charts';
import { fromTradingViewChartSettings, fromTradingViewTemplate, fromTradingViewTheme, tradingViewDrawingId, tradingViewToolTypes } from '@meridian/charts/interop/tradingview';
import type { TradingViewAccount, TradingViewScan, TradingViewScript, TradingViewScriptPage, TradingViewSkippedLayout, TradingViewSymbol } from '../../shared/tradingview';
import { saveImportedTheme } from './custom-themes';
import { addDrawingTemplates } from './drawing-templates';
import { log, session, terminal } from './session';
import { brokerClock, type ClockSource } from './broker-clock';
import { serverOffsetAt } from './server-clock';
import { addSymbolDrawings, symbolDrawingIds, symbolDrawings } from './symbol-drawings';
import { convertDrawingSets, themeIdentity, type SkippedDrawings } from './tradingview-model';
import { applyChartSettingsToAll, chartTypes, workspace, type ChartType } from './workspace';

export type { ClockSource };

export interface DrawingImportChoice {
  symbol: TradingViewSymbol;
  // The account symbol whose charts receive the drawings.
  target: string;
}

export interface DrawingImportSummary {
  count: number;
  // Drawings copied by an earlier import and left as they are.
  keptCount: number;
  targets: string[];
  skipped: SkippedDrawings[];
  skippedLayouts: readonly TradingViewSkippedLayout[];
  clock: ClockSource;
}

export const tradingViewAccount = (): Promise<TradingViewAccount | null> => terminal.request('tradingview.account', {});

export const signInToTradingView = (): Promise<TradingViewAccount | null> => terminal.request('tradingview.signIn', {});

export const signOutOfTradingView = (): Promise<boolean> => terminal.request('tradingview.signOut', {});

export const tradingViewSymbols = (): Promise<TradingViewScan> => terminal.request('tradingview.symbols', {});

export const tradingViewThemes = (): Promise<string[]> => terminal.request('tradingview.themes', {});

export const tradingViewScript = (url: string): Promise<TradingViewScript> => terminal.request('tradingview.script', { url });

export const tradingViewScriptList = (page: number): Promise<TradingViewScriptPage> => terminal.request('tradingview.scriptList', { page });

export const tradingViewScriptSource = (scriptId: string, version: number): Promise<string> => terminal.request('tradingview.scriptSource', { scriptId, version });

export function tickSize(target: string): number | undefined {
  const spec = session.get().symbols[target];
  if (!spec) return undefined;
  return spec.tickSize || spec.point || 10 ** -spec.digits;
}

// Copies the chosen symbols' drawings. Drawings an earlier import copied stay as they are, with
// any changes made to them, unless `isReplacing` asks for fresh copies.
export async function importTradingViewDrawings(choices: readonly DrawingImportChoice[], isReplacing: boolean): Promise<DrawingImportSummary> {
  if (!session.get().account) throw new Error('Log in to a trading account first: drawings are placed on its bars using the broker\'s server clock.');
  const { sets, skippedLayouts } = await terminal.request('tradingview.drawings', { symbols: choices.map((choice) => choice.symbol) });
  const existing = symbolDrawingIds(symbolDrawings.get());
  const isKept = (id: string) => !isReplacing && existing.has(tradingViewDrawingId(id));
  const keptCount = sets.reduce((total, set) => total + set.tools.filter((tool) => isKept(tool.id)).length, 0);
  const fresh = sets.map((set) => ({ ...set, tools: set.tools.filter((tool) => !isKept(tool.id)) }));
  const { clock, source } = await brokerClock();
  const targets = new Map(choices.map((choice) => [choice.symbol.symbol, choice.target]));
  const { converted, skipped } = convertDrawingSets(fresh, targets, { now: Date.now(), tickSize, serverOffsetAt: (utcMs) => serverOffsetAt(clock, utcMs) });
  for (const { target, drawings } of converted) if (drawings.length) addSymbolDrawings(target, drawings);
  const filled = converted.filter((entry) => entry.drawings.length);
  const count = filled.reduce((total, entry) => total + entry.drawings.length, 0);
  log(`Imported ${count} TradingView drawing${count === 1 ? '' : 's'} into ${filled.map((entry) => entry.target).join(', ') || 'no symbols'}${keptCount ? `; ${keptCount} copied before were kept` : ''}.`, 'Charts');
  return { count, keptCount, targets: filled.map((entry) => entry.target), skipped, skippedLayouts, clock: source };
}

export interface TemplateImportSummary {
  added: number;
  // Templates with a name already used for the tool here, left as they are.
  kept: number;
  // Tool label and template names, for the summary.
  tools: { label: string; names: string[] }[];
}

// Copies every drawing template saved in TradingView for a tool Meridian has.
export async function importTradingViewTemplates(isReplacing: boolean): Promise<TemplateImportSummary> {
  const templates = await terminal.request('tradingview.drawingTemplates', { types: tradingViewToolTypes() });
  const entries = templates.flatMap(({ type, name, content }) => {
    const converted = fromTradingViewTemplate(type, content);
    return converted ? [{ type: converted.type, template: { name, style: converted.style, ...(Object.keys(converted.props).length ? { props: converted.props } : {}), ...(converted.text !== undefined ? { text: converted.text } : {}) } }] : [];
  });
  const { added, kept } = addDrawingTemplates(entries, isReplacing);
  const byTool = new Map<string, string[]>();
  for (const { type, template } of entries) {
    const label = drawingToolInfo.get(type)?.label ?? type;
    byTool.set(label, [...(byTool.get(label) ?? []), template.name]);
  }
  log(`Imported ${added} TradingView drawing template${added === 1 ? '' : 's'}${kept ? `; ${kept} with names already here were kept` : ''}.`, 'Charts');
  return { added, kept, tools: [...byTool].map(([label, names]) => ({ label, names })) };
}

// Imports a theme saved in TradingView and returns its id among the chart themes.
export async function importTradingViewTheme(name: string): Promise<string> {
  const content = await terminal.request('tradingview.theme', { name });
  const patch = fromTradingViewTheme(content, themeIdentity(name));
  if (!patch) throw new Error(`The TradingView theme "${name}" has no chart background, so it cannot be imported.`);
  saveImportedTheme(patch);
  log(`Imported the TradingView theme "${name}".`, 'Charts');
  return patch.id;
}

export interface ChartSettingsChoice {
  key: string;
  layoutName: string;
  symbol: string;
  interval?: string;
  settings: ChartSettings;
  // The layout's chart type, when OpenTerm5 draws it.
  chartType?: ChartType;
}

export interface ChartSettingsScan {
  choices: ChartSettingsChoice[];
  skippedLayouts: readonly TradingViewSkippedLayout[];
}

// The chart settings of every chart in the user's layouts, converted for Meridian.
export async function tradingViewChartSettings(): Promise<ChartSettingsScan> {
  const { charts, skippedLayouts } = await terminal.request('tradingview.chartSettings', {});
  const choices = charts.flatMap((chart): ChartSettingsChoice[] => {
    const converted = fromTradingViewChartSettings(chart.content);
    if (!converted) return [];
    const { layoutName, symbol, interval } = chart;
    return [{ key: `${chart.layoutUrl}/${chart.chartId}`, layoutName, symbol, ...(interval ? { interval } : {}), settings: converted.settings, ...(converted.priceStyle ? { chartType: converted.priceStyle } : {}) }];
  });
  return { choices, skippedLayouts };
}

export interface ChartSettingsSummary {
  count: number;
  isDefault: boolean;
  chartType?: ChartType;
}

export function applyTradingViewChartSettings(choice: ChartSettingsChoice, isDefault: boolean, isSwitchingType: boolean): ChartSettingsSummary {
  const chartType = isSwitchingType ? choice.chartType : undefined;
  applyChartSettingsToAll(choice.settings, chartType, isDefault);
  const count = workspace.get().charts.length;
  const typeLabel = chartType ? chartTypes.find((type) => type.key === chartType)?.label : undefined;
  log(`Applied the chart settings of ${choice.symbol} in the TradingView layout "${choice.layoutName}" to ${count} chart${count === 1 ? '' : 's'}${typeLabel ? ` as ${typeLabel}` : ''}${isDefault ? ', and to new charts' : ''}.`, 'Charts');
  return { count, isDefault, ...(chartType ? { chartType } : {}) };
}
