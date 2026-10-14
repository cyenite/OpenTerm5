import type { Bar } from '../../shared/protocol';
import { Store } from './store';

// A study's value under the pointer, already formatted by the chart.
export interface CursorValue {
  label: string;
  text: string;
}

export interface CursorState {
  bar: Bar | null;
  symbol: string;
  digits: number;
  // Seconds charts show bar times to the second.
  hasSeconds: boolean;
  values: CursorValue[];
}

export const cursor = new Store<CursorState>({ bar: null, symbol: '', digits: 5, hasSeconds: false, values: [] });
