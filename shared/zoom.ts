// Interface zoom levels, smallest first; Chromium's own steps between 50% and 200%.
export const zoomFactors = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const zoomSteps = [
  { key: 'in', label: 'Zoom In', shortcut: 'Ctrl+=' },
  { key: 'out', label: 'Zoom Out', shortcut: 'Ctrl+-' },
  { key: 'reset', label: 'Actual Size', shortcut: 'Ctrl+0' },
] as const;

export type ZoomStep = (typeof zoomSteps)[number]['key'];

export function isZoomStep(value: unknown): value is ZoomStep {
  return zoomSteps.some((step) => step.key === value);
}

// A saved or stray factor snaps to the nearest level, so stepping always lands on the list.
export function restoreZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return zoomFactors.reduce((best, factor) => Math.abs(factor - value) < Math.abs(best - value) ? factor : best, 1);
}

export function steppedZoom(current: number, step: ZoomStep): number {
  if (step === 'reset') return 1;
  const index = zoomFactors.indexOf(restoreZoom(current) as (typeof zoomFactors)[number]);
  return zoomFactors[Math.min(zoomFactors.length - 1, Math.max(0, index + (step === 'in' ? 1 : -1)))];
}

export interface ZoomKey {
  key: string;
  code: string;
  type: string;
  alt: boolean;
  meta: boolean;
  control: boolean;
}

// Ctrl (Cmd on macOS) with plus, minus or zero, on the main keys or the keypad. Shift is allowed
// because plus is Shift+= on most layouts.
export function zoomStepForKey(input: ZoomKey, isMac: boolean): ZoomStep | null {
  if (input.type !== 'keyDown' || input.alt || !(isMac ? input.meta : input.control)) return null;
  if (input.key === '=' || input.key === '+' || input.code === 'NumpadAdd') return 'in';
  if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract') return 'out';
  if (input.key === '0' || input.code === 'Numpad0') return 'reset';
  return null;
}
