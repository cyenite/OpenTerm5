import { cursorTools, drawingToolInfo, toolGroups, type ToolGroup } from '../drawings/catalogue';
import { iconSvg } from './icons';
import { element } from './styles';

export type CursorMode = 'cross' | 'dot' | 'arrow-cursor' | 'eraser';
export type MagnetMode = 'off' | 'weak' | 'strong';

export interface ToolbarState {
  tool: string | null;
  cursor: CursorMode;
  magnet: MagnetMode;
  isStayMode: boolean;
  isLocked: boolean;
  isHidden: boolean;
  favorites: readonly string[];
  isObjectTreeShown: boolean;
}

export interface ToolbarActions {
  selectTool: (type: string | null) => void;
  selectCursor: (mode: CursorMode) => void;
  setMagnet: (mode: MagnetMode) => void;
  toggleStayMode: () => void;
  toggleLock: () => void;
  toggleHidden: () => void;
  toggleFavorite: (type: string) => void;
  removeDrawings: () => void;
  removeStudies: () => void;
  toggleObjectTree: () => void;
}

const MEASURE = 'measure';
const ZOOM = 'zoom-in';

// The drawing toolbar down the left of the chart. Each group button shows the tool last used
// from it; its arrow opens the group's flyout, split into sections, where tools can be starred
// into the favourites bar.
export class DrawingToolbar {
  readonly element: HTMLElement;
  private readonly lastUsed = new Map<string, string>(toolGroups.map((group) => [group.id, group.sections[0].tools[0].type]));
  private flyout: HTMLElement | null = null;
  private openArrow: HTMLElement | null = null;
  private state: ToolbarState;
  private readonly favoritesBar: HTMLElement;

  constructor(host: HTMLElement, private readonly overlayHost: HTMLElement, private readonly actions: ToolbarActions, state: ToolbarState) {
    this.state = state;
    this.element = element('div', 'mc-rail', host);
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-orientation', 'vertical');
    this.element.setAttribute('aria-label', 'Drawing tools');
    this.favoritesBar = element('div', 'mc-favorites', overlayHost);
    this.favoritesBar.setAttribute('role', 'toolbar');
    this.favoritesBar.setAttribute('aria-label', 'Favorite drawing tools');
    document.addEventListener('pointerdown', this.onOutside, true);
    this.render();
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.closeFlyout();
    this.element.remove();
    this.favoritesBar.remove();
  }

  update(state: ToolbarState): void {
    this.state = state;
    const group = state.tool ? drawingToolInfo.get(state.tool)?.groupId : undefined;
    if (group && state.tool) this.lastUsed.set(group, state.tool);
    this.render();
  }

  setVisible(isVisible: boolean): void {
    this.element.style.display = isVisible ? '' : 'none';
    this.favoritesBar.style.display = isVisible && this.state.favorites.length ? '' : 'none';
    if (!isVisible) this.closeFlyout();
  }

  get isVisible(): boolean {
    return this.element.style.display !== 'none';
  }

  private onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (this.flyout && !this.flyout.contains(target) && !this.openArrow?.contains(target)) this.closeFlyout();
  };

  private button(parent: HTMLElement, icon: string, title: string, isActive: boolean, onClick: () => void): HTMLButtonElement {
    const button = element('button', `mc-btn${isActive ? ' is-active' : ''}`, parent);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-pressed', String(isActive));
    button.innerHTML = iconSvg(icon);
    button.onclick = onClick;
    return button;
  }

  // A rail button with a flyout arrow beside it.
  private cell(icon: string, title: string, isActive: boolean, onClick: () => void, openFlyout: (anchor: HTMLElement) => void): void {
    const cell = element('div', 'mc-cell', this.element);
    this.button(cell, icon, title, isActive, onClick);
    const arrow = element('button', 'mc-arrow', cell);
    arrow.type = 'button';
    arrow.setAttribute('aria-label', `${title}: more`);
    arrow.setAttribute('aria-haspopup', 'menu');
    arrow.innerHTML = iconSvg('chevron-right', 10);
    arrow.onclick = (event) => {
      event.stopPropagation();
      if (this.openArrow === arrow) { this.closeFlyout(); return; }
      this.closeFlyout();
      this.openArrow = arrow;
      arrow.classList.add('is-open');
      openFlyout(cell);
    };
  }

  private render(): void {
    const { state } = this;
    this.element.replaceChildren();
    const cursorTitle = cursorTools.find((tool) => tool.type === state.cursor)?.label ?? 'Cross';
    this.cell(state.cursor, cursorTitle, state.tool === null, () => this.actions.selectTool(null), (anchor) => this.openMenu(anchor, [{ title: 'Cursors', tools: cursorTools }], (type) => this.actions.selectCursor(type as CursorMode), state.tool === null ? state.cursor : null, false));
    element('div', 'mc-rail-sep', this.element);
    for (const group of toolGroups) this.groupCell(group);
    element('div', 'mc-rail-sep', this.element);
    this.button(this.element, MEASURE, 'Measure', state.tool === MEASURE, () => this.actions.selectTool(state.tool === MEASURE ? null : MEASURE));
    this.button(this.element, ZOOM, 'Zoom In', state.tool === ZOOM, () => this.actions.selectTool(state.tool === ZOOM ? null : ZOOM));
    element('div', 'mc-rail-sep', this.element);
    const magnetIcon = state.magnet === 'strong' ? 'magnet-strong' : 'magnet-weak';
    this.cell(magnetIcon, state.magnet === 'off' ? 'Magnet' : state.magnet === 'weak' ? 'Weak Magnet' : 'Strong Magnet', state.magnet !== 'off', () => this.actions.setMagnet(state.magnet === 'off' ? 'weak' : 'off'), (anchor) => this.openMenu(anchor, [{ title: 'Magnet', tools: [{ type: 'magnet-weak', label: 'Weak Magnet' }, { type: 'magnet-strong', label: 'Strong Magnet' }] }], (type) => this.actions.setMagnet(type === 'magnet-strong' ? 'strong' : 'weak'), state.magnet === 'off' ? null : `magnet-${state.magnet}`, false));
    this.button(this.element, 'stay-in-drawing-mode', 'Stay in Drawing Mode', state.isStayMode, this.actions.toggleStayMode);
    this.button(this.element, state.isLocked ? 'lock-all' : 'unlock', state.isLocked ? 'Unlock All Drawings' : 'Lock All Drawings', state.isLocked, this.actions.toggleLock);
    this.button(this.element, state.isHidden ? 'eye-off' : 'eye', state.isHidden ? 'Show All Drawings' : 'Hide All Drawings', state.isHidden, this.actions.toggleHidden);
    this.cell('remove-all', 'Remove Drawings', false, this.actions.removeDrawings, (anchor) => this.openActions(anchor));
    element('div', 'mc-rail-spacer', this.element);
    this.button(this.element, 'object-tree', 'Object Tree', state.isObjectTreeShown, this.actions.toggleObjectTree);
    this.renderFavorites();
  }

  private groupCell(group: ToolGroup): void {
    const current = this.lastUsed.get(group.id)!;
    const label = drawingToolInfo.get(current)?.label ?? group.label;
    const isActive = this.state.tool !== null && drawingToolInfo.get(this.state.tool)?.groupId === group.id;
    this.cell(current, label, isActive, () => this.actions.selectTool(this.state.tool === current ? null : current), (anchor) => this.openMenu(anchor, group.sections, (type) => this.actions.selectTool(type), this.state.tool, true));
  }

  private renderFavorites(): void {
    this.favoritesBar.replaceChildren();
    for (const type of this.state.favorites) {
      const info = drawingToolInfo.get(type);
      if (info) this.button(this.favoritesBar, type, info.label, this.state.tool === type, () => this.actions.selectTool(this.state.tool === type ? null : type));
    }
    this.favoritesBar.style.display = this.state.favorites.length && this.isVisible ? '' : 'none';
  }

  private place(menu: HTMLElement, anchor: HTMLElement): void {
    const hostBox = this.overlayHost.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    menu.style.left = `${box.right - hostBox.left + 4}px`;
    const top = box.top - hostBox.top;
    menu.style.top = `${Math.max(6, Math.min(top, hostBox.height - menu.offsetHeight - 6))}px`;
  }

  private openMenu(anchor: HTMLElement, sections: readonly { title: string; tools: readonly { type: string; label: string }[] }[], onPick: (type: string) => void, active: string | null, canFavorite: boolean): void {
    const menu = element('div', 'mc-flyout', this.overlayHost);
    menu.setAttribute('role', 'menu');
    sections.forEach((section, index) => {
      if (index > 0) element('div', 'mc-flyout-sep', menu);
      const title = element('div', 'mc-flyout-title', menu);
      title.textContent = section.title;
      for (const tool of section.tools) {
        const item = element('button', `mc-item${tool.type === active ? ' is-active' : ''}`, menu);
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('aria-label', tool.label);
        const icon = element('span', 'mc-item-icon', item);
        icon.innerHTML = iconSvg(tool.type);
        const text = element('span', 'mc-item-label', item);
        text.textContent = tool.label;
        if (canFavorite) {
          const isFavorite = this.state.favorites.includes(tool.type);
          const star = element('span', `mc-star${isFavorite ? ' is-on' : ''}`, item);
          star.setAttribute('role', 'button');
          star.setAttribute('aria-label', isFavorite ? 'Remove from favorites' : 'Add to favorites');
          star.innerHTML = iconSvg(isFavorite ? 'favorite-filled' : 'favorite', 20);
          star.onclick = (event) => {
            event.stopPropagation();
            this.actions.toggleFavorite(tool.type);
            const isOn = this.state.favorites.includes(tool.type);
            star.classList.toggle('is-on', isOn);
            star.innerHTML = iconSvg(isOn ? 'favorite-filled' : 'favorite', 20);
          };
        }
        item.onclick = () => {
          this.closeFlyout();
          onPick(tool.type);
        };
      }
    });
    this.flyout = menu;
    this.place(menu, anchor);
  }

  private openActions(anchor: HTMLElement): void {
    const menu = element('div', 'mc-flyout', this.overlayHost);
    menu.setAttribute('role', 'menu');
    const add = (icon: string, label: string, action: () => void) => {
      const item = element('button', 'mc-item', menu);
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      element('span', 'mc-item-icon', item).innerHTML = iconSvg(icon);
      element('span', 'mc-item-label', item).textContent = label;
      item.onclick = () => { this.closeFlyout(); action(); };
    };
    add('remove-all', 'Remove Drawings', this.actions.removeDrawings);
    add('trash', 'Remove Indicators', this.actions.removeStudies);
    add('trash', 'Remove Drawings & Indicators', () => { this.actions.removeDrawings(); this.actions.removeStudies(); });
    this.flyout = menu;
    this.place(menu, anchor);
  }

  private closeFlyout(): void {
    this.flyout?.remove();
    this.flyout = null;
    this.openArrow?.classList.remove('is-open');
    this.openArrow = null;
  }
}
