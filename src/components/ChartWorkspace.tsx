import { useStore } from '../lib/store';
import { activeChart, closeChart, focusChart, openChart, restoreWindows, workspace } from '../lib/workspace';
import { ChartFrameWindow } from './chart/ChartFrameWindow';
import { chartMenu } from '../lib/chart-menu';
import { openContextMenu } from '../lib/context-menu';

export function ChartWorkspace() {
  const charts = useStore(workspace, (state) => state.charts);
  const layout = useStore(workspace, (state) => state.layout);
  const stack = useStore(workspace, (state) => state.windowStack);
  const isChartBarShown = useStore(workspace, (state) => state.isChartBarShown);
  const activeId = useStore(workspace, (state) => activeChart(state)?.id);
  const icons = charts.filter((chart) => chart.isMinimized).map((chart) => chart.id);

  return (
    <div
      className="chart-workspace"
      onDragOver={(event) => event.dataTransfer.types.includes('text/x-openterm-symbol') && event.preventDefault()}
      onDrop={(event) => {
        const symbol = event.dataTransfer.getData('text/x-openterm-symbol');
        if (symbol) {
          openChart(symbol);
        }
      }}
    >
      <div className={`chart-area is-${layout}`}>
        {charts.length === 0 && <p className="empty">Drag a symbol from Market Watch here, or use File &gt; New Chart</p>}
        {charts.map((chart) => (
          <ChartFrameWindow
            key={chart.id}
            chart={chart}
            layout={layout}
            zIndex={(chart.isMinimized ? charts.length : 0) + stack.indexOf(chart.id) + 1}
            isActive={chart.id === activeId}
            isHidden={layout === 'tabs' && chart.id !== activeId}
            iconIndex={icons.indexOf(chart.id)}
            iconBand={layout === 'windows' && icons.length ? 26 : 0}
          />
        ))}
      </div>
      {isChartBarShown && (
        <nav className="chart-bar">
          {charts.map((chart) => (
            <div
              key={chart.id}
              role="tab"
              aria-selected={chart.id === activeId}
              className={['chart-tab', chart.id === activeId && 'is-active', chart.isMinimized && layout === 'windows' && 'is-minimized'].filter(Boolean).join(' ')}
              onMouseDown={(event) => event.button === 0 && focusChart(chart.id)}
              onAuxClick={(event) => event.button === 1 && closeChart(chart.id)}
              onContextMenu={(event) => openContextMenu(event, chartMenu(chart.id))}
            >
              <span>{chart.symbol},{chart.timeframe}</span>
              <button className="chart-tab-close" title="Close chart" aria-label={`Close ${chart.symbol},${chart.timeframe}`} onMouseDown={(event) => event.stopPropagation()} onClick={() => closeChart(chart.id)}>×</button>
            </div>
          ))}
          {layout === 'tabs' && charts.length > 0 && <button className="chart-bar-restore" title="Restore floating windows" onClick={restoreWindows}>❐</button>}
        </nav>
      )}
    </div>
  );
}
