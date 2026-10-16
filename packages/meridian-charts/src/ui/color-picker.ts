import { element, palette } from './styles';

export interface ColorPick {
  color: string;
  // 0 to 100, when the picker offers opacity.
  opacity?: number;
  // Line width in pixels, when the picker offers thickness.
  thickness?: number;
}

const CUSTOM_KEY = 'meridian.custom-colors';
const CUSTOM_LIMIT = 10;

export const thicknesses = [1, 2, 3, 4] as const;

function loadCustom(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).slice(0, CUSTOM_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveCustom(colors: readonly string[]): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(colors)); } catch { /* Custom colours then last for this session. */ }
}

// Shared by every picker in the window, as the custom row is in TradingView.
let customColors = loadCustom();

// Places a popup under `anchor` inside `host`, flipping above it when there is no room below.
export function placePopup(popup: HTMLElement, host: HTMLElement, anchor: HTMLElement): void {
  const hostBox = host.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  const left = Math.max(4, Math.min(box.left - hostBox.left, hostBox.width - popup.offsetWidth - 4));
  const below = box.bottom - hostBox.top + 4;
  const above = box.top - hostBox.top - popup.offsetHeight - 4;
  popup.style.left = `${left}px`;
  popup.style.top = `${below + popup.offsetHeight > hostBox.height - 4 && above >= 4 ? above : Math.max(4, Math.min(below, hostBox.height - popup.offsetHeight - 4))}px`;
}

// Closes a popup on a pointer press outside it (and outside `anchor`, which toggles it) or Escape.
export function dismissible(popup: HTMLElement, anchor: HTMLElement | null, close: () => void): () => void {
  const onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!popup.contains(target) && !anchor?.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  };
  const timer = setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
  return () => {
    clearTimeout(timer);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

// The colour popup of TradingView: the swatch grid, a row of custom colours with a "+" that opens
// the system picker, then opacity and line thickness when the caller edits them. Every pick applies
// at once; the popup stays open until a click elsewhere or Escape.
export function openColorPicker(host: HTMLElement, anchor: HTMLElement, current: ColorPick, onChange: (pick: ColorPick) => void, onClose?: () => void): () => void {
  const pick: ColorPick = { ...current };
  const popup = element('div', 'mc-color-picker', host);
  popup.addEventListener('pointerdown', (event) => event.stopPropagation());
  const grid = element('div', 'mc-palette', popup);
  let cells: HTMLButtonElement[] = [];
  const swatch = (parent: HTMLElement, color: string) => {
    const cell = element('button', undefined, parent);
    cell.type = 'button';
    cell.style.background = color;
    cell.title = color;
    cell.dataset.color = color.toLowerCase();
    cell.setAttribute('aria-label', color);
    cell.onclick = () => choose(color);
    cells.push(cell);
    return cell;
  };
  const mark = () => {
    for (const cell of cells) cell.classList.toggle('is-on', cell.dataset.color === pick.color.toLowerCase());
  };
  const choose = (color: string) => {
    pick.color = color;
    mark();
    onChange({ ...pick });
  };
  for (const color of palette) swatch(grid, color);
  element('div', 'mc-picker-sep', popup);
  const custom = element('div', 'mc-palette mc-custom', popup);
  const renderCustom = () => {
    cells = cells.filter((cell) => !custom.contains(cell));
    custom.replaceChildren();
    for (const color of customColors) swatch(custom, color);
    const add = element('button', 'mc-add-color', custom);
    add.type = 'button';
    add.title = 'Add custom color';
    add.setAttribute('aria-label', 'Add custom color');
    add.textContent = '+';
    const input = element('input', 'mc-native-color', custom);
    input.type = 'color';
    input.value = /^#[0-9a-f]{6}$/i.test(pick.color) ? pick.color : '#2962ff';
    input.tabIndex = -1;
    add.onclick = () => input.click();
    input.onchange = () => {
      const color = input.value.toLowerCase();
      customColors = [color, ...customColors.filter((candidate) => candidate !== color)].slice(0, CUSTOM_LIMIT);
      saveCustom(customColors);
      renderCustom();
      choose(color);
    };
    mark();
  };
  renderCustom();
  if (pick.opacity !== undefined) {
    element('div', 'mc-picker-sep', popup);
    element('div', 'mc-picker-title', popup).textContent = 'Opacity';
    const row = element('div', 'mc-picker-opacity', popup);
    const slider = element('input', undefined, row);
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.setAttribute('aria-label', 'Opacity');
    const box = element('label', 'mc-percent', row);
    const value = element('input', undefined, box);
    value.type = 'number';
    value.min = '0';
    value.max = '100';
    value.setAttribute('aria-label', 'Opacity percent');
    box.append('%');
    const set = (opacity: number, from?: HTMLInputElement) => {
      pick.opacity = Math.max(0, Math.min(100, Math.round(opacity)));
      if (from !== slider) slider.value = String(pick.opacity);
      if (from !== value) value.value = String(pick.opacity);
      slider.style.setProperty('--mc-fill', `${pick.opacity}%`);
      slider.style.setProperty('--mc-swatch', pick.color);
    };
    set(pick.opacity);
    slider.oninput = () => { set(Number(slider.value), slider); onChange({ ...pick }); };
    value.oninput = () => { if (value.value !== '' && Number.isFinite(Number(value.value))) { set(Number(value.value), value); onChange({ ...pick }); } };
  }
  if (pick.thickness !== undefined) {
    element('div', 'mc-picker-sep', popup);
    element('div', 'mc-picker-title', popup).textContent = 'Thickness';
    const row = element('div', 'mc-thickness', popup);
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Thickness');
    for (const width of thicknesses) {
      const button = element('button', pick.thickness === width ? 'is-on' : '', row);
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(pick.thickness === width));
      button.setAttribute('aria-label', `${width}px`);
      element('span', undefined, button).style.height = `${width}px`;
      button.onclick = () => {
        pick.thickness = width;
        for (const node of row.children) {
          node.classList.toggle('is-on', node === button);
          node.setAttribute('aria-checked', String(node === button));
        }
        onChange({ ...pick });
      };
    }
  }
  placePopup(popup, host, anchor);
  const stop = dismissible(popup, anchor, () => close());
  function close() {
    stop();
    popup.remove();
    onClose?.();
  }
  return close;
}

// A colour sample over a checkerboard, so transparency shows.
export function paintSwatch(sample: HTMLElement, color: string, opacity = 100): void {
  sample.style.setProperty('--mc-swatch', color);
  sample.style.setProperty('--mc-swatch-opacity', String(Math.max(0, Math.min(100, opacity)) / 100));
}
