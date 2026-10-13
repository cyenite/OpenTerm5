import type { Bar } from '../../shared/protocol';
import { Store } from './store';

export interface CursorValue {
  label: string;
  value: number;
}

export interface CursorState {
  bar: Bar | null;
  symbol: string;
  digits: number;
  values: CursorValue[];
}

export const cursor = new Store<CursorState>({ bar: null, symbol: '', digits: 5, values: [] });
