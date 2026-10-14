import { element } from './styles';

export interface LevelValue {
  value: number;
  color: string;
  isVisible: boolean;
}

type FieldBase = { key: string; label: string; tab?: string };

export type Field = FieldBase & (
  | { type: 'number'; value: number; min?: number; max?: number; step?: number }
  | { type: 'checkbox'; value: boolean }
  | { type: 'select'; value: string; options: readonly string[] }
  | { type: 'color'; value: string }
  | { type: 'text'; value: string; isMultiline?: boolean }
  // Epoch milliseconds, edited as a UTC date and time.
  | { type: 'datetime'; value: number }
  | { type: 'levels'; value: readonly LevelValue[] }
);

export type FieldValue = number | string | boolean | LevelValue[];
export type FieldValues = Record<string, FieldValue>;

const pad = (value: number) => String(value).padStart(2, '0');

function toLocalInput(time: number): string {
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

interface Control {
  read: () => FieldValue;
  write: (value: FieldValue) => void;
  focus: () => void;
}

function levelsEditor(parent: HTMLElement, levels: readonly LevelValue[]): Control {
  const list = element('div', 'mc-levels', parent);
  let rows: { visible: HTMLInputElement; value: HTMLInputElement; color: HTMLInputElement }[] = [];
  const render = (values: readonly LevelValue[]) => {
    list.replaceChildren();
    rows = values.map((level) => {
      const row = element('div', 'mc-level', list);
      const visible = element('input', undefined, row);
      visible.type = 'checkbox';
      visible.checked = level.isVisible;
      visible.setAttribute('aria-label', 'Show level');
      const value = element('input', undefined, row);
      value.type = 'number';
      value.step = 'any';
      value.value = String(level.value);
      value.setAttribute('aria-label', 'Level');
      const color = element('input', undefined, row);
      color.type = 'color';
      color.value = /^#[0-9a-f]{6}$/i.test(level.color) ? level.color : '#787b86';
      color.setAttribute('aria-label', 'Level colour');
      return { visible, value, color };
    });
  };
  render(levels);
  return {
    read: () => rows.map((row) => ({ value: Number(row.value.value) || 0, color: row.color.value, isVisible: row.visible.checked })),
    write: (value) => render(value as LevelValue[]),
    focus: () => rows[0]?.value.focus(),
  };
}

// A modal settings form inside the chart, optionally split into tabs. `onApply` receives every
// field's value.
export function openDialog(host: HTMLElement, options: { title: string; fields: Field[]; focus?: string; onApply: (values: FieldValues) => void; onDefaults?: () => FieldValues }): () => void {
  const backdrop = element('div', 'mc-dialog-backdrop', host);
  const dialog = element('div', 'mc-dialog', backdrop);
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', options.title);
  const head = element('div', 'mc-dialog-head', dialog);
  head.textContent = options.title;
  const tabs = [...new Set(options.fields.map((field) => field.tab ?? 'Settings'))];
  const tabBar = tabs.length > 1 ? element('div', 'mc-dialog-tabs', dialog) : null;
  const bodies = new Map<string, HTMLElement>();
  for (const tab of tabs) {
    const body = element('div', 'mc-dialog-body', dialog);
    body.hidden = tab !== tabs[0];
    bodies.set(tab, body);
    if (tabBar) {
      const button = element('button', `mc-dialog-tab${tab === tabs[0] ? ' is-active' : ''}`, tabBar);
      button.type = 'button';
      button.textContent = tab;
      button.onclick = () => {
        for (const [name, panel] of bodies) panel.hidden = name !== tab;
        for (const node of tabBar.children) node.classList.toggle('is-active', node === button);
      };
    }
  }
  const controls = new Map<string, Control>();
  for (const field of options.fields) {
    const body = bodies.get(field.tab ?? 'Settings')!;
    const label = element('label', undefined, body);
    label.textContent = field.label;
    const id = `mc-field-${field.key}-${Math.random().toString(36).slice(2, 7)}`;
    if (field.type === 'levels') {
      label.className = 'mc-span';
      const holder = element('div', 'mc-span', body);
      controls.set(field.key, levelsEditor(holder, field.value));
      continue;
    }
    if (field.type === 'select') {
      const select = element('select', undefined, body);
      for (const option of field.options) {
        const node = element('option', undefined, select);
        node.value = option;
        node.textContent = option;
      }
      select.value = field.value;
      select.id = label.htmlFor = id;
      controls.set(field.key, { read: () => select.value, write: (value) => { select.value = String(value); }, focus: () => select.focus() });
      continue;
    }
    if (field.type === 'text' && field.isMultiline) {
      const area = element('textarea', undefined, body);
      area.value = field.value;
      area.id = label.htmlFor = id;
      controls.set(field.key, { read: () => area.value, write: (value) => { area.value = String(value); }, focus: () => { area.focus(); area.select(); } });
      continue;
    }
    const input = element('input', undefined, body);
    input.id = label.htmlFor = id;
    if (field.type === 'checkbox') {
      input.type = 'checkbox';
      input.checked = field.value;
      controls.set(field.key, { read: () => input.checked, write: (value) => { input.checked = value === true; }, focus: () => input.focus() });
    } else if (field.type === 'number') {
      input.type = 'number';
      input.value = String(field.value);
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.step = String(field.step ?? 'any');
      controls.set(field.key, {
        read: () => {
          const value = Number(input.value);
          return Number.isFinite(value) ? Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value)) : field.value;
        },
        write: (value) => { input.value = String(value); },
        focus: () => { input.focus(); input.select(); },
      });
    } else if (field.type === 'datetime') {
      input.type = 'datetime-local';
      input.step = '1';
      input.value = toLocalInput(field.value);
      controls.set(field.key, {
        read: () => (input.value ? Date.parse(`${input.value}Z`) : field.value),
        write: (value) => { input.value = toLocalInput(Number(value)); },
        focus: () => input.focus(),
      });
    } else {
      input.type = field.type;
      input.value = field.value;
      controls.set(field.key, { read: () => input.value, write: (value) => { input.value = String(value); }, focus: () => { input.focus(); input.select(); } });
    }
  }
  const foot = element('div', 'mc-dialog-foot', dialog);
  const read = (): FieldValues => Object.fromEntries(options.fields.map((field) => [field.key, controls.get(field.key)!.read()]));
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  if (options.onDefaults) {
    const defaults = element('button', undefined, foot);
    defaults.type = 'button';
    defaults.textContent = 'Defaults';
    defaults.onclick = () => {
      for (const [key, value] of Object.entries(options.onDefaults!())) controls.get(key)?.write(value);
    };
    element('span', 'mc-spacer', foot);
  }
  const cancel = element('button', undefined, foot);
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.onclick = close;
  const ok = element('button', 'is-primary', foot);
  ok.type = 'button';
  ok.textContent = 'Ok';
  ok.onclick = () => {
    options.onApply(read());
    close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); event.stopPropagation(); ok.click(); }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) close(); });
  backdrop.addEventListener('wheel', (event) => event.stopPropagation());
  const focusField = options.focus ? options.fields.find((field) => field.key === options.focus) : undefined;
  if (focusField && tabBar) {
    const index = tabs.indexOf(focusField.tab ?? 'Settings');
    (tabBar.children[index] as HTMLButtonElement | undefined)?.click();
  }
  setTimeout(() => (focusField ? controls.get(focusField.key)!.focus() : ok.focus()));
  return close;
}
