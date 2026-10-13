import { useStore } from '../lib/store';
import { activeChart, closeChart, openChart, workspace } from '../lib/workspace';
import { ChartWindow } from './chart/ChartWindow';

export function ChartWorkspace() {
  const charts = useStore(workspace, (state) => state.charts);
  const layout = useStore(workspace, (state) => state.layout);
  const isChartBarShown = useStore(workspace, (state) => state.isChartBarShown);
  const activeId = useStore(workspace, (state) => activeChart(state)?.id);
  const columns = Math.ceil(Math.sqrt(charts.length));

  return (
    <div
      className="chart-workspace"
      onDragOver={(event) => event.dataTransfer.types.includes('text/x-terminal5-symbol') && event.preventDefault()}
      onDrop={(event) => {
        const symbol = event.dataTransfer.getData('text/x-terminal5-symbol');
        if (symbol) {
          openChart(symbol);
        }
      }}
    >
      <div
        className={`chart-area is-${layout}`}
        style={layout === 'tile' ? { gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(charts.length / columns)}, 1fr)` } : undefined}
      >
        {charts.length === 0 && <p className="empty">Drag a symbol from Market Watch here, or use File &gt; New Chart</p>}
        {charts.map((chart) => (
          <div key={chart.id} className={`chart-slot${layout === 'tabs' && chart.id !== activeId ? ' is-background' : ''}`}>
            <ChartWindow chart={chart} isActive={chart.id === activeId} />
          </div>
        ))}
      </div>
      {isChartBarShown && (
        <nav className="chart-bar">
          {charts.map((chart) => (
            <button
              key={chart.id}
              className={chart.id === activeId ? 'is-active' : ''}
              onClick={() => workspace.set({ activeChartId: chart.id })}
              onAuxClick={(event) => event.button === 1 && closeChart(chart.id)}
              title="Middle-click to close"
            >
              {chart.symbol},{chart.timeframe}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
