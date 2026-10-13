import { useEffect } from 'react';
import { MenuList, type MenuItem } from './MenuBar';

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      <MenuList items={menu.items} onDone={onClose} />
    </div>
  );
}
