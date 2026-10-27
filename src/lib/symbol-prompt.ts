import { Store } from './store';

// TradingView's symbol search on a chart: typing a letter there opens it with that letter, and
// Enter (or a click) switches the chart to the symbol picked.
export interface SymbolPromptState {
  readonly text: string;
  readonly chartId: string;
  // The window the key was pressed in: a chart's pop-out window or the main one.
  readonly view: Window;
}

export const symbolPrompt = new Store<{ prompt: SymbolPromptState | null }>({ prompt: null });

export function openSymbolPrompt(chartId: string, text: string, view: Window): void {
  symbolPrompt.set({ prompt: { text, chartId, view } });
}

export function closeSymbolPrompt(): void {
  symbolPrompt.set({ prompt: null });
}
