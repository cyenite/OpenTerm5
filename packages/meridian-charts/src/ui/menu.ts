import { iconSvg } from './icons';
import { element } from './styles';

export interface MenuEntry {
  label: string;
  icon?: string;
  isChecked?: boolean;
  shortcut?: string;
  isDisabled?: boolean;
  action?: () => void;
  isSeparator?: boolean;
}

const separator: MenuEntry = { label: '', isSeparator: true };
export { separator };

// A popup menu inside the chart, closed by a pick, a click elsewhere or Escape.
export function openMenu(host: HTMLElement, x: number, y: number, entries: readonly MenuEntry[]): () => void {
  const menu = element('div', 'mc-menu-popup', host);
  menu.setAttribute('role', 'menu');
  const hasChecks = entries.some((entry) => entry.isChecked !== undefined);
  const hasIcons = entries.some((entry) => entry.icon);
  for (const entry of entries) {
    if (entry.isSeparator) { element('div', 'mc-menu-sep', menu); continue; }
    const item = element('button', 'mc-item', menu);
    item.type = 'button';
    item.setAttribute('role', entry.isChecked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (entry.isChecked !== undefined) item.setAttribute('aria-checked', String(entry.isChecked));
    item.disabled = !!entry.isDisabled;
    if (entry.isDisabled) item.style.opacity = '0.45';
    if (hasChecks) element('span', 'mc-item-check', item).textContent = entry.isChecked ? '✓' : '';
    if (hasIcons) element('span', 'mc-item-icon', item).innerHTML = entry.icon ? iconSvg(entry.icon, 24) : '';
    element('span', 'mc-item-label', item).textContent = entry.label;
    if (entry.shortcut) element('span', 'mc-item-key', item).textContent = entry.shortcut;
    item.onclick = () => { close(); entry.action?.(); };
  }
  const box = host.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, box.width - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, box.height - menu.offsetHeight - 4))}px`;
  const onOutside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close(); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
  return close;
}
