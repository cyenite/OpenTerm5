import { iconSvg } from './icons';
import { element } from './styles';

export interface TreeItem {
  id: string;
  name: string;
  icon: string;
  isVisible: boolean;
  isLocked?: boolean;
  isSelected?: boolean;
}

export interface ObjectTreeActions {
  close: () => void;
  select: (kind: 'study' | 'drawing', id: string) => void;
  openSettings: (kind: 'study' | 'drawing', id: string) => void;
  toggleVisible: (kind: 'study' | 'drawing', id: string) => void;
  toggleLock: (id: string) => void;
  remove: (kind: 'study' | 'drawing', id: string) => void;
}

// The object tree: every study and drawing on the chart, with visibility, lock and remove.
export class ObjectTree {
  private readonly panel: HTMLElement;
  private readonly list: HTMLElement;

  constructor(host: HTMLElement, private readonly actions: ObjectTreeActions) {
    this.panel = element('div', 'mc-tree', host);
    this.panel.setAttribute('role', 'complementary');
    this.panel.setAttribute('aria-label', 'Object tree');
    this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.panel.addEventListener('wheel', (event) => event.stopPropagation());
    const head = element('div', 'mc-tree-head', this.panel);
    element('span', undefined, head).textContent = 'Object Tree';
    const close = element('button', undefined, head);
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close object tree');
    close.innerHTML = iconSvg('close', 20);
    close.onclick = () => this.actions.close();
    this.list = element('div', 'mc-tree-list', this.panel);
  }

  destroy(): void {
    this.panel.remove();
  }

  update(studies: TreeItem[], drawings: TreeItem[]): void {
    this.list.replaceChildren();
    this.group('Indicators', 'study', studies);
    this.group('Drawings', 'drawing', drawings);
  }

  private group(title: string, kind: 'study' | 'drawing', items: TreeItem[]): void {
    element('div', 'mc-tree-group', this.list).textContent = `${title} (${items.length})`;
    if (!items.length) {
      element('div', 'mc-tree-empty', this.list).textContent = kind === 'study' ? 'No indicators' : 'No drawings';
      return;
    }
    for (const item of items) {
      const row = element('div', `mc-tree-row${item.isSelected ? ' is-selected' : ''}${item.isVisible ? '' : ' is-hidden'}`, this.list);
      row.setAttribute('role', 'treeitem');
      element('span', 'mc-item-icon', row).innerHTML = iconSvg(item.icon, 24);
      element('span', 'mc-tree-name', row).textContent = item.name;
      const actions = element('span', 'mc-tree-actions', row);
      const add = (icon: string, label: string, action: () => void, isOn = false) => {
        const button = element('button', isOn ? 'is-on' : undefined, actions);
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = iconSvg(icon, 18);
        button.onclick = (event) => { event.stopPropagation(); action(); };
      };
      add(item.isVisible ? 'eye' : 'eye-off', item.isVisible ? 'Hide' : 'Show', () => this.actions.toggleVisible(kind, item.id), !item.isVisible);
      if (kind === 'drawing') add(item.isLocked ? 'lock' : 'unlock', item.isLocked ? 'Unlock' : 'Lock', () => this.actions.toggleLock(item.id), !!item.isLocked);
      add('trash', 'Remove', () => this.actions.remove(kind, item.id));
      row.onclick = () => this.actions.select(kind, item.id);
      row.ondblclick = () => this.actions.openSettings(kind, item.id);
    }
  }
}
