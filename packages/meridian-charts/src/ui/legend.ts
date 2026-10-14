import { iconSvg } from './icons';
import { element } from './styles';

export interface LegendValue {
  text: string;
  color: string;
}

export interface LegendEntry {
  id: string;
  title: string;
  values: LegendValue[];
  isHidden: boolean;
}

export interface LegendActions {
  toggle: (id: string) => void;
  settings: (id: string) => void;
  remove: (id: string) => void;
}

// One pane's legend: an optional title row (symbol and OHLC on the price pane) and a row per
// study with hide, settings and remove buttons on hover.
export class Legend {
  readonly element: HTMLElement;
  private signature = '';

  constructor(host: HTMLElement, private readonly actions: LegendActions) {
    this.element = element('div', 'mc-legend', host);
  }

  destroy(): void {
    this.element.remove();
  }

  place(top: number): void {
    this.element.style.top = `${top + 6}px`;
  }

  update(title: { text: string; values: LegendValue[] } | null, entries: LegendEntry[]): void {
    const signature = JSON.stringify([title?.text, title?.values.length, entries.map((entry) => [entry.id, entry.title, entry.isHidden, entry.values.length])]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(title, entries);
    }
    const rows = this.element.children;
    let index = 0;
    if (title) this.fill(rows[index++] as HTMLElement, title.values);
    for (const entry of entries) this.fill(rows[index++] as HTMLElement, entry.values);
  }

  private fill(row: HTMLElement, values: LegendValue[]): void {
    const holder = row.querySelector('.mc-legend-values');
    if (!holder) return;
    values.forEach((value, index) => {
      const span = holder.children[index] as HTMLElement | undefined;
      if (!span) return;
      if (span.textContent !== value.text) span.textContent = value.text;
      span.style.color = value.color;
    });
  }

  private build(title: { text: string; values: LegendValue[] } | null, entries: LegendEntry[]): void {
    this.element.replaceChildren();
    if (title) {
      const row = element('div', 'mc-legend-row is-title', this.element);
      element('span', 'mc-legend-title', row).textContent = title.text;
      const values = element('span', 'mc-legend-values', row);
      for (let index = 0; index < title.values.length; index++) element('span', undefined, values);
    }
    for (const entry of entries) {
      const row = element('div', `mc-legend-row${entry.isHidden ? ' is-hidden' : ''}`, this.element);
      element('span', 'mc-legend-title', row).textContent = entry.title;
      const values = element('span', 'mc-legend-values', row);
      for (let index = 0; index < entry.values.length; index++) element('span', undefined, values);
      const actions = element('span', 'mc-legend-actions', row);
      const add = (icon: string, label: string, action: () => void) => {
        const button = element('button', undefined, actions);
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = iconSvg(icon, 18);
        button.onclick = (event) => { event.stopPropagation(); action(); };
        button.onpointerdown = (event) => event.stopPropagation();
      };
      add(entry.isHidden ? 'eye-off' : 'eye', entry.isHidden ? 'Show' : 'Hide', () => this.actions.toggle(entry.id));
      add('settings', 'Settings', () => this.actions.settings(entry.id));
      add('close', 'Remove', () => this.actions.remove(entry.id));
      row.ondblclick = () => this.actions.settings(entry.id);
    }
  }
}
