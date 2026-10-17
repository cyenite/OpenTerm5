import type { Bar, InputValue } from '@meridian/charts';
import type { PineInput } from './pine-inputs';
import type { PineConversion } from './pine-output';

// Messages between the Pine runtime worker and the page.

export interface PineSymbolInfo {
  tickSize: number;
  description: string;
}

export interface PineDeclaration {
  title: string;
  shortTitle: string;
  overlay: boolean;
  inputs: PineInput[];
}

export interface PineRun {
  bars: Bar[];
  source: string;
  symbol: string;
  timeframe: string;
  intervalMs: number;
  info: PineSymbolInfo;
  inputs: Record<string, InputValue>;
}

export type PineRequest =
  | { kind: 'inspect'; id: number; source: string }
  | { kind: 'run'; id: number; run: PineRun }
  // The page's answer to a worker's `bars` request.
  | { kind: 'bars'; id: number; bars?: Bar[]; error?: string };

export type PineReply =
  | { kind: 'inspect'; id: number; declaration?: PineDeclaration; error?: string }
  | { kind: 'run'; id: number; conversion?: PineConversion; error?: string }
  // Bars of another symbol or timeframe, for request.security(). `from` and `to` bound bar times.
  | { kind: 'bars'; id: number; symbol: string; timeframe: string; limit?: number; from?: number; to?: number };
