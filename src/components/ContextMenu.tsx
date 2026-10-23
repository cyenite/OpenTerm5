import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeContextMenu, contextMenu } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { MenuList } from './MenuBar';
import { SurfacePortal } from './ui/Surface';

export function ContextMenuHost() {
  const menu = useStore(contextMenu, (state) => state.menu);
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!menu) return;
    const close = () => closeContextMenu();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    const { view } = menu;
    view.addEventListener('mousedown', close);
    view.addEventListener('blur', close);
    view.addEventListener('resize', close);
    view.addEventListener('keydown', onKey);
    return () => {
      view.removeEventListener('mousedown', close);
      view.removeEventListener('blur', close);
      view.removeEventListener('resize', close);
      view.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Menus near the right or bottom edge open towards the inside, like native menus.
  useLayoutEffect(() => {
    if (!menu || !element.current) return;
    const { width, height } = element.current.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(menu.x, menu.view.innerWidth - width - 4)),
      top: Math.max(4, menu.y + height > menu.view.innerHeight - 4 ? menu.y - height : menu.y),
    });
  }, [menu]);

  if (!menu) return null;
  return (
    <SurfacePortal view={menu.view}>
      <div ref={element} className="context-menu" style={position} onContextMenu={(event) => event.preventDefault()}>
        <MenuList items={[...menu.items]} onDone={closeContextMenu} />
      </div>
    </SurfacePortal>
  );
}
