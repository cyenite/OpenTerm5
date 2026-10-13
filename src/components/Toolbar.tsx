import { timeframes } from '../../shared/protocol';
import { newOrder, setChartType, setTimeframe, toggleDepth, toggleOneClick, togglePanel, zoom } from '../lib/commands';
import { useStore } from '../lib/store';
import { activeChart, chartTypes, openChart, tools, workspace } from '../lib/workspace';

interface ToolButtonProps {
  label: string;
  title: string;
  isActive?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
}

function ToolButton({ label, title, isActive, isDisabled, onClick }: ToolButtonProps) {
  return (
    <button className={`tool-button${isActive ? ' is-active' : ''}`} title={title} aria-pressed={isActive} disabled={isDisabled} onClick={onClick}>
      {label}
    </button>
  );
}

const chartTypeGlyphs = { bars: '┤├', candles: '▮▯', line: '╱╲' } as const;
const toolGlyphs = { cursor: '↖', crosshair: '┼', hline: '―', trend: '⟋', vline: '│', ray: '→', rectangle: '▭', fibonacci: 'F', riskOrder: 'R%' } as const;

export function Toolbar() {
  const state = useStore(workspace, (current) => current);
  const chart = activeChart(state);
  const hasChart = chart !== undefined;

  return (
    <div className="toolbar" role="toolbar">
      <div className="toolbar-group">
        <ToolButton label="⊞" title="New Chart" onClick={() => openChart(chart?.symbol ?? 'EURUSD')} />
        <ToolButton label="⇅" title="Market Watch (Ctrl+M)" isActive={state.isMarketWatchShown} onClick={() => togglePanel('isMarketWatchShown')} />
        <ToolButton label="☰" title="Data Window (Ctrl+D)" isActive={state.isDataWindowShown} onClick={() => togglePanel('isDataWindowShown')} />
        <ToolButton label="⌂" title="Navigator (Ctrl+N)" isActive={state.isNavigatorShown} onClick={() => togglePanel('isNavigatorShown')} />
        <ToolButton label="▤" title="Toolbox (Ctrl+T)" isActive={state.isToolboxShown} onClick={() => togglePanel('isToolboxShown')} />
        <ToolButton label="≣" title="Depth Of Market (Alt+B)" isActive={state.depthSymbol !== null} isDisabled={!hasChart} onClick={() => toggleDepth()} />
      </div>
      <div className="toolbar-group">
        <button className="tool-button is-wide is-primary" title="New Order (F9)" onClick={() => newOrder()}>
          New Order
        </button>
        <ToolButton label="1-Click" title="One Click Trading" isActive={state.isOneClickEnabled} onClick={toggleOneClick} />
      </div>
      <div className="toolbar-group">
        {chartTypes.map((type) => (
          <ToolButton
            key={type.key}
            label={chartTypeGlyphs[type.key]}
            title={`${type.label} (${type.shortcut})`}
            isActive={chart?.type === type.key}
            isDisabled={!hasChart}
            onClick={() => setChartType(type.key)}
          />
        ))}
        <ToolButton label="+" title="Zoom In (+)" isDisabled={!hasChart} onClick={() => zoom(1.25)} />
        <ToolButton label="−" title="Zoom Out (-)" isDisabled={!hasChart} onClick={() => zoom(0.8)} />
      </div>
      <div className="toolbar-group">
        {tools.map((tool) => (
          <ToolButton key={tool.key} label={toolGlyphs[tool.key]} title={tool.label} isActive={state.tool === tool.key} onClick={() => workspace.set({ tool: tool.key })} />
        ))}
      </div>
      <div className="toolbar-group">
        {timeframes
          .filter((timeframe) => timeframe.isOnToolbar)
          .map((timeframe) => (
            <ToolButton
              key={timeframe.label}
              label={timeframe.label}
              title={`Timeframe ${timeframe.label}`}
              isActive={chart?.timeframe === timeframe.label}
              isDisabled={!hasChart}
              onClick={() => setTimeframe(timeframe.label)}
            />
          ))}
      </div>
    </div>
  );
}
