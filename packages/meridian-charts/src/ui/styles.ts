// The chart's own interface (drawing toolbar, legend, dialogs) is plain DOM styled here, so the
// package works in any host. Colours come from custom properties the chart sets from its theme.

const css = `
.mc-root { position: absolute; inset: 0; overflow: hidden; font: 13px var(--mc-font); color: var(--mc-text); user-select: none; -webkit-user-select: none; }
.mc-root * { box-sizing: border-box; }
.mc-main { position: absolute; top: 0; right: 0; bottom: 0; outline: none; }
.mc-canvas { position: absolute; inset: 0; display: block; touch-action: none; }

.mc-rail { position: absolute; left: 0; top: 0; bottom: 0; width: 52px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0; background: var(--mc-surface); border-right: 1px solid var(--mc-border); overflow-y: auto; overflow-x: visible; scrollbar-width: none; z-index: 4; }
.mc-rail-sep { width: 32px; height: 1px; margin: 4px 0; background: var(--mc-border); flex: none; }
.mc-rail-spacer { flex: 1; }
.mc-cell { position: relative; flex: none; }
.mc-btn { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 4px; background: transparent; color: var(--mc-icon); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-btn:hover { background: var(--mc-hover); color: var(--mc-text); }
.mc-btn.is-active { color: var(--mc-accent); background: var(--mc-active-bg); }
.mc-btn svg { display: block; }
.mc-arrow { position: absolute; right: -1px; top: 50%; width: 10px; height: 22px; margin-top: -11px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 2px; background: transparent; color: var(--mc-muted); cursor: pointer; opacity: 0; box-shadow: none; min-height: 0; }
.mc-cell:hover .mc-arrow, .mc-arrow.is-open { opacity: 1; }
.mc-arrow:hover, .mc-arrow.is-open { background: var(--mc-hover); color: var(--mc-text); }

.mc-flyout { position: absolute; z-index: 30; min-width: 270px; max-height: calc(100% - 12px); overflow-y: auto; padding: 6px 0; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 4px rgb(0 0 0 / 0.2), 0 8px 24px rgb(0 0 0 / 0.35); }
.mc-flyout-title { padding: 10px 16px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mc-muted); }
.mc-flyout-sep { height: 1px; margin: 6px 0; background: var(--mc-border); }
.mc-item { display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 10px 0 8px; border: 0; border-radius: 0; background: transparent; color: var(--mc-text); font: 14px var(--mc-font); text-align: left; cursor: pointer; box-shadow: none; min-height: 0; }
.mc-item:hover { background: var(--mc-hover); }
.mc-item.is-active { color: var(--mc-accent); }
.mc-item .mc-item-icon { width: 28px; height: 28px; flex: none; color: var(--mc-icon); }
.mc-item.is-active .mc-item-icon { color: var(--mc-accent); }
.mc-item .mc-item-label { flex: 1; white-space: nowrap; }
.mc-item .mc-star { width: 28px; height: 28px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--mc-muted); opacity: 0; }
.mc-item:hover .mc-star, .mc-star.is-on { opacity: 1; }
.mc-star.is-on { color: #f7a600; }
.mc-star:hover { color: #f7a600; }

.mc-favorites { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5; display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 8px rgb(0 0 0 / 0.25); }
.mc-favorites .mc-btn { width: 32px; height: 32px; }

.mc-legend { position: absolute; left: 8px; z-index: 3; display: flex; flex-direction: column; gap: 2px; max-width: calc(100% - 90px); pointer-events: none; }
.mc-legend-row { display: flex; align-items: center; gap: 6px; height: 20px; padding: 0 4px; border-radius: 4px; white-space: nowrap; pointer-events: auto; font-size: 12px; }
.mc-legend-row.is-title { font-size: 13px; }
.mc-legend-row:hover { background: var(--mc-legend-hover); }
.mc-legend-title { color: var(--mc-text); }
.mc-legend-row.is-hidden .mc-legend-title, .mc-legend-row.is-hidden .mc-legend-values { opacity: 0.45; }
.mc-legend-values { display: flex; gap: 6px; font-variant-numeric: tabular-nums; }
.mc-legend-actions { display: none; gap: 1px; }
.mc-legend-row:hover .mc-legend-actions { display: flex; }
.mc-legend-actions button { width: 22px; height: 20px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 3px; background: transparent; color: var(--mc-icon); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-legend-actions button:hover { background: var(--mc-hover); color: var(--mc-text); }

.mc-stylebar { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); }
.mc-stylebar .mc-btn { width: 32px; height: 32px; }
.mc-stylebar-sep { width: 1px; height: 22px; margin: 0 3px; background: var(--mc-border); }
.mc-swatch { width: 18px; height: 18px; border-radius: 3px; border: 1px solid rgb(127 127 127 / 0.4); }
.mc-width-sample { width: 18px; border-radius: 1px; background: currentColor; }
.mc-popover { position: absolute; z-index: 40; padding: 8px; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
.mc-palette { display: grid; grid-template-columns: repeat(10, 20px); gap: 3px; }
.mc-palette button { width: 20px; height: 20px; padding: 0; border-radius: 3px; border: 1px solid rgb(127 127 127 / 0.25); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-palette button.is-on { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
.mc-opacity { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--mc-muted); }
.mc-opacity input { flex: 1; }
.mc-menu { display: flex; flex-direction: column; min-width: 160px; padding: 4px 0; }

.mc-dialog-backdrop { position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 0.35); }
.mc-dialog { width: 380px; max-width: calc(100% - 24px); max-height: calc(100% - 24px); display: flex; flex-direction: column; border-radius: 8px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 20px 60px rgb(0 0 0 / 0.5); color: var(--mc-text); }
.mc-dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--mc-border); }
.mc-dialog-body { padding: 12px 16px; overflow-y: auto; display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px 12px; align-items: center; }
.mc-dialog-body label { color: var(--mc-muted); font-size: 13px; }
.mc-dialog-body input, .mc-dialog-body select, .mc-dialog-body textarea { width: 100%; height: 30px; padding: 0 8px; border-radius: 4px; border: 1px solid var(--mc-border); background: var(--mc-input); color: var(--mc-text); font: 13px var(--mc-font); box-shadow: none; }
.mc-dialog-body textarea { height: 64px; padding: 6px 8px; resize: vertical; grid-column: span 2; }
.mc-dialog-body input[type='checkbox'] { width: 16px; height: 16px; justify-self: start; }
.mc-dialog-body input[type='color'] { padding: 2px; }
.mc-dialog-tabs { display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--mc-border); }
.mc-dialog-tab { height: 36px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--mc-muted); font: 14px var(--mc-font); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-dialog-tab:hover { color: var(--mc-text); }
.mc-dialog-tab.is-active { color: var(--mc-text); border-bottom-color: var(--mc-accent); }
.mc-dialog-body[hidden] { display: none; }
.mc-dialog-body .mc-span { grid-column: span 2; }
.mc-levels { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 14px; }
.mc-level { display: flex; align-items: center; gap: 6px; }
.mc-level input[type='checkbox'] { width: 16px; height: 16px; flex: none; }
.mc-level input[type='number'] { width: 80px; flex: 1; }
.mc-level input[type='color'] { width: 32px; flex: none; padding: 2px; }
.mc-dialog-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--mc-border); }
.mc-dialog-foot button { height: 32px; padding: 0 16px; border-radius: 4px; border: 1px solid var(--mc-border); background: transparent; color: var(--mc-text); font: 13px var(--mc-font); cursor: pointer; box-shadow: none; }
.mc-dialog-foot button.is-primary { background: var(--mc-accent); border-color: var(--mc-accent); color: #fff; }
.mc-dialog-foot .mc-spacer { flex: 1; }

.mc-menu-popup { position: absolute; z-index: 45; min-width: 210px; padding: 4px 0; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
.mc-menu-popup .mc-item { height: 30px; font-size: 13px; }
.mc-menu-popup .mc-item .mc-item-icon { width: 24px; height: 24px; }
.mc-menu-popup .mc-item-check { width: 16px; flex: none; color: var(--mc-accent); }
.mc-menu-popup .mc-item-key { color: var(--mc-muted); font-size: 12px; }
.mc-menu-sep { height: 1px; margin: 4px 0; background: var(--mc-border); }

.mc-tree { position: absolute; top: 0; right: 0; bottom: 0; width: 280px; z-index: 20; display: flex; flex-direction: column; background: var(--mc-surface); border-left: 1px solid var(--mc-border); box-shadow: -4px 0 16px rgb(0 0 0 / 0.2); }
.mc-tree-head { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 6px 0 14px; font-weight: 600; border-bottom: 1px solid var(--mc-border); }
.mc-tree-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.mc-tree-group { padding: 10px 14px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mc-muted); }
.mc-tree-row { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 6px 0 10px; cursor: pointer; }
.mc-tree-row:hover { background: var(--mc-hover); }
.mc-tree-row.is-selected { background: var(--mc-active-bg); }
.mc-tree-row .mc-item-icon { width: 24px; height: 24px; flex: none; color: var(--mc-icon); }
.mc-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-tree-row.is-hidden .mc-tree-name { opacity: 0.45; }
.mc-tree-actions { display: flex; gap: 1px; opacity: 0; }
.mc-tree-row:hover .mc-tree-actions, .mc-tree-actions .is-on { opacity: 1; }
.mc-tree-actions button, .mc-tree-head button { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 4px; background: transparent; color: var(--mc-icon); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-tree-actions button:hover, .mc-tree-head button:hover { background: var(--mc-hover); color: var(--mc-text); }
.mc-tree-empty { padding: 12px 14px; color: var(--mc-muted); font-size: 12px; }

.mc-replay { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 15; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 10px rgb(0 0 0 / 0.35); }
.mc-replay .mc-btn { width: 32px; height: 32px; }
.mc-replay select { height: 28px; border-radius: 4px; border: 1px solid var(--mc-border); background: var(--mc-input); color: var(--mc-text); font: 12px var(--mc-font); box-shadow: none; padding: 0 4px; min-height: 0; }
.mc-replay-status { padding: 0 8px; font-size: 12px; color: var(--mc-muted); white-space: nowrap; }
.mc-replay-hint { position: absolute; top: 50px; left: 50%; transform: translateX(-50%); z-index: 15; padding: 6px 12px; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); font-size: 12px; color: var(--mc-text); pointer-events: none; }

.mc-text-editor { position: absolute; z-index: 25; min-width: 80px; padding: 2px 4px; border: 1px solid var(--mc-accent); border-radius: 3px; background: var(--mc-input); color: var(--mc-text); font: 13px var(--mc-font); resize: none; outline: none; box-shadow: 0 0 0 3px var(--mc-active-bg); overflow: hidden; }
`;

export function ensureStyles(doc: Document): void {
  if (doc.getElementById('meridian-charts-style')) return;
  const style = doc.createElement('style');
  style.id = 'meridian-charts-style';
  style.textContent = css;
  doc.head.appendChild(style);
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

// The colours offered for drawings: a row of greys, a row of saturated hues, then tints and shades.
const hues = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'];
const greys = ['#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#131722', '#000000'];

function mix(hex: string, target: number, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * (1 - amount) + target * amount);
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

export const palette: readonly string[] = [
  ...greys,
  ...hues,
  ...hues.map((hue) => mix(hue, 255, 0.75)),
  ...hues.map((hue) => mix(hue, 255, 0.5)),
  ...hues.map((hue) => mix(hue, 255, 0.25)),
  ...hues.map((hue) => mix(hue, 0, 0.25)),
  ...hues.map((hue) => mix(hue, 0, 0.5)),
];
