import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { moveFrame, resizeEdges, resizeFrame, type ChartFrame, type ResizeEdge } from '../../lib/chart-windows';
import { closeChart, focusChart, maximizeChart, minimizeChart, setChartFrame, type ChartConfig, type ChartLayout } from '../../lib/workspace';
import { ChartWindow } from './ChartWindow';
import { chartMenu } from '../../lib/chart-menu';
import { openContextMenu } from '../../lib/context-menu';

interface ChartFrameWindowProps {
  chart: ChartConfig;
  layout: ChartLayout;
  zIndex: number;
  isActive: boolean;
  isHidden: boolean;
  iconIndex: number;
  iconBand: number;
}

interface Gesture {
  readonly edge: ResizeEdge | null;
  readonly startX: number;
  readonly startY: number;
  readonly width: number;
  readonly height: number;
  readonly frame: ChartFrame;
}

const fallbackFrame: ChartFrame = { left: 0.05, top: 0.05, width: 0.6, height: 0.6 };
const iconWidth = 168;

export function ChartFrameWindow({ chart, layout, zIndex, isActive, isHidden, iconIndex, iconBand }: ChartFrameWindowProps) {
  const element = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<ChartFrame | null>(null);
  const isWindowed = layout === 'windows';
  const isIcon = isWindowed && !!chart.isMinimized;
  const frame = draft ?? chart.frame ?? fallbackFrame;

  const begin = (event: ReactPointerEvent, edge: ResizeEdge | null) => {
    if (event.button !== 0 || !isWindowed || isIcon) return;
    const area = element.current?.parentElement?.getBoundingClientRect();
    if (!area) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    gesture.current = { edge, startX: event.clientX, startY: event.clientY, width: area.width, height: area.height - iconBand, frame };
    focusChart(chart.id);
  };
  const track = (event: ReactPointerEvent) => {
    const current = gesture.current;
    if (!current) return;
    const deltaX = (event.clientX - current.startX) / current.width;
    const deltaY = (event.clientY - current.startY) / current.height;
    setDraft(current.edge ? resizeFrame(current.frame, current.edge, deltaX, deltaY) : moveFrame(current.frame, deltaX, deltaY));
  };
  const finish = () => {
    if (!gesture.current) return;
    gesture.current = null;
    if (draft) setChartFrame(chart.id, draft);
    setDraft(null);
  };

  const style = !isWindowed
    ? { inset: 0 }
    : isIcon
      ? { left: iconIndex * (iconWidth + 2), bottom: 0, width: iconWidth, zIndex }
      : { left: `${frame.left * 100}%`, top: `calc((100% - ${iconBand}px) * ${frame.top})`, width: `${frame.width * 100}%`, height: `calc((100% - ${iconBand}px) * ${frame.height})`, zIndex };
  const classes = ['chart-frame', isWindowed ? 'is-floating' : 'is-tab', isActive && 'is-active', isIcon && 'is-icon', isHidden && 'is-background', draft && 'is-dragging'].filter(Boolean).join(' ');

  return (
    <div ref={element} className={classes} style={style} onPointerDownCapture={() => { if (isWindowed && !isIcon) focusChart(chart.id); }}>
      {isWindowed && (
        <div
          className="chart-frame-title"
          onPointerDown={(event) => begin(event, null)}
          onPointerMove={track}
          onPointerUp={finish}
          onPointerCancel={finish}
          onDoubleClick={() => isIcon ? focusChart(chart.id) : maximizeChart(chart.id)}
          onClick={() => { if (isIcon) focusChart(chart.id); }}
          onContextMenu={(event) => openContextMenu(event, chartMenu(chart.id))}
        >
          <span className="chart-frame-name">{chart.symbol},{chart.timeframe}</span>
          <span className="chart-frame-controls" onPointerDown={(event) => event.stopPropagation()}>
            {isIcon
              ? <button title="Restore" onClick={() => focusChart(chart.id)}>❐</button>
              : <button title="Minimize" onClick={() => minimizeChart(chart.id)}>−</button>}
            <button title="Maximize" onClick={() => maximizeChart(chart.id)}>□</button>
            <button title="Close" className="is-close" onClick={() => closeChart(chart.id)}>×</button>
          </span>
        </div>
      )}
      <div className="chart-frame-body">
        <ChartWindow chart={chart} isActive={isActive} />
      </div>
      {isWindowed && !isIcon && resizeEdges.map((edge) => (
        <div key={edge} className={`chart-frame-edge is-${edge}`} onPointerDown={(event) => begin(event, edge)} onPointerMove={track} onPointerUp={finish} onPointerCancel={finish} />
      ))}
    </div>
  );
}
