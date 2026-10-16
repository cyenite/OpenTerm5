import type { DrawingStyle, LineStyle, SerializedDrawing } from '../types';
import { openColorPicker, placePopup, dismissible, paintSwatch, thicknesses } from './color-picker';
import { openTemplateList, type TemplateListActions } from './dialog';
import { lineSample } from './dropdown';
import { iconSvg } from './icons';
import type { MenuEntry } from './menu';
import { element } from './styles';

export interface StyleBarActions {
  setStyle: (patch: Partial<DrawingStyle>) => void;
  templates: () => TemplateListActions;
  openSettings: () => void;
  toggleLock: () => void;
  remove: () => void;
  // The overflow menu: clone, copy, visual order, visibility, hide.
  more: () => MenuEntry[];
  openMenu: (x: number, y: number, entries: MenuEntry[]) => void;
}

const POSITION_KEY = 'meridian.stylebar.position';

const lineStyles: { value: LineStyle; label: string }[] = [{ value: 'solid', label: 'Line' }, { value: 'dashed', label: 'Dashed line' }, { value: 'dotted', label: 'Dotted line' }];

function loadPosition(): { x: number; y: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : null;
  } catch {
    return null;
  }
}

// TradingView's floating toolbar for the selected drawing: a drag handle, templates, line, fill
// and text colours, line width and style, settings, lock, remove and a menu of the rest. It can be
// dragged anywhere on the chart and stays where it was left.
export class StyleBar {
  private readonly bar: HTMLElement;
  private closePopup: (() => void) | null = null;
  private drawingId: string | null = null;
  private position = loadPosition();

  constructor(private readonly host: HTMLElement, private readonly actions: StyleBarActions) {
    this.bar = element('div', 'mc-stylebar', host);
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Drawing style');
    this.bar.style.display = 'none';
    this.bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.bar.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  destroy(): void {
    this.closePopover();
    this.bar.remove();
  }

  hide(): void {
    this.closePopover();
    this.drawingId = null;
    this.bar.style.display = 'none';
  }

  show(drawing: SerializedDrawing, options: { isFillable: boolean; hasText: boolean }): void {
    // A colour picked in an open picker restyles the drawing, which shows the bar again; the
    // picker stays open, as in TradingView, and has already updated its own button.
    if (this.closePopup && this.drawingId === drawing.id) return;
    this.drawingId = drawing.id;
    this.closePopover();
    this.bar.replaceChildren();
    this.bar.style.display = '';
    const { style } = drawing;
    const handle = element('span', 'mc-stylebar-handle', this.bar);
    handle.innerHTML = iconSvg('drag-handle', 24);
    handle.title = 'Move';
    handle.addEventListener('pointerdown', this.onDrag);
    const template = this.button('Template', (button) => this.toggle(button, () => openTemplateList(this.host, button, this.actions.templates(), () => this.popupClosed(button), { saveAs: 'Save Drawing Template As…', applyDefault: 'Apply Default Drawing Template' })));
    template.innerHTML = iconSvg('template', 24);
    const color = (icon: string, title: string, value: string, opacity: number | undefined, apply: (color: string, opacity?: number) => void) => {
      const button = this.button(title, (self) => this.toggle(self, () => openColorPicker(this.host, self, { color: value, ...(opacity !== undefined ? { opacity: Math.round(opacity * 100) } : {}) }, (pick) => {
        value = pick.color;
        if (pick.opacity !== undefined) opacity = pick.opacity / 100;
        paintSwatch(bar, value, (opacity ?? 1) * 100);
        apply(pick.color, pick.opacity === undefined ? undefined : pick.opacity / 100);
      }, () => this.popupClosed(self))));
      button.classList.add('mc-color-button');
      button.innerHTML = iconSvg(icon, 24);
      const bar = element('span', 'mc-color-bar', button);
      paintSwatch(bar, value, (opacity ?? 1) * 100);
    };
    color('line-color', 'Line tool colors', style.lineColor, style.lineOpacity ?? 1, (lineColor, opacity) => this.actions.setStyle({ lineColor, ...(opacity === undefined || opacity >= 1 ? { lineOpacity: undefined } : { lineOpacity: opacity }) }));
    if (options.isFillable) color('fill-color', 'Line tool background', style.fillColor ?? style.lineColor, style.fillOpacity ?? 0.15, (fillColor, fillOpacity) => this.actions.setStyle({ fillColor, ...(fillOpacity !== undefined ? { fillOpacity } : {}) }));
    if (options.hasText) color('text-letter', 'Line tool text color', style.textColor ?? style.lineColor, undefined, (textColor) => this.actions.setStyle({ textColor }));
    const width = this.button('Line tool width', (self) => this.toggle(self, () => this.openList(self, thicknesses.map((value) => ({ label: `${value}px`, sample: lineSample('solid', value), isOn: style.lineWidth === value, pick: () => this.actions.setStyle({ lineWidth: value }) })))));
    width.classList.add('mc-width-button');
    lineSample('solid', Math.min(4, style.lineWidth))(width);
    element('span', 'mc-width-label', width).textContent = `${style.lineWidth}px`;
    const styleButton = this.button('Style', (self) => this.toggle(self, () => this.openList(self, lineStyles.map((option) => ({ label: option.label, sample: lineSample(option.value, 1), isOn: style.lineStyle === option.value, pick: () => this.actions.setStyle({ lineStyle: option.value }) })))));
    lineSample(style.lineStyle, 1)(styleButton);
    element('span', 'mc-stylebar-sep', this.bar);
    this.button('Settings', () => this.actions.openSettings()).innerHTML = iconSvg('settings', 24);
    this.button(drawing.locked ? 'Unlock' : 'Lock', () => this.actions.toggleLock()).innerHTML = iconSvg(drawing.locked ? 'lock' : 'unlock', 24);
    this.button('Remove', () => this.actions.remove()).innerHTML = iconSvg('trash', 24);
    const more = this.button('More', (self) => {
      const box = this.host.getBoundingClientRect();
      const at = self.getBoundingClientRect();
      this.closePopover();
      this.actions.openMenu(at.left - box.left, at.bottom - box.top + 4, this.actions.more());
    });
    more.innerHTML = iconSvg('more', 24);
    this.place();
  }

  private button(title: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const button = element('button', 'mc-btn', this.bar);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.onclick = (event) => { event.stopPropagation(); onClick(button); };
    return button;
  }

  // Opens a popup from a button, or closes it when that button's popup is already open.
  private toggle(button: HTMLButtonElement, open: () => () => void): void {
    const isOpen = button.classList.contains('is-open');
    this.closePopover();
    if (isOpen) return;
    button.classList.add('is-open');
    this.closePopup = open();
  }

  private popupClosed(button: HTMLButtonElement): void {
    button.classList.remove('is-open');
    this.closePopup = null;
  }

  private openList(anchor: HTMLButtonElement, choices: { label: string; sample?: (into: HTMLElement) => void; isOn: boolean; pick: () => void }[]): () => void {
    const popup = element('div', 'mc-dropdown-list', this.host);
    popup.setAttribute('role', 'listbox');
    popup.addEventListener('pointerdown', (event) => event.stopPropagation());
    for (const choice of choices) {
      const item = element('button', `mc-dropdown-item${choice.isOn ? ' is-on' : ''}`, popup);
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(choice.isOn));
      choice.sample?.(item);
      element('span', 'mc-dropdown-label', item).textContent = choice.label;
      item.onclick = () => { close(); choice.pick(); };
    }
    placePopup(popup, this.host, anchor);
    const stop = dismissible(popup, anchor, () => close());
    const close = () => {
      stop();
      popup.remove();
      this.popupClosed(anchor);
    };
    return close;
  }

  // Keeps the bar inside the chart; with no saved place it sits centred at the top.
  private place(): void {
    const box = this.host.getBoundingClientRect();
    if (!this.position) {
      this.bar.style.left = '50%';
      this.bar.style.top = '8px';
      this.bar.style.transform = 'translateX(-50%)';
      return;
    }
    this.bar.style.transform = 'none';
    this.bar.style.left = `${Math.max(0, Math.min(box.width - this.bar.offsetWidth, this.position.x))}px`;
    this.bar.style.top = `${Math.max(0, Math.min(box.height - this.bar.offsetHeight, this.position.y))}px`;
  }

  private onDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.closePopover();
    const handle = event.currentTarget as HTMLElement;
    const box = this.host.getBoundingClientRect();
    const at = this.bar.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: at.left - box.left, top: at.top - box.top };
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      this.position = {
        x: Math.max(0, Math.min(box.width - this.bar.offsetWidth, start.left + moveEvent.clientX - start.x)),
        y: Math.max(0, Math.min(box.height - this.bar.offsetHeight, start.top + moveEvent.clientY - start.y)),
      };
      this.place();
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(this.position)); } catch { /* The place then lasts for this session. */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  private closePopover(): void {
    const close = this.closePopup;
    this.closePopup = null;
    close?.();
  }
}
