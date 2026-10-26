import { Store } from './store';

// TradingView's interval box: typing a number on a chart opens it with that number, and Enter
// switches the chart to the timeframe typed.
export interface TimeframePromptState {
  readonly text: string;
  readonly chartId: string;
  // The window the key was pressed in: a chart's pop-out window or the main one.
  readonly view: Window;
}

export const timeframePrompt = new Store<{ prompt: TimeframePromptState | null }>({ prompt: null });

export function openTimeframePrompt(chartId: string, text: string, view: Window): void {
  timeframePrompt.set({ prompt: { text, chartId, view } });
}

export function closeTimeframePrompt(): void {
  timeframePrompt.set({ prompt: null });
}
