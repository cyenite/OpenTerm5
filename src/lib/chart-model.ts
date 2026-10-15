import type { InputValue, SerializedDrawing } from '@meridian/charts';
import { indicatorKinds } from './indicators';

// What a chart saves about its studies and drawings, in Meridian's own shapes. Charts saved by
// earlier versions are migrated here: MetaTrader-style indicators and drawings from before
// Meridian, and the study and tool names of the chart engine OpenTerm5 briefly used before it.

export interface IndicatorConfig {
  id: string;
  // A Meridian study type, such as 'rsi' or 'mt5-ichimoku'.
  kind: string;
  params: Record<string, InputValue>;
}

export type Drawing = SerializedDrawing;

interface Point { time: number; price: number }

const mt5IndicatorKeys: ReadonlySet<string> = new Set(indicatorKinds.map((kind) => kind.key));

// Study names that changed; settings carry over where the input names match.
const renamedStudies: Readonly<Record<string, string>> = {
  'moving-average': 'sma',
  'average-true-range': 'atr',
  'commodity-channel-index': 'cci',
  'williams-percent-r': 'williams-r',
  'rate-of-change': 'roc',
  'average-directional-index': 'adx',
  'on-balance-volume': 'obv',
  'money-flow-index': 'mfi',
  'stochastic-rsi': 'stoch-rsi',
  'standard-deviation': 'std-dev',
  'chaikin-money-flow': 'cmf',
  'chande-momentum-oscillator': 'cmo',
  bandwidth: 'bb-width',
  'percent-b': 'bb-percent-b',
};

// Tool names that changed.
const renamedTools: Readonly<Record<string, string>> = {
  trendline: 'trend-line', hline: 'horizontal-line', extendedline: 'extended-line', vline: 'vertical-line', hray: 'horizontal-ray',
  crossline: 'cross-line', infoline: 'info-line', trendangle: 'trend-angle', box: 'rectangle', pricenote: 'price-note',
  pricelabel: 'price-label', parallelchannel: 'parallel-channel', disjointchannel: 'disjoint-channel', flattopbottom: 'flat-top-bottom',
  regressionchannel: 'regression-trend', anchoredvwap: 'anchored-vwap', fixedrangevp: 'fixed-range-volume-profile',
  schiffpitchfork: 'schiff-pitchfork', modifiedschiffpitchfork: 'modified-schiff-pitchfork', insidepitchfork: 'inside-pitchfork',
  freehand: 'brush', rotatedrect: 'rotated-rectangle', arrowmarkup: 'arrow-mark-up', arrowmarkdown: 'arrow-mark-down',
  flagmark: 'flag-mark', fibretracement: 'fib-retracement', fibextension: 'fib-extension', fibchannel: 'fib-channel',
  fibtimezones: 'fib-time-zone', fibspeedfan: 'fib-speed-fan', fibcircles: 'fib-circles', fibarcs: 'fib-arcs', fibwedge: 'fib-wedge',
  gannfan: 'gann-fan', gannbox: 'gann-box', gannsquare: 'gann-square', datepricerange: 'date-price-range', position: 'long-position',
  xabcd: 'xabcd-pattern', abcd: 'abcd-pattern', elliottimpulse: 'elliott-impulse', elliottcorrection: 'elliott-correction',
  headshoulders: 'head-shoulders', cypher: 'cypher-pattern',
};

// MetaTrader-style drawing kinds and the Meridian tool that replaces each.
export const legacyDrawingTypes: Readonly<Record<string, string>> = {
  hline: 'horizontal-line',
  vline: 'vertical-line',
  ray: 'horizontal-ray',
  trend: 'trend-line',
  rectangle: 'rectangle',
  fibonacci: 'fib-retracement',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const isInputValue = (value: unknown): value is InputValue => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);

const isPoint = (value: unknown): value is Point => isRecord(value) && Number.isFinite(value.time) && Number.isFinite(value.price);

export function migrateIndicator(value: unknown): IndicatorConfig | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string' || !value.kind || !isRecord(value.params)) return null;
  if (!Object.values(value.params).every(isInputValue)) return null;
  const params = value.params as Record<string, InputValue>;
  const kind = mt5IndicatorKeys.has(value.kind) ? `mt5-${value.kind}` : renamedStudies[value.kind] ?? value.kind;
  return { id: value.id, kind, params };
}

const style = (type: string) => ({ lineColor: '#2962ff', lineWidth: type === 'fib-retracement' ? 1 : 2, lineStyle: 'solid' as const, ...(type === 'rectangle' ? { fillColor: '#2962ff', fillOpacity: 0.15 } : {}) });

function migrateSerialized(value: Record<string, unknown>): Drawing | null {
  if (typeof value.id !== 'string' || typeof value.type !== 'string' || !Array.isArray(value.anchors) || !value.anchors.every(isPoint) || !isRecord(value.style)) return null;
  const type = renamedTools[value.type] ?? value.type;
  const savedStyle = value.style;
  const text = typeof value.text === 'string' ? value.text : isRecord(value.text) && typeof value.text.value === 'string' ? value.text.value : undefined;
  return {
    id: value.id,
    type,
    paneId: 'price',
    anchors: value.anchors.map((anchor) => ({ time: anchor.time, price: anchor.price })),
    style: {
      ...style(type),
      ...(typeof savedStyle.lineColor === 'string' ? { lineColor: savedStyle.lineColor } : {}),
      ...(Number.isFinite(savedStyle.lineWidth) ? { lineWidth: savedStyle.lineWidth as number } : {}),
      ...(savedStyle.lineStyle === 'solid' || savedStyle.lineStyle === 'dashed' || savedStyle.lineStyle === 'dotted' ? { lineStyle: savedStyle.lineStyle } : {}),
      ...(typeof savedStyle.fillColor === 'string' ? { fillColor: savedStyle.fillColor } : {}),
      ...(Number.isFinite(savedStyle.fillOpacity) ? { fillOpacity: savedStyle.fillOpacity as number } : {}),
      ...(typeof savedStyle.textColor === 'string' ? { textColor: savedStyle.textColor } : {}),
      ...(Number.isFinite(savedStyle.fontSize) ? { fontSize: savedStyle.fontSize as number } : {}),
      ...(typeof savedStyle.extendLeft === 'boolean' ? { extendLeft: savedStyle.extendLeft } : {}),
      ...(typeof savedStyle.extendRight === 'boolean' ? { extendRight: savedStyle.extendRight } : {}),
    },
    ...(text !== undefined ? { text } : {}),
    locked: value.locked === true,
    visible: value.visible !== false,
    zIndex: Number.isFinite(value.zIndex) ? value.zIndex as number : 0,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt as number : Date.now(),
    ...(isRecord(value.props) ? { props: value.props } : {}),
  };
}

// MetaTrader-style anchors were in seconds; Meridian's are in milliseconds.
export function migrateDrawing(value: unknown, now = Date.now()): Drawing | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  if (typeof value.type === 'string') return migrateSerialized(value);
  const type = legacyDrawingTypes[String(value.kind)];
  if (!type) return null;
  const point = (anchor: Point) => ({ time: anchor.time * 1000, price: anchor.price });
  let anchors: Point[];
  if (value.kind === 'hline') {
    if (!Number.isFinite(value.price)) return null;
    anchors = [{ time: now, price: value.price as number }];
  } else if (value.kind === 'vline') {
    if (!Number.isFinite(value.time)) return null;
    anchors = [point({ time: value.time as number, price: 0 })];
  } else if (value.kind === 'ray') {
    if (!isPoint(value.from)) return null;
    anchors = [point(value.from)];
  } else {
    if (!isPoint(value.from) || !isPoint(value.to)) return null;
    anchors = [point(value.from), point(value.to)];
  }
  return { id: value.id, type, paneId: 'price', anchors, style: style(type), locked: false, visible: true, zIndex: 0, createdAt: now };
}

export function migrateIndicators(value: unknown): IndicatorConfig[] | null {
  if (!Array.isArray(value)) return null;
  const indicators = value.map(migrateIndicator);
  return indicators.every((indicator): indicator is IndicatorConfig => indicator !== null) ? indicators : null;
}

export function migrateDrawings(value: unknown): Drawing[] | null {
  if (!Array.isArray(value)) return null;
  const drawings = value.map((drawing) => migrateDrawing(drawing));
  return drawings.every((drawing): drawing is Drawing => drawing !== null) ? drawings : null;
}
