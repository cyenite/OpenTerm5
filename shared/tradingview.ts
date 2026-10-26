// What OpenTerm5 reads from a TradingView account: who is signed in, which symbols have drawings,
// the drawings themselves and saved chart themes.

export interface TradingViewAccount {
  readonly id: number;
  readonly username: string;
}

// Where TradingView keeps a set of drawings: one chart of a layout, every layout (drawings synced
// to all layouts), or inside the layout itself (layouts saved before drawings had their own storage).
export const tradingViewScopes = [
  { key: 'chart', label: 'Layout chart' },
  { key: 'synced', label: 'Synced to all layouts' },
  { key: 'layout', label: 'Saved in the layout' },
] as const;

export type TradingViewScope = (typeof tradingViewScopes)[number]['key'];

// Storage can key a symbol with its settings: ={"symbol":"FX:EURUSD","adjustment":"splits"}.
export function displaySymbol(storageSymbol: string): string {
  if (!storageSymbol.startsWith('=')) return storageSymbol;
  try {
    const parsed = JSON.parse(storageSymbol.slice(1)) as Record<string, unknown>;
    return typeof parsed.symbol === 'string' && parsed.symbol ? parsed.symbol : storageSymbol;
  } catch {
    return storageSymbol;
  }
}

export interface TradingViewSource {
  readonly scope: TradingViewScope;
  readonly layoutId: string;
  readonly layoutUrl: string;
  readonly layoutName: string;
  // The chart's id inside the layout; absent for synced drawings.
  readonly chartId?: string;
  // The symbol as TradingView's storage keys it, which can differ from its display name.
  readonly storageSymbol: string;
  // The id of the chart's price series, which TradingView generates per layout.
  readonly seriesId?: string;
}

export interface TradingViewSymbol {
  // Exchange-qualified, as TradingView shows it: OANDA:EURUSD.
  readonly symbol: string;
  readonly count: number;
  // TradingView's ids of the drawings, where its storage lists them.
  readonly ids: readonly string[];
  readonly sources: readonly TradingViewSource[];
}

export interface TradingViewPointData {
  readonly time_t?: number;
  readonly offset?: number;
  readonly price?: number;
  readonly interval?: string;
}

export interface TradingViewLineToolData {
  readonly id: string;
  readonly type: string;
  readonly points: readonly TradingViewPointData[];
  readonly state: Readonly<Record<string, unknown>>;
  readonly zorder?: number;
  // Drawn on the price chart rather than on an indicator.
  readonly isOnPrice: boolean;
  // Where TradingView keeps the tool and the record as it sent it, for writing it back. Absent for
  // tools saved inside an older layout, which only re-saving the whole layout could change.
  readonly origin?: TradingViewOrigin;
}

export interface TradingViewOrigin {
  readonly source: TradingViewSource;
  // When TradingView last saved the tool, in ms; it applies only newer changes.
  readonly serverUpdateTime?: number;
  // `{ id, symbol, ownerSource, serverUpdateTime, state }`, `state` being the whole tool.
  readonly record: Readonly<Record<string, unknown>>;
}

// What TradingView's change stream announced for one target of a layout: tools saved there,
// tools deleted (by id), or every tool of a symbol deleted.
export interface TradingViewChange {
  readonly source: TradingViewSource;
  readonly tools: readonly TradingViewLineToolData[];
  readonly removedIds: readonly string[];
  readonly isSymbolCleared: boolean;
}

export interface TradingViewChanges {
  readonly layoutId: string;
  readonly changes: readonly TradingViewChange[];
}

export type TradingViewStreamState = 'connecting' | 'live' | 'down';

export interface TradingViewStreamStatus {
  readonly layoutId: string;
  readonly state: TradingViewStreamState;
  readonly reason?: string;
}

// A layout whose drawings are followed, as a link's sources name it.
export interface TradingViewWatchedLayout {
  readonly layoutId: string;
  readonly layoutUrl: string;
  readonly layoutName: string;
}

// Tools to save (whole records) or delete (null) at one target, keyed by TradingView id.
export interface TradingViewPush {
  readonly source: TradingViewSource;
  readonly records: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>;
}

export interface TradingViewDrawingSet {
  readonly symbol: string;
  readonly tools: readonly TradingViewLineToolData[];
}

// A tool's saved settings in TradingView, under the name the user gave them.
export interface TradingViewDrawingTemplate {
  // The TradingView tool class, such as LineToolTrendLine.
  readonly type: string;
  readonly name: string;
  readonly content: unknown;
}

// A layout TradingView would not open, such as one above the plan's layout limit.
export interface TradingViewSkippedLayout {
  readonly layoutName: string;
  readonly reason: string;
}

export interface TradingViewScan {
  readonly symbols: readonly TradingViewSymbol[];
  readonly skippedLayouts: readonly TradingViewSkippedLayout[];
}

export interface TradingViewDrawings {
  readonly sets: readonly TradingViewDrawingSet[];
  readonly skippedLayouts: readonly TradingViewSkippedLayout[];
}

// The chart settings one chart of a layout was saved with.
export interface TradingViewChartSettings {
  readonly layoutName: string;
  readonly layoutUrl: string;
  readonly chartId: string;
  readonly symbol: string;
  readonly interval?: string;
  // Shaped like the layout's chart, cut down to `chartProperties`, `timeScale` and the price
  // series as its only source.
  readonly content: unknown;
}

export interface TradingViewChartSettingsScan {
  readonly charts: readonly TradingViewChartSettings[];
  readonly skippedLayouts: readonly TradingViewSkippedLayout[];
}

// An open-source TradingView script, read from its public page and TradingView's Pine service.
export interface TradingViewScript {
  readonly version: number;
  readonly url: string;
  readonly name: string;
  readonly author: string;
  readonly source: string;
  // TradingView's id for the published script, `PUB;` and 32 hex digits.
  readonly scriptId: string;
}

// One script in TradingView's list of popular open-source indicators.
export interface TradingViewScriptListing {
  // Position in the list, from 1.
  readonly rank: number;
  readonly likes: number;
  readonly version: number;
  readonly url: string;
  readonly name: string;
  readonly author: string;
  readonly scriptId: string;
}

export interface TradingViewScriptPage {
  readonly total: number;
  readonly hasMore: boolean;
  readonly scripts: readonly TradingViewScriptListing[];
}
