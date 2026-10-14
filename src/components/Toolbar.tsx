import { useLayoutEffect, useRef, useState } from 'react';
import { timeframes } from '../../shared/protocol';
import { newOrder, setChartType, setTimeframe, toggleDepth, toggleOneClick, togglePanel, zoom } from '../lib/commands';
import { defaultSymbol } from '../lib/broker-symbols';
import { useStore } from '../lib/store';
import { activeChart, chartTypes, openChart, tools, workspace, type ChartType, type Tool } from '../lib/workspace';
import { HintBubble, hintProps, type HintContent } from './ui/Hint';
import { Icon, type IconName } from './ui/Icon';

interface ToolButtonProps {
  hint: HintContent;
  icon?: IconName;
  text?: string;
  isActive?: boolean;
  isPrimary?: boolean;
  isDisabled?: boolean;
  textLevel?: number;
  onClick: () => void;
}

function ToolButton({ hint, icon, text, isActive, isPrimary, isDisabled, textLevel, onClick }: ToolButtonProps) {
  const className = ['tool-button', isActive && 'is-active', isPrimary && 'is-primary', textLevel && 'has-text'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={className}
      aria-label={hint.title}
      aria-keyshortcuts={hint.shortcut}
      aria-pressed={isActive}
      aria-disabled={isDisabled || undefined}
      data-text-level={textLevel}
      onClick={() => { if (!isDisabled) onClick(); }}
      {...hintProps(hint)}
    >
      {icon && <Icon name={icon} />}
      {text && <span className="tool-text">{text}</span>}
    </button>
  );
}

interface ToolGroupProps {
  label: string;
  children: React.ReactNode;
}

function ToolGroup({ label, children }: ToolGroupProps) {
  return <div className="toolbar-group" role="group" aria-label={label}>{children}</div>;
}

const chartTypeIcons: Record<ChartType, IconName> = { bars: 'bars', candles: 'candles', line: 'line' };
const toolIcons: Record<Tool, IconName> = { cursor: 'cursor', crosshair: 'crosshair', hline: 'hline', trend: 'trend', vline: 'vline', ray: 'ray', rectangle: 'rectangle', fibonacci: 'fibonacci', riskOrder: 'riskOrder' };

// Labels stay while the toolbar fits on one row. When it would not, the least needed labels go
// first (level 1), then the rest (level 2); each comes back once the window regains the width
// that level needed.
const compactLevels = 2;

function useCompactToolbar() {
  const toolbar = useRef<HTMLDivElement>(null);
  const neededWidths = useRef<number[]>([]);
  const [level, setLevel] = useState(0);

  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => {
      if (level < compactLevels && element.scrollWidth > element.clientWidth + 1) {
        neededWidths.current[level] = element.scrollWidth;
        setLevel(level + 1);
      } else if (level > 0 && element.clientWidth >= neededWidths.current[level - 1]) setLevel(level - 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [level]);

  return { toolbar, level };
}

export function Toolbar() {
  const state = useStore(workspace, (current) => current);
  const chart = activeChart(state);
  const hasChart = chart !== undefined;
  const { toolbar, level } = useCompactToolbar();

  return (
    <div ref={toolbar} className="toolbar" data-level={level} role="toolbar" aria-label="Terminal">
      <ToolGroup label="Windows">
        <ToolButton icon="newChart" text="New Chart" textLevel={1} hint={{ title: 'New Chart', description: 'Open another chart window for the current symbol.' }} onClick={() => openChart(chart?.symbol ?? defaultSymbol())} />
        <ToolButton icon="marketWatch" text="Market Watch" textLevel={2} isActive={state.isMarketWatchShown} hint={{ title: 'Market Watch', shortcut: 'Ctrl+M', description: 'Live bid and ask prices for the symbols you follow.' }} onClick={() => togglePanel('isMarketWatchShown')} />
        <ToolButton icon="navigator" text="Navigator" textLevel={2} isActive={state.isNavigatorShown} hint={{ title: 'Navigator', shortcut: 'Ctrl+N', description: 'Your trading accounts and the indicators you can add.' }} onClick={() => togglePanel('isNavigatorShown')} />
        <ToolButton icon="toolbox" text="Toolbox" textLevel={2} isActive={state.isToolboxShown} hint={{ title: 'Toolbox', shortcut: 'Ctrl+T', description: 'Open positions, pending orders, history and the journal.' }} onClick={() => togglePanel('isToolboxShown')} />
        <ToolButton icon="dataWindow" text="Data Window" textLevel={2} isActive={state.isDataWindowShown} hint={{ title: 'Data Window', shortcut: 'Ctrl+D', description: 'Prices and indicator values under the pointer.' }} onClick={() => togglePanel('isDataWindowShown')} />
        <ToolButton icon="depth" text="Depth" textLevel={2} isActive={state.depthSymbol !== null} isDisabled={!hasChart} hint={{ title: 'Depth of Market', shortcut: 'Alt+B', description: "The order book for the active chart's symbol." }} onClick={() => toggleDepth()} />
      </ToolGroup>
      <ToolGroup label="Trading">
        <ToolButton text="New Order" isPrimary hint={{ title: 'New Order', shortcut: 'F9', description: 'Open the order ticket for the active symbol.' }} onClick={() => newOrder()} />
        <ToolButton icon="oneClick" text="One-Click" textLevel={1} isActive={state.isOneClickEnabled} hint={{ title: 'One-Click Trading', description: 'Buy and sell from the chart immediately, without a confirmation ticket.' }} onClick={toggleOneClick} />
      </ToolGroup>
      <ToolGroup label="Chart type">
        {chartTypes.map((type) => (
          <ToolButton key={type.key} icon={chartTypeIcons[type.key]} isActive={chart?.type === type.key} isDisabled={!hasChart} hint={{ title: type.label, shortcut: type.shortcut, description: type.description }} onClick={() => setChartType(type.key)} />
        ))}
      </ToolGroup>
      <ToolGroup label="Zoom">
        <ToolButton icon="zoomIn" isDisabled={!hasChart} hint={{ title: 'Zoom In', shortcut: '+' }} onClick={() => zoom(1.25)} />
        <ToolButton icon="zoomOut" isDisabled={!hasChart} hint={{ title: 'Zoom Out', shortcut: '-' }} onClick={() => zoom(0.8)} />
      </ToolGroup>
      <ToolGroup label="Drawing tools">
        {tools.map((tool) => (
          <ToolButton key={tool.key} icon={toolIcons[tool.key]} isActive={state.tool === tool.key} hint={{ title: tool.label, description: tool.description }} onClick={() => workspace.set({ tool: tool.key })} />
        ))}
      </ToolGroup>
      <ToolGroup label="Timeframe">
        {timeframes
          .filter((timeframe) => timeframe.isOnToolbar)
          .map((timeframe) => (
            <ToolButton key={timeframe.label} text={timeframe.label} isActive={chart?.timeframe === timeframe.label} isDisabled={!hasChart} hint={{ title: `Timeframe ${timeframe.label}`, description: 'The period each bar on the active chart covers.' }} onClick={() => setTimeframe(timeframe.label)} />
          ))}
      </ToolGroup>
      <HintBubble />
    </div>
  );
}
