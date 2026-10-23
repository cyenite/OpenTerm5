import { useEffect, useState } from 'react';
import type { HubChart } from '../../../shared/hub';
import { useStore } from '../../lib/store';
import { bridge, onChartsChanged, requestChart } from '../bridge';
import { navigation } from '../navigation';
import { suggestQuoteSymbols } from '../quotes';

interface ChartRowProps {
  chart: HubChart;
}

function ChartRow({ chart }: ChartRowProps) {
  return (
    <li>
      <button type="button" className="phone-row" onClick={() => navigation.set({ chartId: chart.id })}>
        <span className="phone-row-main"><b>{chart.symbol}</b><small>{chart.timeframe}</small></span>
        {chart.isActive && <span className="phone-badge">On screen</span>}
        <span aria-hidden className="phone-row-chevron">›</span>
      </button>
    </li>
  );
}

// The computer's chart layouts, as its window shows them for the account in use.
export function ChartList() {
  const [charts, setCharts] = useState<HubChart[] | null>(null);
  const [error, setError] = useState('');
  const isReady = useStore(bridge, (state) => state.state === 'ready');

  useEffect(() => {
    if (!isReady) return;
    const load = () => void requestChart('charts.list', {}).then((list) => {
      setCharts(list);
      setError('');
      suggestQuoteSymbols(list.map((chart) => chart.symbol));
    }).catch((reason: Error) => setError(reason.message));
    load();
    return onChartsChanged(({ isListChanged }) => { if (isListChanged) load(); });
  }, [isReady]);

  const layouts = [...new Set((charts ?? []).map((chart) => chart.tabLabel))];
  return (
    <div className="phone-page">
      <h1>Charts</h1>
      <p className="phone-muted">Your layouts on the computer. Drawings you make here appear there, and the other way round.</p>
      {error && <p className="phone-error" role="alert">{error}</p>}
      {!charts && !error && <p className="phone-muted">Loading charts…</p>}
      {charts && !charts.length && <p className="phone-muted">The computer has no charts open for this account.</p>}
      {layouts.map((layout) => (
        <section key={layout} className="phone-group">
          <h2>{layout}</h2>
          <ul className="phone-list">{(charts ?? []).filter((chart) => chart.tabLabel === layout).map((chart) => <ChartRow key={chart.id} chart={chart} />)}</ul>
        </section>
      ))}
    </div>
  );
}
