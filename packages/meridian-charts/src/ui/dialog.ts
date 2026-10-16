import { dismissible, openColorPicker, paintSwatch, placePopup, type ColorPick } from './color-picker';
import { dropdown, lineSample, type DropdownOption } from './dropdown';
import { iconSvg } from './icons';
import { element } from './styles';

export interface LevelValue {
  value: number;
  color: string;
  isVisible: boolean;
  text?: string;
}

// A value edited inside another field's control: a colour's opacity or a line's thickness.
export interface LinkedValue {
  key: string;
  value: number;
}

// Fields that share a `row` are laid out on one line under the first one's label, as TradingView
// puts a line's colour and style side by side. A checkbox that leads a row carries the label.
type FieldBase = { key: string; label: string; tab?: string; row?: string };

export type Field = FieldBase & (
  | { type: 'number'; value: number; min?: number; max?: number; step?: number; options?: readonly number[] }
  | { type: 'checkbox'; value: boolean; look?: 'bold' | 'italic' }
  | { type: 'select'; value: string; options: readonly string[] }
  | { type: 'color'; value: string; opacity?: LinkedValue; thickness?: LinkedValue }
  | { type: 'line-style'; value: string }
  | { type: 'text'; value: string; isMultiline?: boolean }
  // Epoch milliseconds, edited as a UTC date and time.
  | { type: 'datetime'; value: number }
  | { type: 'levels'; value: readonly LevelValue[] }
  | { type: 'range'; value: readonly [number, number]; min: number; max: number }
);

export type FieldValue = number | string | boolean | LevelValue[] | [number, number];
export type FieldValues = Record<string, FieldValue>;

export interface DialogTemplate {
  label: string;
  values: FieldValues;
}

// Saving and removing named templates from the Template menu.
export interface TemplateActions {
  save: (name: string, values: FieldValues) => void;
  remove?: (name: string) => void;
}

export interface DialogOptions {
  title: string;
  fields: Field[];
  focus?: string;
  // Shown above the fields; a dialog with only a message is a confirmation.
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  onApply: (values: FieldValues) => void;
  // Called on every edit while the dialog is open, so the change shows at once.
  onChange?: (values: FieldValues) => void;
  // Called when the dialog closes without Ok, so live changes can be undone.
  onCancel?: () => void;
  onDefaults?: () => FieldValues;
  templates?: () => readonly DialogTemplate[];
  templateActions?: TemplateActions;
}

// Every value a form starts with, including those linked into another field's control.
export function fieldValues(fields: readonly Field[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    values[field.key] = (field.type === 'range' ? [...field.value] : field.type === 'levels' ? [...field.value] : field.value) as FieldValue;
    if (field.type === 'color' && field.opacity) values[field.opacity.key] = field.opacity.value;
    if (field.type === 'color' && field.thickness) values[field.thickness.key] = field.thickness.value;
  }
  return values;
}

const pad = (value: number) => String(value).padStart(2, '0');

function toLocalInput(time: number): string {
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const lineStyles = ['solid', 'dashed', 'dotted'];

interface Control {
  read: () => FieldValue;
  write: (value: FieldValue) => void;
  focus: () => void;
}

function checkbox(parent: HTMLElement, isChecked: boolean, label: string): HTMLInputElement {
  const input = element('input', 'mc-check', parent);
  input.type = 'checkbox';
  input.checked = isChecked;
  input.setAttribute('aria-label', label);
  return input;
}

// A swatch button that opens the colour picker; linked opacity and thickness live in the picker.
function colorControl(parent: HTMLElement, host: HTMLElement, field: Extract<Field, { type: 'color' }>, label: string, changed: () => void, controls: Map<string, Control>): Control {
  const pick: ColorPick = { color: field.value, ...(field.opacity ? { opacity: field.opacity.value } : {}), ...(field.thickness ? { thickness: field.thickness.value } : {}) };
  const button = element('button', 'mc-color', parent);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const face = element('span', 'mc-swatch-face', button);
  const paint = () => paintSwatch(face, pick.color, pick.opacity ?? 100);
  paint();
  let close: (() => void) | null = null;
  button.onclick = () => {
    if (close) { close(); return; }
    button.classList.add('is-open');
    close = openColorPicker(host, button, pick, (next) => {
      Object.assign(pick, next);
      paint();
      changed();
    }, () => { close = null; button.classList.remove('is-open'); });
  };
  if (field.opacity) controls.set(field.opacity.key, { read: () => pick.opacity ?? 100, write: (value) => { pick.opacity = Number(value); paint(); }, focus: () => button.focus() });
  if (field.thickness) controls.set(field.thickness.key, { read: () => pick.thickness ?? 1, write: (value) => { pick.thickness = Number(value); }, focus: () => button.focus() });
  return { read: () => pick.color, write: (value) => { pick.color = String(value); paint(); }, focus: () => button.focus() };
}

function levelsEditor(parent: HTMLElement, host: HTMLElement, levels: readonly LevelValue[], changed: () => void): Control {
  const list = element('div', 'mc-levels', parent);
  let rows: { visible: HTMLInputElement; value: HTMLInputElement; color: Control; text: HTMLInputElement }[] = [];
  const render = (values: readonly LevelValue[]) => {
    list.replaceChildren();
    rows = values.map((level) => {
      const row = element('div', 'mc-level', list);
      const visible = checkbox(row, level.isVisible, 'Show level');
      const value = element('input', 'mc-input', row);
      value.type = 'number';
      value.step = 'any';
      value.value = String(level.value);
      value.setAttribute('aria-label', 'Level');
      const color = colorControl(row, host, { key: '', label: '', type: 'color', value: /^#[0-9a-f]{6}$/i.test(level.color) ? level.color : '#787b86' }, 'Level color', changed, new Map());
      const text = element('input', 'mc-input mc-level-text', row);
      text.type = 'text';
      text.value = level.text ?? '';
      text.placeholder = 'Text';
      text.setAttribute('aria-label', 'Level text');
      return { visible, value, color, text };
    });
  };
  render(levels);
  return {
    read: () => rows.map((row) => ({ value: Number(row.value.value) || 0, color: String(row.color.read()), isVisible: row.visible.checked, ...(row.text.value.trim() ? { text: row.text.value.trim() } : {}) })),
    write: (value) => render(value as LevelValue[]),
    focus: () => rows[0]?.value.focus(),
  };
}

// Two thumbs on one track with the numbers at either end, as in TradingView's Visibility tab.
function rangeControl(parent: HTMLElement, field: Extract<Field, { type: 'range' }>, label: string, changed: () => void): Control {
  const box = element('div', 'mc-range', parent);
  const from = element('input', 'mc-input mc-range-value', box);
  const track = element('div', 'mc-range-track', box);
  const to = element('input', 'mc-input mc-range-value', box);
  const low = element('input', undefined, track);
  const high = element('input', undefined, track);
  for (const input of [from, to]) {
    input.type = 'number';
    input.min = String(field.min);
    input.max = String(field.max);
  }
  for (const input of [low, high]) {
    input.type = 'range';
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = '1';
  }
  from.setAttribute('aria-label', `${label} from`);
  to.setAttribute('aria-label', `${label} to`);
  low.setAttribute('aria-label', `${label} from`);
  high.setAttribute('aria-label', `${label} to`);
  let value: [number, number] = [field.value[0], field.value[1]];
  const clampValue = (number: number) => Math.max(field.min, Math.min(field.max, Math.round(number)));
  const show = () => {
    from.value = low.value = String(value[0]);
    to.value = high.value = String(value[1]);
    const span = field.max - field.min || 1;
    track.style.setProperty('--mc-from', `${(value[0] - field.min) / span * 100}%`);
    track.style.setProperty('--mc-to', `${(value[1] - field.min) / span * 100}%`);
  };
  const set = (next: [number, number]) => {
    value = [clampValue(Math.min(next[0], next[1])), clampValue(Math.max(next[0], next[1]))];
    show();
    changed();
  };
  low.oninput = () => set([Math.min(Number(low.value), value[1]), value[1]]);
  high.oninput = () => set([value[0], Math.max(Number(high.value), value[0])]);
  from.onchange = () => set([Number(from.value) || field.min, value[1]]);
  to.onchange = () => set([value[0], Number(to.value) || field.max]);
  show();
  return { read: () => [...value] as [number, number], write: (next) => { value = [...(next as [number, number])]; show(); }, focus: () => from.focus() };
}

function rowsOf(fields: readonly Field[]): Field[][] {
  const rows: Field[][] = [];
  for (const field of fields) {
    const last = rows[rows.length - 1];
    if (field.row && last && last[0].row === field.row) last.push(field);
    else rows.push([field]);
  }
  return rows;
}

// A TradingView property dialog inside the chart: title, tabs, rows of controls, the Template menu
// and Cancel/Ok. Edits can apply live through `onChange`; closing without Ok calls `onCancel`.
// Returns a function that closes it as Cancel would.
export function openDialog(host: HTMLElement, options: DialogOptions): () => void {
  const backdrop = element('div', 'mc-dialog-backdrop', host);
  const dialog = element('div', 'mc-dialog', backdrop);
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', options.title);
  const head = element('div', 'mc-dialog-head', dialog);
  element('span', 'mc-dialog-title', head).textContent = options.title;
  const closeButton = element('button', 'mc-dialog-close', head);
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.innerHTML = iconSvg('close', 24);
  const tabs = [...new Set(options.fields.map((field) => field.tab ?? 'Settings'))];
  const tabBar = tabs.length > 1 ? element('div', 'mc-dialog-tabs', dialog) : null;
  tabBar?.setAttribute('role', 'tablist');
  const content = element('div', 'mc-dialog-content', dialog);
  if (options.message) element('p', 'mc-dialog-message', content).textContent = options.message;
  const bodies = new Map<string, HTMLElement>();
  for (const tab of tabs) {
    if (!options.fields.length) break;
    const body = element('div', 'mc-dialog-body', content);
    body.hidden = tab !== tabs[0];
    bodies.set(tab, body);
    if (tabBar) {
      const button = element('button', `mc-dialog-tab${tab === tabs[0] ? ' is-active' : ''}`, tabBar);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.textContent = tab;
      button.onclick = () => {
        for (const [name, panel] of bodies) panel.hidden = name !== tab;
        for (const node of tabBar.children) node.classList.toggle('is-active', node === button);
      };
    }
  }
  const controls = new Map<string, Control>();
  const read = (): FieldValues => Object.fromEntries([...controls].map(([key, control]) => [key, control.read()]));
  let isFilling = false;
  const changed = () => { if (!isFilling) options.onChange?.(read()); };
  for (const row of options.fields.length ? tabs.flatMap((tab) => rowsOf(options.fields.filter((field) => (field.tab ?? 'Settings') === tab))) : []) {
    const body = bodies.get(row[0].tab ?? 'Settings')!;
    const first = row[0];
    if (first.type === 'levels') {
      controls.set(first.key, levelsEditor(body, backdrop, first.value, changed));
      continue;
    }
    if (first.type === 'text' && first.isMultiline) {
      const area = element('textarea', 'mc-input mc-textarea', body);
      area.value = first.value;
      area.setAttribute('aria-label', first.label);
      controls.set(first.key, { read: () => area.value, write: (value) => { area.value = String(value); }, focus: () => { area.focus(); area.select(); } });
      continue;
    }
    const line = element('div', 'mc-row', body);
    const isLeadingCheck = first.type === 'checkbox' && !first.look;
    let rest = row;
    if (isLeadingCheck) {
      const label = element('label', 'mc-row-label', line);
      const input = checkbox(label, first.value as boolean, first.label);
      input.removeAttribute('aria-label');
      element('span', undefined, label).textContent = first.label;
      controls.set(first.key, { read: () => input.checked, write: (value) => { input.checked = value === true; }, focus: () => input.focus() });
      rest = row.slice(1);
    } else if (first.label) {
      element('span', 'mc-row-label', line).textContent = first.label;
    }
    if (!rest.length) { line.classList.add('is-check'); continue; }
    const cell = element('div', 'mc-row-controls', line);
    if (!first.label && !isLeadingCheck) line.classList.add('is-bare');
    for (const field of rest) {
      const label = field.label || first.label;
      if (field.type === 'color') {
        controls.set(field.key, colorControl(cell, backdrop, field, label, changed, controls));
      } else if (field.type === 'line-style') {
        const choices: DropdownOption[] = lineStyles.map((style) => ({ value: style, label: '', sample: lineSample(style, 1) }));
        const box = dropdown(cell, backdrop, choices, field.value, label, changed);
        controls.set(field.key, { read: box.get, write: (value) => box.set(String(value)), focus: () => box.button.focus() });
      } else if (field.type === 'select') {
        const box = dropdown(cell, backdrop, field.options.map((option) => ({ value: option, label: titleCase(option) })), field.value, label, changed);
        controls.set(field.key, { read: box.get, write: (value) => box.set(String(value)), focus: () => box.button.focus() });
      } else if (field.type === 'number' && field.options) {
        const box = dropdown(cell, backdrop, field.options.map((option) => ({ value: String(option), label: String(option) })), String(field.value), label, changed);
        controls.set(field.key, { read: () => Number(box.get()), write: (value) => box.set(String(value)), focus: () => box.button.focus() });
      } else if (field.type === 'checkbox') {
        const toggle = element('button', `mc-toggle is-${field.look ?? 'plain'}${field.value ? ' is-on' : ''}`, cell);
        toggle.type = 'button';
        toggle.textContent = field.look === 'bold' ? 'B' : field.look === 'italic' ? 'I' : field.label;
        toggle.setAttribute('aria-label', field.label);
        toggle.setAttribute('aria-pressed', String(field.value));
        const set = (isOn: boolean) => { toggle.classList.toggle('is-on', isOn); toggle.setAttribute('aria-pressed', String(isOn)); };
        toggle.onclick = () => { set(!toggle.classList.contains('is-on')); changed(); };
        controls.set(field.key, { read: () => toggle.classList.contains('is-on'), write: (value) => set(value === true), focus: () => toggle.focus() });
      } else if (field.type === 'range') {
        controls.set(field.key, rangeControl(cell, field, label, changed));
      } else if (field.type === 'number') {
        const input = element('input', 'mc-input mc-number', cell);
        input.type = 'number';
        input.value = String(field.value);
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = String(field.step ?? 'any');
        input.setAttribute('aria-label', label);
        controls.set(field.key, {
          read: () => {
            const value = Number(input.value);
            return input.value !== '' && Number.isFinite(value) ? Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value)) : field.value;
          },
          write: (value) => { input.value = String(value); },
          focus: () => { input.focus(); input.select(); },
        });
      } else if (field.type === 'datetime') {
        const input = element('input', 'mc-input mc-datetime', cell);
        input.type = 'datetime-local';
        input.step = '1';
        input.value = toLocalInput(field.value);
        input.setAttribute('aria-label', `${label} (UTC)`);
        controls.set(field.key, {
          read: () => (input.value ? Date.parse(`${input.value}Z`) : field.value),
          write: (value) => { input.value = toLocalInput(Number(value)); },
          focus: () => input.focus(),
        });
      } else if (field.type === 'text') {
        const input = element('input', 'mc-input', cell);
        input.type = 'text';
        input.value = field.value;
        input.setAttribute('aria-label', label);
        controls.set(field.key, { read: () => input.value, write: (value) => { input.value = String(value); }, focus: () => { input.focus(); input.select(); } });
      }
    }
  }
  // Native inputs report through these; custom controls call `changed` themselves.
  content.addEventListener('input', changed);
  content.addEventListener('change', changed);

  const foot = element('div', 'mc-dialog-foot', dialog);
  const fill = (values: FieldValues) => {
    isFilling = true;
    for (const [key, value] of Object.entries(values)) controls.get(key)?.write(value);
    isFilling = false;
    changed();
  };
  let isClosed = false;
  const close = () => {
    if (isClosed) return;
    isClosed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const cancel = () => {
    if (isClosed) return;
    close();
    options.onCancel?.();
  };
  if (options.templates) {
    const template = element('button', 'mc-template-button', foot);
    template.type = 'button';
    template.setAttribute('aria-haspopup', 'menu');
    element('span', undefined, template).textContent = 'Template';
    element('span', 'mc-dropdown-chevron', template).innerHTML = iconSvg('chevron-down', 18);
    let hideList: (() => void) | null = null;
    template.onclick = () => {
      if (hideList) { hideList(); return; }
      const entries = options.templates!();
      const actions = options.templateActions;
      hideList = openTemplateList(backdrop, template, {
        names: entries.map((entry) => entry.label),
        apply: (name) => { const entry = entries.find((candidate) => candidate.label === name); if (entry) fill(entry.values); },
        ...(options.onDefaults ? { applyDefault: () => fill(options.onDefaults!()) } : {}),
        ...(actions ? { saveAs: () => askTemplateName(host, entries.map((entry) => entry.label), (name) => actions.save(name, read())) } : {}),
        ...(actions?.remove ? { remove: (name: string) => confirmRemove(host, name, () => actions.remove!(name)) } : {}),
      }, () => { hideList = null; template.classList.remove('is-open'); });
      template.classList.add('is-open');
    };
  } else if (options.onDefaults) {
    const defaults = element('button', undefined, foot);
    defaults.type = 'button';
    defaults.textContent = 'Defaults';
    defaults.onclick = () => fill(options.onDefaults!());
  }
  element('span', 'mc-spacer', foot);
  const cancelButton = element('button', undefined, foot);
  cancelButton.type = 'button';
  cancelButton.textContent = options.cancelLabel ?? 'Cancel';
  cancelButton.onclick = cancel;
  closeButton.onclick = cancel;
  const ok = element('button', 'is-primary', foot);
  ok.type = 'button';
  ok.textContent = options.okLabel ?? 'Ok';
  ok.onclick = () => {
    const values = read();
    close();
    options.onApply(values);
  };
  const onKey = (event: KeyboardEvent) => {
    // A dialog opened from this one (naming a template) takes the keys while it is open, and an
    // open list or colour picker takes Escape.
    const open = host.querySelectorAll('.mc-dialog-backdrop');
    if (open[open.length - 1] !== backdrop) return;
    if (backdrop.querySelector('.mc-dropdown-list, .mc-color-picker, .mc-template-list')) return;
    if (event.key === 'Escape') { event.stopPropagation(); cancel(); }
    else if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); event.stopPropagation(); ok.click(); }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('wheel', (event) => event.stopPropagation());
  backdrop.addEventListener('contextmenu', (event) => event.preventDefault());
  place(backdrop, dialog);
  draggable(head, backdrop, dialog);
  const focusField = options.focus ? options.fields.find((field) => field.key === options.focus) : undefined;
  if (focusField && tabBar) {
    const index = tabs.indexOf(focusField.tab ?? 'Settings');
    (tabBar.children[index] as HTMLButtonElement | undefined)?.click();
  }
  setTimeout(() => (focusField ? controls.get(focusField.key)?.focus() : ok.focus()));
  return cancel;
}

function place(backdrop: HTMLElement, dialog: HTMLElement): void {
  const box = backdrop.getBoundingClientRect();
  dialog.style.left = `${Math.max(8, (box.width - dialog.offsetWidth) / 2)}px`;
  dialog.style.top = `${Math.max(8, (box.height - dialog.offsetHeight) / 2)}px`;
}

// Moves the dialog by its title bar, keeping the bar inside the chart.
function draggable(handle: HTMLElement, backdrop: HTMLElement, dialog: HTMLElement): void {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const box = backdrop.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: dialog.offsetLeft, top: dialog.offsetTop };
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const left = Math.max(0, Math.min(box.width - dialog.offsetWidth, start.left + moveEvent.clientX - start.x));
      const top = Math.max(0, Math.min(box.height - handle.offsetHeight, start.top + moveEvent.clientY - start.y));
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

export interface TemplateListActions {
  names: readonly string[];
  apply: (name: string) => void;
  applyDefault?: () => void;
  saveAs?: () => void;
  remove?: (name: string) => void;
}

// TradingView's template list: Save as and Apply default, then the saved templates, each with a
// remove button on hover. Used by the settings dialog and the floating toolbar.
export function openTemplateList(host: HTMLElement, anchor: HTMLElement, actions: TemplateListActions, onClose?: () => void, labels: { saveAs: string; applyDefault: string } = { saveAs: 'Save as…', applyDefault: 'Apply default' }): () => void {
  const popup = element('div', 'mc-template-list', host);
  popup.setAttribute('role', 'menu');
  popup.addEventListener('pointerdown', (event) => event.stopPropagation());
  const item = (label: string, action: () => void) => {
    const button = element('button', 'mc-dropdown-item', popup);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    element('span', 'mc-dropdown-label', button).textContent = label;
    button.onclick = () => { close(); action(); };
    return button;
  };
  if (actions.saveAs) item(labels.saveAs, actions.saveAs);
  if (actions.applyDefault) item(labels.applyDefault, actions.applyDefault);
  if (actions.names.length && popup.children.length) element('div', 'mc-menu-sep', popup);
  for (const name of actions.names) {
    const button = item(name, () => actions.apply(name));
    if (!actions.remove) continue;
    const remove = element('span', 'mc-template-remove', button);
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', `Remove template ${name}`);
    remove.title = 'Remove';
    remove.innerHTML = iconSvg('close', 18);
    remove.onclick = (event) => { event.stopPropagation(); close(); actions.remove!(name); };
  }
  if (!popup.children.length) element('div', 'mc-template-empty', popup).textContent = 'No templates';
  placePopup(popup, host, anchor);
  const stop = dismissible(popup, anchor, () => close());
  function close() {
    stop();
    popup.remove();
    onClose?.();
  }
  return close;
}

// The "Save drawing template as" dialog; an existing name asks before it is replaced.
export function askTemplateName(host: HTMLElement, names: readonly string[], save: (name: string) => void): void {
  openDialog(host, {
    title: 'Save drawing template as',
    fields: [{ key: 'name', label: 'Template name', type: 'text', value: '' }],
    focus: 'name',
    okLabel: 'Save',
    onApply: (values) => {
      const name = String(values.name).trim();
      if (!name) return;
      if (!names.includes(name)) { save(name); return; }
      openDialog(host, { title: 'Confirm replace', message: `Drawing template '${name}' already exists. Do you really want to replace it?`, fields: [], okLabel: 'Yes', cancelLabel: 'No', onApply: () => save(name) });
    },
  });
}

export function confirmRemove(host: HTMLElement, name: string, remove: () => void): void {
  openDialog(host, { title: 'Confirm remove', message: `Do you really want to delete drawing template '${name}'?`, fields: [], okLabel: 'Yes', cancelLabel: 'No', onApply: remove });
}
