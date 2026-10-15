import type { DrawingStyle, LineStyle, SerializedDrawing } from '../types';
import { iconSvg } from './icons';
import { element, palette } from './styles';

export interface StyleBarActions {
  setStyle: (patch: Partial<DrawingStyle>) => void;
  openSettings: () => void;
  toggleLock: () => void;
  clone: () => void;
  remove: () => void;
}

// The floating bar shown above the chart while a drawing is selected: colours, line width and
// style, settings, lock, clone and delete.
export class StyleBar {
  private readonly bar: HTMLElement;
  private popover: HTMLElement | null = null;

  constructor(private readonly host: HTMLElement, private readonly actions: StyleBarActions) {
    this.bar = element('div', 'mc-stylebar', host);
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Drawing style');
    this.bar.style.display = 'none';
    this.bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    document.addEventListener('pointerdown', this.onOutside, true);
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.closePopover();
    this.bar.remove();
  }

  hide(): void {
    this.closePopover();
    this.bar.style.display = 'none';
  }

  show(drawing: SerializedDrawing, options: { isFillable: boolean }): void {
    this.closePopover();
    this.bar.replaceChildren();
    this.bar.style.display = '';
    const { style } = drawing;
    const swatch = (color: string, title: string, onPick: (color: string, opacity?: number) => void, opacity?: number) => {
      const button = this.button(title, () => this.openPalette(button, color, onPick, opacity));
      const sample = element('span', 'mc-swatch', button);
      sample.style.background = color;
      if (opacity !== undefined) sample.style.opacity = String(Math.max(0.25, opacity));
    };
    swatch(style.lineColor, 'Line color', (color) => this.actions.setStyle({ lineColor: color }));
    if (options.isFillable) swatch(style.fillColor ?? style.lineColor, 'Background', (color, opacity) => this.actions.setStyle({ fillColor: color, fillOpacity: opacity }), style.fillOpacity ?? 0.15);
    const width = this.button('Line width', () => this.openChoices(width, [1, 2, 3, 4].map((value) => ({ label: `${value}px`, sample: value, isOn: style.lineWidth === value, pick: () => this.actions.setStyle({ lineWidth: value }) }))));
    width.innerHTML = iconSvg('line-width', 24);
    const lineStyles: { value: LineStyle; label: string }[] = [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }];
    const styleButton = this.button('Line style', () => this.openChoices(styleButton, lineStyles.map((option) => ({ label: option.label, isOn: style.lineStyle === option.value, pick: () => this.actions.setStyle({ lineStyle: option.value }) }))));
    styleButton.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 12h16" ${style.lineStyle === 'dashed' ? 'stroke-dasharray="4 3"' : style.lineStyle === 'dotted' ? 'stroke-dasharray="0.5 3"' : ''}/></svg>`;
    element('span', 'mc-stylebar-sep', this.bar);
    this.button('Settings', this.actions.openSettings).innerHTML = iconSvg('settings', 24);
    this.button(drawing.locked ? 'Unlock' : 'Lock', this.actions.toggleLock).innerHTML = iconSvg(drawing.locked ? 'lock' : 'unlock', 24);
    this.button('Clone', this.actions.clone).innerHTML = iconSvg('clone', 24);
    this.button('Remove', this.actions.remove).innerHTML = iconSvg('trash', 24);
  }

  private button(title: string, onClick: () => void): HTMLButtonElement {
    const button = element('button', 'mc-btn', this.bar);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.onclick = (event) => { event.stopPropagation(); onClick(); };
    return button;
  }

  private onOutside = (event: PointerEvent) => {
    if (this.popover && !this.popover.contains(event.target as Node) && !this.bar.contains(event.target as Node)) this.closePopover();
  };

  private openAt(anchor: HTMLElement): HTMLElement {
    this.closePopover();
    const popover = element('div', 'mc-popover', this.host);
    popover.addEventListener('pointerdown', (event) => event.stopPropagation());
    const hostBox = this.host.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    popover.style.left = `${Math.max(4, box.left - hostBox.left)}px`;
    popover.style.top = `${box.bottom - hostBox.top + 6}px`;
    this.popover = popover;
    return popover;
  }

  private openPalette(anchor: HTMLElement, current: string, onPick: (color: string, opacity?: number) => void, opacity?: number): void {
    const popover = this.openAt(anchor);
    const grid = element('div', 'mc-palette', popover);
    let level = opacity;
    for (const color of palette) {
      const cell = element('button', `${color.toLowerCase() === current.toLowerCase() ? 'is-on' : ''}`, grid);
      cell.type = 'button';
      cell.style.background = color;
      cell.title = color;
      cell.setAttribute('aria-label', color);
      cell.onclick = () => { onPick(color, level); this.closePopover(); };
    }
    if (opacity !== undefined) {
      const row = element('label', 'mc-opacity', popover);
      row.append('Opacity');
      const slider = element('input', undefined, row);
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(opacity * 100));
      slider.oninput = () => { level = Number(slider.value) / 100; onPick(current, level); };
    }
  }

  private openChoices(anchor: HTMLElement, choices: { label: string; sample?: number; isOn: boolean; pick: () => void }[]): void {
    const popover = this.openAt(anchor);
    popover.style.padding = '4px 0';
    const menu = element('div', 'mc-menu', popover);
    for (const choice of choices) {
      const item = element('button', `mc-item${choice.isOn ? ' is-active' : ''}`, menu);
      item.type = 'button';
      if (choice.sample) {
        const sample = element('span', 'mc-width-sample', item);
        sample.style.height = `${choice.sample}px`;
      }
      element('span', 'mc-item-label', item).textContent = choice.label;
      item.onclick = () => { choice.pick(); this.closePopover(); };
    }
  }

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }
}
