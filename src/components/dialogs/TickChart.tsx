import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '../../lib/format';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';

const CAPACITY = 120;

interface TickChartProps {
  symbol: string;
  digits: number;
}

export function TickChart({ symbol, digits }: TickChartProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const history = useRef<{ bid: number; ask: number }[]>([]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    history.current = [];
  }, [symbol]);

  useEffect(() => {
    if (tick) {
      history.current = [...history.current.slice(-CAPACITY + 1), { bid: tick.bid, ask: tick.ask }];
      setVersion((version) => version + 1);
    }
  }, [tick]);

  const points = history.current;
  const width = 260;
  const height = 220;
  if (points.length < 2) {
    return <div className="tick-chart is-empty">Waiting for ticks</div>;
  }
  const low = Math.min(...points.map((point) => point.bid));
  const high = Math.max(...points.map((point) => point.ask));
  const span = high - low || 1;
  const x = (index: number) => (index / (CAPACITY - 1)) * width;
  const y = (price: number) => height - 12 - ((price - low) / span) * (height - 24);
  const line = (key: 'bid' | 'ask') => points.map((point, index) => `${x(index)},${y(point[key])}`).join(' ');

  return (
    <svg className="tick-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${symbol} tick chart`}>
      <polyline points={line('ask')} className="tick-ask" />
      <polyline points={line('bid')} className="tick-bid" />
      <text x={4} y={12}>{formatPrice(high, digits)}</text>
      <text x={4} y={height - 2}>{formatPrice(low, digits)}</text>
    </svg>
  );
}
