import { useEffect, useRef, useState } from 'react';
import type { EquityPoint } from '../../lib/backtest/model';
import { formatMoney, formatTime } from '../../lib/format';

interface EquityCurveProps {
  points: readonly EquityPoint[];
  currency: string;
  initialBalance: number;
}

const PAD = { top: 10, right: 62, bottom: 20, left: 8 };

// Clean round steps for the money axis: 1, 2 or 5 times a power of ten.
function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= raw) ?? power * 10;
}

// Equity and balance over the session. Points are spaced by their order, as the charts space
// bars, so weekends and nights without trading do not leave flat stretches.
export function EquityCurve({ points, currency, initialBalance }: EquityCurveProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = Math.max(0, height - PAD.top - PAD.bottom);
  const values = points.flatMap((point) => [point.equity, point.balance]).concat(initialBalance);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = niceStep(high - low || Math.abs(high) * 0.01 || 1, 4);
  const floor = Math.floor(low / step) * step;
  const ceiling = Math.max(floor + step, Math.ceil(high / step) * step);
  const x = (index: number) => PAD.left + (points.length > 1 ? index / (points.length - 1) * plotWidth : plotWidth / 2);
  const y = (value: number) => PAD.top + (1 - (value - floor) / (ceiling - floor)) * plotHeight;
  const path = (key: 'equity' | 'balance') => points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join('');
  const ticks: number[] = [];
  for (let value = floor; value <= ceiling + step / 2; value += step) ticks.push(value);
  const shown = hover === null ? null : points[hover];
  const last = points.at(-1);

  const track = (event: React.PointerEvent<SVGSVGElement>) => {
    if (points.length < 2 || !plotWidth) return;
    const left = event.currentTarget.getBoundingClientRect().left;
    const ratio = (event.clientX - left - PAD.left) / plotWidth;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };

  return (
    <figure className="equity-curve" aria-label={`Equity and balance in ${currency}`}>
      <figcaption>
        <span className="equity-key is-equity">Equity</span>
        <span className="equity-key is-balance">Balance</span>
        {shown && (
          <span className="equity-readout" aria-live="polite">
            {formatTime(shown.time, false)} · Equity <b>{formatMoney(shown.equity)}</b> · Balance <b>{formatMoney(shown.balance)}</b> {currency}
          </span>
        )}
      </figcaption>
      <div ref={box} className="equity-plot">
        {points.length < 2 ? <p className="empty">The curve appears once the replay moves on.</p> : width > 0 && (
          <svg width={width} height={height} onPointerMove={track} onPointerLeave={() => setHover(null)} role="img" aria-label={last ? `Equity ${formatMoney(last.equity)} ${currency}, balance ${formatMoney(last.balance)} ${currency}` : undefined}>
            {ticks.map((value) => (
              <g key={value}>
                <line className="equity-grid" x1={PAD.left} x2={PAD.left + plotWidth} y1={y(value)} y2={y(value)} />
                <text className="equity-tick" x={PAD.left + plotWidth + 6} y={y(value)} dominantBaseline="middle">{formatMoney(value).replace(/\.00$/, '')}</text>
              </g>
            ))}
            <line className="equity-start" x1={PAD.left} x2={PAD.left + plotWidth} y1={y(initialBalance)} y2={y(initialBalance)} />
            <path className="equity-line is-balance" d={path('balance')} />
            <path className="equity-line is-equity" d={path('equity')} />
            {last && <circle className="equity-dot is-equity" cx={x(points.length - 1)} cy={y(last.equity)} r={4} />}
            {shown && hover !== null && (
              <g>
                <line className="equity-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotHeight} />
                <circle className="equity-dot is-balance" cx={x(hover)} cy={y(shown.balance)} r={4} />
                <circle className="equity-dot is-equity" cx={x(hover)} cy={y(shown.equity)} r={4} />
              </g>
            )}
            <text className="equity-tick" x={PAD.left} y={height - 5}>{formatTime(points[0].time, false)}</text>
            <text className="equity-tick" x={PAD.left + plotWidth} y={height - 5} textAnchor="end">{formatTime(points[points.length - 1].time, false)}</text>
          </svg>
        )}
      </div>
    </figure>
  );
}
