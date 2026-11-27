import type { Point } from 'electron';

// The macOS window controls sit at the start of the renderer's app bar (`.app-bar` in
// src/styles.css), centred on its height. Interface zoom scales the bar but not the controls,
// so their position follows the zoom level.
const inset = 14;
const barHeight = 36;
const buttonHeight = 14;

export function windowButtonPosition(zoomFactor: number): Point {
  return { x: inset, y: Math.max(0, Math.round((barHeight * zoomFactor - buttonHeight) / 2)) };
}
