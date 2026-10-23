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
.mc-rail > .mc-btn { flex: none; }
.mc-btn { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 4px; background: transparent; color: var(--mc-icon); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-btn:hover { background: var(--mc-hover); color: var(--mc-text); }
.mc-btn.is-active { color: var(--mc-accent); background: var(--mc-active-bg); }
.mc-btn svg { display: block; }
.mc-arrow { position: absolute; right: -2px; top: 50%; width: 12px; height: 24px; margin-top: -12px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 3px; background: transparent; color: var(--mc-icon); cursor: pointer; opacity: 0.55; box-shadow: none; min-height: 0; }
.mc-cell:hover .mc-arrow, .mc-arrow.is-open, .mc-arrow:focus-visible { opacity: 1; }
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
.mc-legend-title { color: var(--mc-legend-text, var(--mc-text)); }
.mc-legend-row.is-hidden .mc-legend-title, .mc-legend-row.is-hidden .mc-legend-values { opacity: 0.45; }
.mc-legend-values { display: flex; gap: 6px; font-variant-numeric: tabular-nums; }
.mc-legend-actions { display: none; gap: 1px; }
.mc-legend-row:hover .mc-legend-actions { display: flex; }
.mc-legend-actions button { width: 22px; height: 20px; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 3px; background: transparent; color: var(--mc-icon); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-legend-actions button:hover { background: var(--mc-hover); color: var(--mc-text); }

.mc-stylebar { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 2px; height: 42px; padding: 0 4px 0 2px; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 4px rgb(0 0 0 / 0.15), 0 4px 16px rgb(0 0 0 / 0.25); }
.mc-stylebar .mc-btn { width: 34px; height: 34px; position: relative; }
.mc-stylebar .mc-btn.is-open { background: var(--mc-active-bg); color: var(--mc-text); }
.mc-stylebar-handle { display: flex; align-items: center; justify-content: center; width: 18px; height: 34px; color: var(--mc-muted); cursor: grab; touch-action: none; }
.mc-stylebar-handle:active { cursor: grabbing; }
.mc-stylebar-handle svg { width: 24px; height: 24px; margin: 0 -3px; }
.mc-stylebar-sep { width: 1px; height: 24px; margin: 0 4px; background: var(--mc-border); }
.mc-color-button svg { margin-top: -5px; }
.mc-color-bar { position: absolute; left: 8px; right: 8px; bottom: 5px; height: 4px; border-radius: 1px; overflow: hidden; background: repeating-conic-gradient(#c8c8c8 0 25%, #fff 0 50%) 0 0 / 4px 4px; }
.mc-color-bar::after { content: ''; position: absolute; inset: 0; background: var(--mc-swatch); opacity: var(--mc-swatch-opacity, 1); }
.mc-stylebar .mc-width-button { width: auto; padding: 0 6px; gap: 4px; }
.mc-width-button .mc-line-sample svg { width: 22px; }
.mc-width-label { font-size: 12px; color: var(--mc-text); }
.mc-line-sample { display: flex; align-items: center; color: var(--mc-text); }
.mc-swatch { width: 18px; height: 18px; border-radius: 3px; border: 1px solid rgb(127 127 127 / 0.4); }

.mc-color-picker, .mc-dropdown-list, .mc-template-list { position: absolute; z-index: 60; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 4px rgb(0 0 0 / 0.15), 0 8px 24px rgb(0 0 0 / 0.3); color: var(--mc-text); }
.mc-color-picker { width: 252px; padding: 12px; }
.mc-palette { display: grid; grid-template-columns: repeat(10, 20px); gap: 4px; }
.mc-palette button { width: 20px; height: 20px; padding: 0; border-radius: 4px; border: 1px solid rgb(127 127 127 / 0.2); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-palette button:hover { transform: scale(1.12); }
.mc-palette button.is-on { box-shadow: 0 0 0 2px var(--mc-surface), 0 0 0 4px var(--mc-accent); }
.mc-palette .mc-add-color { display: flex; align-items: center; justify-content: center; border: 1px dashed var(--mc-muted); background: transparent; color: var(--mc-muted); font: 16px/1 var(--mc-font); }
.mc-palette .mc-add-color:hover { color: var(--mc-text); border-color: var(--mc-text); transform: none; }
.mc-native-color { position: absolute; width: 0; height: 0; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.mc-picker-sep { height: 1px; margin: 12px 0; background: var(--mc-border); }
.mc-picker-title { margin-bottom: 8px; font-size: 13px; color: var(--mc-muted); }
.mc-picker-opacity { display: flex; align-items: center; gap: 10px; }
.mc-picker-opacity input[type='range'] { flex: 1; height: 6px; margin: 0; border-radius: 3px; appearance: none; -webkit-appearance: none; background: linear-gradient(to right, transparent, var(--mc-swatch)), repeating-conic-gradient(#c8c8c8 0 25%, #fff 0 50%) 0 0 / 6px 6px; cursor: pointer; }
.mc-picker-opacity input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 1px solid rgb(0 0 0 / 0.25); box-shadow: 0 1px 3px rgb(0 0 0 / 0.35); }
.mc-percent { display: flex; align-items: center; gap: 2px; height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--mc-border); background: var(--mc-input); font-size: 13px; color: var(--mc-muted); }
.mc-percent input { width: 30px; height: 28px; padding: 0; border: 0; background: transparent; color: var(--mc-text); font: 13px var(--mc-font); text-align: right; box-shadow: none; outline: none; -moz-appearance: textfield; }
.mc-percent input::-webkit-inner-spin-button, .mc-percent input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.mc-thickness { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.mc-thickness button { display: flex; align-items: center; justify-content: center; height: 32px; padding: 0 8px; border-radius: 4px; border: 1px solid var(--mc-border); background: transparent; color: var(--mc-text); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-thickness button span { width: 100%; border-radius: 1px; background: currentColor; }
.mc-thickness button:hover { background: var(--mc-hover); }
.mc-thickness button.is-on { border-color: var(--mc-text); }
.mc-menu { display: flex; flex-direction: column; min-width: 160px; padding: 4px 0; }

.mc-dropdown-list, .mc-template-list { min-width: 140px; max-height: 300px; overflow-y: auto; padding: 6px 0; }
.mc-dropdown-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 0 14px; border: 0; border-radius: 0; background: transparent; color: var(--mc-text); font: 14px var(--mc-font); text-align: left; cursor: pointer; box-shadow: none; }
.mc-dropdown-item:hover { background: var(--mc-hover); }
.mc-dropdown-item.is-on { background: var(--mc-active-bg); }
.mc-dropdown-label { flex: 1; white-space: nowrap; }
.mc-template-remove { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-right: -6px; border-radius: 4px; color: var(--mc-muted); visibility: hidden; }
.mc-dropdown-item:hover .mc-template-remove { visibility: visible; }
.mc-template-remove:hover { background: var(--mc-hover); color: var(--mc-text); }
.mc-template-empty { padding: 8px 14px; font-size: 13px; color: var(--mc-muted); }

.mc-dialog-backdrop { position: absolute; inset: 0; z-index: 50; background: transparent; }
.mc-dialog { position: absolute; width: 440px; max-width: calc(100% - 16px); max-height: calc(100% - 16px); display: flex; flex-direction: column; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 2px 4px rgb(0 0 0 / 0.15), 0 12px 40px rgb(0 0 0 / 0.4); color: var(--mc-text); font: 14px var(--mc-font); }
.mc-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 12px 14px 20px; cursor: move; touch-action: none; }
.mc-dialog-title { font-size: 20px; font-weight: 600; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-dialog-close { width: 34px; height: 34px; flex: none; display: flex; align-items: center; justify-content: center; border: 0; padding: 0; border-radius: 6px; background: transparent; color: var(--mc-icon); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-dialog-close:hover { background: var(--mc-hover); color: var(--mc-text); }
.mc-dialog-tabs { display: flex; gap: 4px; padding: 0 14px; border-bottom: 1px solid var(--mc-border); overflow-x: auto; scrollbar-width: none; }
.mc-dialog-tab { position: relative; height: 38px; padding: 0 8px; border: 0; border-radius: 0; background: transparent; color: var(--mc-text); font: 14px var(--mc-font); white-space: nowrap; cursor: pointer; box-shadow: none; min-height: 0; }
.mc-dialog-tab::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: transparent; }
.mc-dialog-tab:hover::after { background: var(--mc-border); }
.mc-dialog-tab.is-active::after { background: var(--mc-text); }
.mc-dialog-content { min-height: 120px; padding: 10px 20px 16px; overflow-y: auto; }
.mc-dialog-message { margin: 6px 0 4px; line-height: 1.5; }
.mc-dialog-body[hidden] { display: none; }
.mc-row { display: flex; align-items: center; gap: 8px; min-height: 42px; }
.mc-row-label { display: flex; align-items: center; gap: 10px; width: 150px; flex: none; color: var(--mc-text); font-size: 14px; }
.mc-row.is-check .mc-row-label, .mc-row.is-bare .mc-row-label { width: auto; }
.mc-row-label span { overflow: hidden; text-overflow: ellipsis; }
.mc-row-controls { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; flex-wrap: wrap; }
.mc-dialog .mc-input { height: 34px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--mc-border); background: var(--mc-input); color: var(--mc-text); font: 14px var(--mc-font); box-shadow: none; outline: none; min-width: 0; }
.mc-dialog .mc-input:hover { border-color: var(--mc-muted); }
.mc-dialog .mc-input:focus { border-color: var(--mc-accent); }
.mc-dialog .mc-number { width: 120px; }
.mc-dialog .mc-datetime { width: 200px; }
.mc-dialog .mc-row-controls > .mc-input[type='text'] { flex: 1; }
.mc-textarea { display: block; width: 100%; height: 110px !important; margin: 6px 0; padding: 8px 10px !important; resize: vertical; line-height: 1.4; }
.mc-check { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; flex: none; margin: 0; border-radius: 4px; border: 1px solid var(--mc-muted); background: transparent; cursor: pointer; display: grid; place-content: center; }
.mc-check:hover { border-color: var(--mc-text); }
.mc-check:checked { background: var(--mc-accent); border-color: var(--mc-accent); }
.mc-check:checked::after { content: ''; width: 9px; height: 5px; margin-top: -2px; border-left: 2px solid #fff; border-bottom: 2px solid #fff; transform: rotate(-45deg); }
.mc-color { width: 34px; height: 34px; flex: none; display: flex; align-items: center; justify-content: center; padding: 0; border-radius: 6px; border: 1px solid var(--mc-border); background: var(--mc-input); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-color:hover, .mc-color.is-open { border-color: var(--mc-muted); }
.mc-swatch-face { position: relative; width: 22px; height: 22px; border-radius: 4px; overflow: hidden; background: repeating-conic-gradient(#c8c8c8 0 25%, #fff 0 50%) 0 0 / 8px 8px; }
.mc-swatch-face::after { content: ''; position: absolute; inset: 0; background: var(--mc-swatch); opacity: var(--mc-swatch-opacity, 1); box-shadow: inset 0 0 0 1px rgb(127 127 127 / 0.25); border-radius: 4px; }
.mc-dropdown { display: flex; align-items: center; gap: 6px; height: 34px; min-width: 64px; padding: 0 6px 0 10px; border-radius: 6px; border: 1px solid var(--mc-border); background: var(--mc-input); color: var(--mc-text); font: 14px var(--mc-font); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-dropdown:hover, .mc-dropdown.is-open { border-color: var(--mc-muted); }
.mc-dropdown-face { display: flex; align-items: center; gap: 8px; flex: 1; text-align: left; white-space: nowrap; }
.mc-dropdown-chevron { display: flex; color: var(--mc-icon); transition: transform 0.12s; }
.mc-dropdown.is-open .mc-dropdown-chevron, .mc-template-button.is-open .mc-dropdown-chevron { transform: rotate(180deg); }
.mc-toggle { width: 34px; height: 34px; flex: none; padding: 0; border-radius: 6px; border: 1px solid var(--mc-border); background: transparent; color: var(--mc-text); font: 15px var(--mc-font); cursor: pointer; box-shadow: none; min-height: 0; }
.mc-toggle.is-bold { font-weight: 700; }
.mc-toggle.is-italic { font-style: italic; font-family: Georgia, serif; }
.mc-toggle:hover { background: var(--mc-hover); }
.mc-toggle.is-on { background: var(--mc-active-bg); border-color: var(--mc-accent); color: var(--mc-accent); }
.mc-levels { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px; padding: 6px 0; }
.mc-level { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mc-dialog .mc-level .mc-input { width: 0; flex: 1.3; padding: 0 6px; -moz-appearance: textfield; }
.mc-dialog .mc-level .mc-input::-webkit-inner-spin-button, .mc-dialog .mc-level .mc-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.mc-dialog .mc-level .mc-level-text { flex: 1; }
.mc-range { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.mc-dialog .mc-range-value { width: 54px; flex: none; padding: 0 6px; text-align: center; -moz-appearance: textfield; }
.mc-range-value::-webkit-inner-spin-button, .mc-range-value::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.mc-range-track { position: relative; flex: 1; height: 20px; min-width: 60px; }
.mc-range-track::before { content: ''; position: absolute; left: 0; right: 0; top: 8px; height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--mc-border) var(--mc-from, 0%), var(--mc-accent) var(--mc-from, 0%), var(--mc-accent) var(--mc-to, 100%), var(--mc-border) var(--mc-to, 100%)); }
.mc-range-track input { position: absolute; inset: 0; width: 100%; height: 20px; margin: 0; appearance: none; -webkit-appearance: none; background: transparent; pointer-events: none; }
.mc-range-track input::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--mc-surface); border: 2px solid var(--mc-accent); pointer-events: auto; cursor: pointer; }
.mc-range-track input::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--mc-surface); border: 2px solid var(--mc-accent); pointer-events: auto; cursor: pointer; }
.mc-dialog-foot { display: flex; align-items: center; gap: 10px; padding: 14px 20px 18px; border-top: 1px solid var(--mc-border); }
.mc-dialog-foot button { display: flex; align-items: center; gap: 4px; height: 34px; min-width: 70px; justify-content: center; padding: 0 14px; border-radius: 6px; border: 1px solid var(--mc-border); background: transparent; color: var(--mc-text); font: 14px var(--mc-font); cursor: pointer; box-shadow: none; }
.mc-dialog-foot button:hover { border-color: var(--mc-muted); background: var(--mc-hover); }
.mc-dialog-foot .mc-template-button { padding: 0 6px 0 12px; }
.mc-dialog-foot button.is-primary { background: var(--mc-text); border-color: var(--mc-text); color: var(--mc-surface); font-weight: 600; }
.mc-dialog-foot button.is-primary:hover { opacity: 0.88; }
.mc-dialog-foot .mc-spacer { flex: 1; }

.mc-menu-popup { position: absolute; z-index: 45; min-width: 210px; padding: 4px 0; border-radius: 6px; background: var(--mc-surface); border: 1px solid var(--mc-border); box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
.mc-menu-popup .mc-item { height: 30px; font-size: 13px; }
.mc-menu-popup .mc-item .mc-item-icon { width: 24px; height: 24px; }
.mc-menu-popup .mc-item-check { width: 16px; flex: none; color: var(--mc-accent); }
.mc-menu-popup .mc-item-key { color: var(--mc-muted); font-size: 12px; }
.mc-menu-sep { height: 1px; margin: 4px 0; background: var(--mc-border); }
.mc-menu-popup .mc-item.is-open { background: var(--mc-hover); }
.mc-menu-popup .mc-item-more { display: flex; margin-right: -4px; color: var(--mc-icon); }

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

// Tag checks instead of `instanceof`: a chart in another window has that window's element classes.
export function isTag(target: EventTarget | null, ...tags: string[]): boolean {
  return !!target && tags.includes((target as Element).tagName);
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = (parent?.ownerDocument ?? document).createElement(tag);
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
