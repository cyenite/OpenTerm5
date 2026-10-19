import { Fragment, useRef, useState, type DragEvent } from 'react';
import { clampDockWidth, defaultDockLayout, dockDrag, dockPanels, isDockPanel, panelDataType, resizePair, weightOf, type DockLayout, type DockSide, type StackItem } from '../lib/dock';
import { useStore } from '../lib/store';
import { moveDockPanel, resetDockWeights, setDockWeights, setDockWidth, workspace } from '../lib/workspace';
import { DataWindow } from './DataWindow';
import { DepthOfMarket } from './DepthOfMarket';
import { MarketWatch } from './MarketWatch';
import { Navigator } from './Navigator';
import { TradeAssistant } from './TradeAssistant';
import { Splitter } from './ui/Splitter';

interface DockItemProps {
  item: StackItem;
  depthSymbol: string | null;
}

function DockItem({ item, depthSymbol }: DockItemProps) {
  switch (item) {
    case 'marketWatch': return <MarketWatch />;
    case 'dataWindow': return <DataWindow />;
    case 'navigator': return <Navigator />;
    case 'tradeAssistant': return <TradeAssistant />;
    case 'depthOfMarket': return depthSymbol ? <DepthOfMarket symbol={depthSymbol} /> : null;
  }
}

interface DockDropProps {
  side: DockSide;
  width: number;
}

// Covers the dock's edge of the workbench while a panel from the other dock is dragged, so the
// layout does not shift under the pointer.
function DockDrop({ side, width }: DockDropProps) {
  const panel = useStore(dockDrag, (state) => state.panel);
  const [isOver, setIsOver] = useState(false);
  const label = dockPanels.find((candidate) => candidate.key === panel)?.label ?? 'panel';
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(panelDataType);
  return (
    <div
      className={`dock-drop is-${side}${isOver ? ' is-over' : ''}`}
      style={{ width }}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        const dropped = event.dataTransfer.getData(panelDataType);
        event.preventDefault();
        setIsOver(false);
        dockDrag.set({ panel: null });
        if (isDockPanel(dropped)) moveDockPanel(dropped, side);
      }}
    >
      <span>Dock {label} on the {side}</span>
    </div>
  );
}

interface PairDrag {
  above: StackItem;
  below: StackItem;
  aboveHeight: number;
  belowHeight: number;
  weights: DockLayout['weights'];
}

interface DockProps {
  side: DockSide;
  items: readonly StackItem[];
  depthSymbol: string | null;
}

export function Dock({ side, items, depthSymbol }: DockProps) {
  const width = useStore(workspace, (state) => state.dock.widths[side]);
  const weights = useStore(workspace, (state) => state.dock.weights);
  const isAnalysis = useStore(workspace, (state) => state.isAnalysisMode);
  const dragged = useStore(dockDrag, (state) => state.panel);
  const draggedSide = useStore(workspace, (state) => dragged ? state.dock.sides[dragged] : null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const [draftWeights, setDraftWeights] = useState<DockLayout['weights'] | null>(null);
  const elements = useRef(new Map<StackItem, HTMLElement>());
  const pair = useRef<PairDrag | null>(null);
  const startWidth = useRef(width);
  // Dragging towards the charts narrows a dock, so the right dock reads the pointer backwards.
  const direction = side === 'left' ? 1 : -1;
  const shownWidth = draftWidth ?? width;
  const shownWeights = draftWeights ?? weights;
  const isDropShown = !!dragged && !isAnalysis && draggedSide !== side;

  const measure = (above: StackItem, below: StackItem): PairDrag => ({
    above,
    below,
    weights,
    aboveHeight: elements.current.get(above)?.getBoundingClientRect().height ?? 0,
    belowHeight: elements.current.get(below)?.getBoundingClientRect().height ?? 0,
  });

  const widthSplitter = items.length > 0 && (
    <Splitter
      axis="columns"
      label={`Resize the ${side} dock`}
      onBegin={() => { startWidth.current = width; }}
      onDrag={(delta) => setDraftWidth(clampDockWidth(startWidth.current + direction * delta))}
      onEnd={() => {
        if (draftWidth !== null) setDockWidth(side, draftWidth);
        setDraftWidth(null);
      }}
      onStep={(delta) => setDockWidth(side, width + direction * delta)}
      onReset={() => setDockWidth(side, defaultDockLayout.widths[side])}
    />
  );

  return (
    <>
      {side === 'right' && widthSplitter}
      {items.length > 0 && (
        <aside className={`dock dock-${side}${isAnalysis ? ' analysis-dock' : ''}`} style={{ width: shownWidth }}>
          {items.map((item, index) => (
            <Fragment key={item}>
              {index > 0 && (
                <Splitter
                  axis="rows"
                  label="Resize the panels"
                  onBegin={() => { pair.current = measure(items[index - 1], item); }}
                  onDrag={(delta) => {
                    const current = pair.current;
                    if (current) setDraftWeights(resizePair(current.weights, current.above, current.below, delta, current.aboveHeight, current.belowHeight));
                  }}
                  onEnd={() => {
                    pair.current = null;
                    if (draftWeights) setDockWeights(draftWeights);
                    setDraftWeights(null);
                  }}
                  onStep={(delta) => {
                    const current = measure(items[index - 1], item);
                    setDockWeights(resizePair(current.weights, current.above, current.below, delta, current.aboveHeight, current.belowHeight));
                  }}
                  onReset={() => resetDockWeights(items)}
                />
              )}
              <div
                className="dock-item"
                style={{ flexGrow: weightOf(shownWeights, item) }}
                ref={(element) => {
                  if (element) elements.current.set(item, element);
                  else elements.current.delete(item);
                }}
              >
                <DockItem item={item} depthSymbol={depthSymbol} />
              </div>
            </Fragment>
          ))}
        </aside>
      )}
      {side === 'left' && widthSplitter}
      {isDropShown && <DockDrop side={side} width={items.length > 0 ? shownWidth : defaultDockLayout.widths[side] * 0.6} />}
    </>
  );
}
