import type { ReactNode } from 'react';
import type { MenuItem } from './MenuBar';
import { openContextMenu } from '../lib/context-menu';
import { dockDrag, dockSides, otherSide, panelDataType, type DockPanel } from '../lib/dock';
import { useStore } from '../lib/store';
import { moveDockPanel, workspace } from '../lib/workspace';

interface PanelProps {
  title: string;
  children: ReactNode;
  // A panel that can move between the left and right docks.
  dock?: DockPanel;
  onClose?: () => void;
}

export function Panel({ title, children, dock, onClose }: PanelProps) {
  const side = useStore(workspace, (state) => dock && !state.isAnalysisMode ? state.dock.sides[dock] : null);
  const isMovable = !!dock && !!side;
  const menu = (): MenuItem[] => [
    ...dockSides.map((candidate) => ({ label: candidate.label, isChecked: candidate.key === side, action: () => moveDockPanel(dock!, candidate.key) })),
    ...(onClose ? [{ label: '', isSeparator: true }, { label: 'Close', action: onClose }] : []),
  ];
  return (
    <section className="panel" aria-label={title}>
      <header
        className={`panel-header${isMovable ? ' is-movable' : ''}`}
        draggable={isMovable}
        title={isMovable ? 'Drag to the other side of the charts to move this panel' : undefined}
        onDragStart={(event) => {
          if (!isMovable) return;
          event.dataTransfer.setData(panelDataType, dock!);
          event.dataTransfer.effectAllowed = 'move';
          // Changing the page while the drag starts can cancel it, so the drop targets appear a tick later.
          setTimeout(() => dockDrag.set({ panel: dock! }));
        }}
        onDragEnd={() => dockDrag.set({ panel: null })}
        onContextMenu={isMovable ? (event) => openContextMenu(event, menu()) : undefined}
      >
        <span>{title}</span>
        <span className="panel-actions">
          {isMovable && (
            <button className="panel-move" onClick={() => moveDockPanel(dock!, otherSide(side!))} aria-label={`Move ${title} to the ${otherSide(side!)} dock`} title={`Move to the ${otherSide(side!)} dock`}>
              {side === 'left' ? '⇥' : '⇤'}
            </button>
          )}
          {onClose && (
            <button className="panel-close" onClick={onClose} aria-label={`Close ${title}`}>
              ×
            </button>
          )}
        </span>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
