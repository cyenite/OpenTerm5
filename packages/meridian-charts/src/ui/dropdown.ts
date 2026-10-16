import { dismissible, placePopup } from './color-picker';
import { iconSvg } from './icons';
import { element } from './styles';

export interface DropdownOption {
  value: string;
  label: string;
  // Draws a sample (a line style, a width) before the label.
  sample?: (into: HTMLElement) => void;
}

export interface Dropdown {
  button: HTMLButtonElement;
  get: () => string;
  set: (value: string) => void;
}

// A TradingView select: a button with the current choice and a chevron, opening a list popup in
// `host` with the current choice marked. Native selects open an OS menu that looks nothing like it.
export function dropdown(parent: HTMLElement, host: HTMLElement, options: readonly DropdownOption[], value: string, label: string, onChange: (value: string) => void): Dropdown {
  let current = value;
  let close: (() => void) | null = null;
  const button = element('button', 'mc-dropdown', parent);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'listbox');
  const face = element('span', 'mc-dropdown-face', button);
  element('span', 'mc-dropdown-chevron', button).innerHTML = iconSvg('chevron-down', 18);
  const render = () => {
    const option = options.find((candidate) => candidate.value === current);
    face.replaceChildren();
    option?.sample?.(face);
    if (!option?.sample || option.label) element('span', 'mc-dropdown-label', face).textContent = option?.label ?? current;
  };
  render();
  button.onclick = () => {
    if (close) { close(); return; }
    const popup = element('div', 'mc-dropdown-list', host);
    popup.setAttribute('role', 'listbox');
    popup.style.minWidth = `${button.offsetWidth}px`;
    popup.addEventListener('pointerdown', (event) => event.stopPropagation());
    for (const option of options) {
      const item = element('button', `mc-dropdown-item${option.value === current ? ' is-on' : ''}`, popup);
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === current));
      option.sample?.(item);
      if (option.label) element('span', 'mc-dropdown-label', item).textContent = option.label;
      item.onclick = () => {
        hide();
        if (option.value === current) return;
        current = option.value;
        render();
        onChange(current);
      };
    }
    placePopup(popup, host, button);
    button.classList.add('is-open');
    const stop = dismissible(popup, button, () => hide());
    function hide() {
      stop();
      popup.remove();
      button.classList.remove('is-open');
      close = null;
    }
    close = hide;
    (popup.querySelector('.is-on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  };
  return { button, get: () => current, set: (next) => { current = next; render(); } };
}

const dashArrays: Record<string, string> = { solid: '', dashed: '6 4', dotted: '1 3' };

// A short horizontal line in the given style and width, for line style and thickness choices.
export function lineSample(lineStyle: string, width = 1): (into: HTMLElement) => void {
  return (into) => {
    const sample = element('span', 'mc-line-sample', into);
    const dash = dashArrays[lineStyle] ?? '';
    sample.innerHTML = `<svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true"><path d="M1 5h32" stroke="currentColor" stroke-width="${width}" stroke-linecap="${lineStyle === 'dotted' ? 'round' : 'butt'}"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  };
}
