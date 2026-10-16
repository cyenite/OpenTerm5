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
  // Opens beside the entry on hover, as TradingView's Visual order and Template entries do.
  children?: readonly MenuEntry[];
}

const separator: MenuEntry = { label: '', isSeparator: true };
export { separator };

function renderMenu(host: HTMLElement, entries: readonly MenuEntry[], close: () => void, openSub: (item: HTMLElement, children: readonly MenuEntry[]) => void): HTMLElement {
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
    if (entry.children) {
      const children = entry.children;
      item.setAttribute('aria-haspopup', 'menu');
      element('span', 'mc-item-more', item).innerHTML = iconSvg('chevron-right', 18);
      item.addEventListener('pointerenter', () => openSub(item, children));
      item.onclick = () => openSub(item, children);
    } else {
      item.addEventListener('pointerenter', () => openSub(item, []));
      item.onclick = () => { close(); entry.action?.(); };
    }
  }
  return menu;
}

function fit(menu: HTMLElement, host: HTMLElement, x: number, y: number): void {
  const box = host.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, box.width - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, box.height - menu.offsetHeight - 4))}px`;
}

// A popup menu inside the chart, closed by a pick, a click elsewhere or Escape.
export function openMenu(host: HTMLElement, x: number, y: number, entries: readonly MenuEntry[]): () => void {
  let submenu: HTMLElement | null = null;
  let subOwner: HTMLElement | null = null;
  const openSub = (item: HTMLElement, children: readonly MenuEntry[]) => {
    if (subOwner === item) return;
    submenu?.remove();
    subOwner?.classList.remove('is-open');
    submenu = null;
    subOwner = null;
    if (!children.length) return;
    subOwner = item;
    item.classList.add('is-open');
    submenu = renderMenu(host, children, close, () => {});
    const box = host.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    const right = at.right - box.left + 2;
    fit(submenu, host, right + submenu.offsetWidth > box.width - 4 ? at.left - box.left - submenu.offsetWidth - 2 : right, at.top - box.top - 4);
  };
  const menu = renderMenu(host, entries, close, openSub);
  fit(menu, host, x, y);
  const onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!menu.contains(target) && !submenu?.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  function close() {
    menu.remove();
    submenu?.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
  return close;
}
