import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../settings';
import { fromTradingViewChartSettings, fromTradingViewLineTool, fromTradingViewTheme, parseColor, patchTradingViewLineTool, type TradingViewConversion, type TradingViewLineTool, type TradingViewPatch } from './tradingview';

const HOUR = 3_600_000;
const T = 1_760_000_400;

const tool = (type: string, points: TradingViewLineTool['points'], state: Record<string, unknown> = {}): TradingViewLineTool => ({ id: 'abc', type, points, state, zorder: 4 });

function drawingOf(conversion: TradingViewConversion) {
  assert.equal(conversion.kind, 'drawing', conversion.kind === 'skipped' ? conversion.reason : '');
  return conversion.drawing;
}

test('a trend line keeps its points, colours, width, style and extensions', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolTrendLine', [{ time_t: T, offset: 0, price: 1.1, interval: '60' }, { time_t: T + 3600, offset: 0, price: 1.2, interval: '60' }], {
    linecolor: 'rgba(255, 0, 255, 1)', linewidth: 3, linestyle: 2, extendRight: true, extendLeft: false, showAngle: true, frozen: true, visible: true,
  }), { serverOffsetAt: () => 2 * HOUR, now: 5 }));
  assert.deepEqual(drawing.anchors, [{ time: T * 1000 + 2 * HOUR, price: 1.1 }, { time: (T + 3600) * 1000 + 2 * HOUR, price: 1.2 }]);
  assert.equal(drawing.id, 'tv-abc');
  assert.equal(drawing.type, 'trend-line');
  assert.deepEqual([drawing.style.lineColor, drawing.style.lineWidth, drawing.style.lineStyle, drawing.style.extendLeft, drawing.style.extendRight], ['#ff00ff', 3, 'dashed', false, true]);
  assert.equal(drawing.locked, true);
  assert.equal(drawing.zIndex, 4);
  assert.equal(drawing.props?.showAngle, true);
});

test('daily points keep their date and future points move by whole bars', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolRay', [{ time_t: T, price: 1, interval: '1D' }, { time_t: T, offset: 3, price: 2, interval: 'D' }]), { serverOffsetAt: () => 2 * HOUR }));
  assert.deepEqual(drawing.anchors.map((anchor) => anchor.time), [T * 1000, T * 1000 + 3 * 24 * HOUR]);
});

test('fibonacci levels and the background come across', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolFibRetracement', [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }], {
    level1: { coeff: 0, color: '#787B86', visible: true }, level2: { coeff: 0.618, color: 'rgb(8, 153, 129)', visible: true }, level3: { coeff: 4.236, color: '#E91E63', visible: false },
    showCoeffs: false, fillBackground: true, transparency: 80, extendLines: true,
  }), { serverOffsetAt: () => 0 }));
  assert.deepEqual(drawing.props?.levels, [{ value: 0, color: '#787b86', isVisible: true }, { value: 0.618, color: '#089981', isVisible: true }, { value: 4.236, color: '#e91e63', isVisible: false }]);
  assert.equal(drawing.props?.showLevels, false);
  assert.equal(drawing.props?.backgroundOpacity, 20);
  assert.equal(drawing.style.extendRight, true);
});

test('a rectangle fills with its background colour and transparency', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolRectangle', [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }], { color: '#2962FF', backgroundColor: 'rgba(41, 98, 255, 0.25)', fillBackground: true }), { serverOffsetAt: () => 0 }));
  assert.deepEqual([drawing.style.lineColor, drawing.style.fillColor, drawing.style.fillOpacity], ['#2962ff', '#2962ff', 0.25]);
});

test('text tools take their text, text colour and size', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolText', [{ time_t: T, price: 1 }], { text: 'Breakout', color: '#F23645', fontsize: 18, bold: true }), { serverOffsetAt: () => 0 }));
  assert.deepEqual([drawing.text, drawing.style.textColor, drawing.style.fontSize, drawing.props?.bold], ['Breakout', '#f23645', 18, true]);
});

test('a long position places its target and stop from ticks', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolRiskRewardLong', [{ time_t: T, price: 1.1 }, { time_t: T + 7200, price: 1.1 }], { profitLevel: 200, stopLevel: 100, accountSize: 5000, risk: 2 }), { serverOffsetAt: () => 0, tickSize: 0.00001 }));
  assert.deepEqual(drawing.anchors.map((anchor) => Number(anchor.price.toFixed(5))), [1.1, 1.102, 1.099]);
  assert.equal(drawing.anchors[1].time, (T + 7200) * 1000);
  assert.deepEqual([drawing.props?.accountSize, drawing.props?.riskPercent], [5000, 2]);
});

test('a position is skipped when the price step is unknown', () => {
  const conversion = fromTradingViewLineTool(tool('LineToolRiskRewardShort', [{ time_t: T, price: 1 }], { profitLevel: 1, stopLevel: 1 }), { serverOffsetAt: () => 0 });
  assert.equal(conversion.kind, 'skipped');
});

test('hidden timeframes become the visibility setting', () => {
  const drawing = drawingOf(fromTradingViewLineTool(tool('LineToolHorzLine', [{ time_t: T, price: 1 }], { intervalsVisibilities: { ticks: true, seconds: false, minutes: true, hours: true, days: true, weeks: true, months: true, ranges: true } }), { serverOffsetAt: () => 0 }));
  assert.deepEqual(drawing.props?.visibility, { seconds: false, minutes: true, hours: true, days: true, weeks: true, months: true });
});

test('unsupported, screen-pinned and short drawings are skipped with a reason', () => {
  for (const conversion of [
    fromTradingViewLineTool(tool('LineToolEmoji', [{ time_t: T, price: 1 }]), { serverOffsetAt: () => 0 }),
    fromTradingViewLineTool(tool('LineToolTextAbsolute', [{}]), { serverOffsetAt: () => 0 }),
    fromTradingViewLineTool(tool('LineToolTrendLine', [{ time_t: T, price: 1 }]), { serverOffsetAt: () => 0 }),
  ]) {
    assert.equal(conversion.kind, 'skipped');
    assert.ok(conversion.kind === 'skipped' && conversion.reason.length > 0);
  }
});

test('colours parse from hex, short hex and rgba', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('#11223380'), { r: 17, g: 34, b: 51, a: 128 / 255 });
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.equal(parseColor('red'), null);
});

test('a TradingView theme becomes chart colours on a theme of the same brightness', () => {
  const patch = fromTradingViewTheme({
    chartProperties: {
      paneProperties: { background: '#131722', backgroundType: 'solid', horzGridProperties: { color: 'rgba(255, 255, 255, 0.5)' }, crossHairProperties: { color: '#9598A1' } },
      scalesProperties: { textColor: '#B2B5BE', lineColor: '#2A2E39' },
    },
    mainSourceProperties: { candleStyle: { upColor: '#26A69A', downColor: '#EF5350' }, lineStyle: { color: '#2962FF' } },
  }, { id: 'tradingview-night', label: 'Night (TradingView)' });
  assert.equal(patch?.mode, 'dark');
  assert.deepEqual(patch?.chart, { background: '#131722', text: '#b2b5be', grid: '#898b91', border: '#2a2e39', up: '#26a69a', down: '#ef5350', line: '#2962ff', crosshair: '#9598a1' });
  assert.equal(fromTradingViewTheme({}, { id: 'x', label: 'x' }), null);
});

test('a gradient theme keeps its top and bottom colours', () => {
  const patch = fromTradingViewTheme({ chartProperties: { paneProperties: { backgroundType: 'gradient', background: '#000000', backgroundGradientStartColor: '#1E222D', backgroundGradientEndColor: '#131722' } } }, { id: 'g', label: 'g' });
  assert.deepEqual([patch?.chart?.background, patch?.chart?.backgroundGradient, patch?.mode], ['#1e222d', '#131722', 'dark']);
});

test('tools that name their style differently keep it: paths, channels, date ranges', () => {
  const two = [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }];
  const path = drawingOf(fromTradingViewLineTool(tool('LineToolPath', two, { lineColor: '#FF9800', lineWidth: 3, lineStyle: 1 }), { serverOffsetAt: () => 0 }));
  assert.deepEqual([path.style.lineColor, path.style.lineWidth, path.style.lineStyle], ['#ff9800', 3, 'dotted']);
  const channel = drawingOf(fromTradingViewLineTool(tool('LineToolParallelChannel', [...two, { time_t: T, price: 3 }], { level1: { color: '#089981', linewidth: 2, linestyle: 0, visible: true }, backgroundColor: '#089981', fillBackground: true, transparency: 80 }), { serverOffsetAt: () => 0 }));
  assert.deepEqual([channel.style.lineColor, channel.style.fillOpacity], ['#089981', 0.2]);
  const range = drawingOf(fromTradingViewLineTool(tool('LineToolDateRange', two, { linecolor: '#2962FF', backgroundColor: '#2962FF', fillBackground: true, backgroundTransparency: 70 }), { serverOffsetAt: () => 0 }));
  assert.equal(range.style.fillOpacity, 0.3);
  const marker = fromTradingViewLineTool(tool('LineToolHighlighter', [{ time_t: T, price: 1 }], { linecolor: '#FFEB3B', width: 20 }), { serverOffsetAt: () => 0 });
  assert.deepEqual(marker, { kind: 'skipped', reason: 'TradingView sends only the first point of its stroke' });
});

test('line text, alignment, arrows and stats come across as TradingView shows them', () => {
  const two = [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }];
  const shown = drawingOf(fromTradingViewLineTool(tool('LineToolTrendLine', two, {
    linecolor: 'rgba(103, 58, 183, 1)', textcolor: 'rgba(242, 54, 69, 1)', text: 'BOS', showLabel: true, fontsize: 11, bold: true, italic: false,
    horzLabelsAlign: 'right', vertLabelsAlign: 'bottom', leftEnd: 0, rightEnd: 1, showPercentPriceRange: true, alwaysShowStats: false,
  }), { serverOffsetAt: () => 0 }));
  assert.equal(shown.text, 'BOS');
  assert.deepEqual([shown.style.lineColor, shown.style.textColor, shown.style.fontSize], ['#673ab7', '#f23645', 11]);
  assert.deepEqual(shown.props, { showPercentPriceRange: true, alwaysShowStats: false, bold: true, italic: false, startArrow: false, endArrow: true, textAlign: 'Right', textPosition: 'Above line' });
  const hidden = drawingOf(fromTradingViewLineTool(tool('LineToolTrendLine', two, { text: 'BOS', showLabel: false }), { serverOffsetAt: () => 0 }));
  assert.equal(hidden.text, undefined);
});

test('a see-through rectangle border, a hidden horizontal price and fib array levels are kept', () => {
  const two = [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }];
  const box = drawingOf(fromTradingViewLineTool(tool('LineToolRectangle', two, { color: 'rgba(81, 45, 168, 0)', backgroundColor: 'rgba(120, 123, 134, 0.2)', fillBackground: true, text: 'OB', textColor: '#9598A1', horzLabelsAlign: 'right', vertLabelsAlign: 'middle' }), { serverOffsetAt: () => 0 }));
  assert.deepEqual([box.style.lineOpacity, box.style.fillColor, box.style.fillOpacity, box.text, box.props?.textAlign, box.props?.textPosition], [0, '#787b86', 0.2, 'OB', 'Right', 'Middle']);
  const line = drawingOf(fromTradingViewLineTool(tool('LineToolHorzLine', [{ time_t: T, price: 1 }], { showPrice: false, text: 'S&R', showLabel: true, vertLabelsAlign: 'top' }), { serverOffsetAt: () => 0 }));
  assert.deepEqual([line.props?.showPrice, line.text, line.props?.textPosition], [false, 'S&R', 'Below line']);
  const fib = drawingOf(fromTradingViewLineTool(tool('LineToolFibRetracement', two, { level1: [0, '#787B86', true, ''], level2: [0.705, 'rgba(8, 153, 129, 1)', true, 'OTE'], level3: [1, '#787B86', false, ''], showText: true, coeffsAsPercents: true, trendline: { visible: false }, horzLabelsAlign: 'right' }), { serverOffsetAt: () => 0 }));
  assert.deepEqual(fib.props?.levels, [{ value: 0, color: '#787b86', isVisible: true }, { value: 0.705, color: '#089981', isVisible: true, text: 'OTE' }, { value: 1, color: '#787b86', isVisible: false }]);
  assert.deepEqual([fib.props?.showText, fib.props?.isPercent, fib.props?.showTrendLine, fib.props?.labelsPosition], [true, true, false, 'Right']);
});

test('positions keep compact labels, colours and money risk', () => {
  const position = drawingOf(fromTradingViewLineTool(tool('LineToolRiskRewardLong', [{ time_t: T, price: 100 }, { time_t: T + 3600, price: 100 }], {
    profitLevel: 100, stopLevel: 50, compact: true, showPriceLabels: false, alwaysShowStats: false, profitBackground: 'rgba(76, 175, 80, 0.25)', stopBackground: 'rgba(242, 54, 69, 0.2)', textcolor: '#ffffff', riskDisplayMode: 'money', risk: 50, accountSize: 1000,
  }), { serverOffsetAt: () => 0, tickSize: 0.01 }));
  assert.deepEqual(position.props, { isCompact: true, showStats: false, showPriceLabels: false, accountSize: 1000, riskPercent: 5, profitColor: '#4caf50', stopColor: '#f23645', textColor: '#ffffff', areaOpacity: 25 });
});

// One chart of a real layout, trimmed to the settings the converter reads.
const layoutChart = {
  chartProperties: {
    paneProperties: {
      backgroundType: 'gradient',
      background: 'rgba(255, 255, 255, 1)',
      backgroundGradientStartColor: 'rgba(255, 255, 255, 1)',
      backgroundGradientEndColor: 'rgba(209, 212, 220, 1)',
      vertGridProperties: { style: 0, visible: false, color: 'rgba(240, 243, 250, 0.06)' },
      horzGridProperties: { style: 0, visible: false, color: 'rgba(240, 243, 250, 0.06)' },
      crossHairProperties: { style: 2, transparency: 0, width: 1, color: '#9598A1' },
      topMargin: 10,
      bottomMargin: 8,
      axisProperties: { percentage: false, indexedTo100: false, log: false, isInverted: false },
      legendProperties: { showStudyArguments: false, showStudyTitles: true, showStudyValues: false, showSeriesTitle: true, showSeriesOHLC: false, showBarChange: false },
      separatorColor: '#2A2E39',
    },
    scalesProperties: { fontSize: 12, showSeriesLastValue: true, showStudyLastValue: false, showPriceScaleCrosshairLabel: true, showTimeScaleCrosshairLabel: true, textColor: '#B2B5BE', lineColor: 'rgba(240, 243, 250, 0)' },
  },
  panes: [{
    sources: [{
      type: 'MainSeries',
      id: 'ibCWf0',
      state: {
        style: 1,
        symbol: 'OANDA:XAUUSD',
        interval: '15',
        candleStyle: { drawWick: true, drawBorder: true, drawBody: true, upColor: 'rgba(76, 175, 80, 1)', downColor: 'rgba(0, 0, 0, 1)', wickUpColor: 'rgba(0, 0, 0, 1)', wickDownColor: 'rgba(0, 0, 0, 1)', borderUpColor: 'rgba(42, 46, 57, 1)', borderDownColor: 'rgba(0, 0, 0, 1)' },
        hollowCandleStyle: { drawWick: true, drawBorder: true, drawBody: true, upColor: '#089981', downColor: '#F23645', borderUpColor: '#089981', borderDownColor: '#F23645', wickUpColor: '#089981', wickDownColor: '#F23645' },
        haStyle: { drawWick: true, drawBorder: true, drawBody: true, upColor: '#089981', downColor: '#F23645' },
        barStyle: { downColor: '#F23645', upColor: '#089981' },
        showCountdown: true,
        showPriceLine: true,
        priceLineColor: '',
        priceLineWidth: 1,
        priceAxisProperties: { percentage: false, log: false, isInverted: false, indexedTo100: false },
      },
    }],
  }],
  timeScale: { m_barSpacing: 6.2, m_rightOffset: 10 },
};

test('a layout chart\'s settings come across: canvas, candles, scales, status line and margins', () => {
  const converted = fromTradingViewChartSettings(layoutChart);
  assert.equal(converted?.priceStyle, 'candles');
  assert.deepEqual(converted?.settings, {
    ...defaultSettings,
    upColor: '#4caf50',
    downColor: '#000000',
    isBorderVisible: true,
    borderUpColor: '#2a2e39',
    borderDownColor: '#000000',
    wickUpColor: '#000000',
    wickDownColor: '#000000',
    background: '#ffffff',
    backgroundGradient: '#d1d4dc',
    isVerticalGridShown: false,
    isHorizontalGridShown: false,
    // Translucent grid lines over the middle of the gradient.
    verticalGridColor: '#e8eaee',
    horizontalGridColor: '#e8eaee',
    crosshairColor: '#9598a1',
    textColor: '#b2b5be',
    scaleLineColor: '#e8eaee',
    scaleFontSize: 12,
    separatorColor: '#2a2e39',
    isOhlcShown: false,
    isBarChangeShown: false,
    isStudyValuesShown: false,
    isStudyArgumentsShown: false,
    isStudyLabelsShown: false,
    rightMarginBars: 10,
    bottomMarginPercent: 8,
  });
});

test('chart settings follow the style in use, its price line and its scale mode', () => {
  const state = layoutChart.panes[0].sources[0].state;
  const withState = (patch: Record<string, unknown>) => ({ ...layoutChart, panes: [{ sources: [{ type: 'MainSeries', id: 'x', state: { ...state, ...patch } }] }] });
  const hollow = fromTradingViewChartSettings(withState({ style: 9, priceLineColor: 'rgba(41, 98, 255, 1)', priceLineWidth: 3, priceAxisProperties: { log: true, isInverted: true } }));
  assert.equal(hollow?.priceStyle, 'hollow');
  assert.deepEqual([hollow?.settings.upColor, hollow?.settings.downColor, hollow?.settings.wickUpColor], ['#089981', '#f23645', '#089981']);
  assert.deepEqual([hollow?.settings.lastPriceLineColor, hollow?.settings.lastPriceLineWidth, hollow?.settings.scaleMode, hollow?.settings.isScaleInverted], ['#2962ff', 3, 'log', true]);
  const bars = fromTradingViewChartSettings(withState({ style: 0, priceAxisProperties: { percentage: true } }));
  assert.deepEqual([bars?.priceStyle, bars?.settings.upColor, bars?.settings.borderUpColor, bars?.settings.scaleMode], ['bars', '#089981', '#2a2e39', 'percent']);
  const renko = fromTradingViewChartSettings(withState({ style: 4, priceAxisProperties: { indexedTo100: true } }));
  assert.equal(renko?.priceStyle, undefined);
  assert.equal(renko?.settings.scaleMode, 'indexed');
  assert.equal(renko?.settings.upColor, '#4caf50');
  const solid = fromTradingViewChartSettings({ chartProperties: { paneProperties: { background: '#131722', crossHairProperties: { color: '#FFFFFF', transparency: 50, width: 9 } } } });
  assert.deepEqual([solid?.settings.background, solid?.settings.backgroundGradient, solid?.settings.crosshairColor, solid?.settings.crosshairWidth, solid?.priceStyle], ['#131722', null, '#898b91', 4, undefined]);
  assert.equal(fromTradingViewChartSettings({ chartProperties: {} }), null);
});

// A tool as TradingView's storage keeps it, with a setting Meridian does not model.
const stored = (type: string, points: TradingViewLineTool['points'], state: Record<string, unknown>) => ({ type, id: 'abc', state: { ...state, alertsUnknownSetting: { nested: [1, 2] } }, points, zorder: 4, ownerSource: 'ibCWf0', linkKey: 'k1', sharingMode: 1 });

function patchedOf(patch: TradingViewPatch) {
  assert.equal(patch.kind, 'patched', patch.kind === 'unwritable' ? patch.reason : '');
  return patch;
}

const imported = (base: ReturnType<typeof stored>, options = { serverOffsetAt: () => 2 * HOUR, tickSize: 0.00001 }) => drawingOf(fromTradingViewLineTool({ ...base, state: base.state }, options));

test('an unedited drawing goes back exactly as TradingView sent it', () => {
  const base = stored('LineToolTrendLine', [{ time_t: T, offset: 0, price: 1.1, interval: '60' }, { time_t: T, offset: 5, price: 1.2, interval: '60' }], { linecolor: 'rgba(255, 0, 255, 0.8)', linewidth: 2, linestyle: 4, showLabel: false, text: 'kept' });
  const drawing = imported(base);
  const { tool, unwritten } = patchedOf(patchTradingViewLineTool(base, drawing, structuredClone(drawing), { serverOffsetAt: () => 2 * HOUR }));
  assert.deepEqual(tool, base);
  assert.deepEqual(unwritten, []);
});

test('moved anchors go back as UTC bar times, keeping each point\'s interval', () => {
  const base = stored('LineToolTrendLine', [{ time_t: T, offset: 0, price: 1.1, interval: '60' }, { time_t: T + 3600, offset: 0, price: 1.2, interval: '60' }], { linecolor: '#ff00ff' });
  const drawing = imported(base);
  const moved = { ...drawing, anchors: [drawing.anchors[0], { time: drawing.anchors[1].time + 2 * HOUR, price: 1.25 }] };
  const { tool } = patchedOf(patchTradingViewLineTool(base, drawing, moved, { serverOffsetAt: () => 2 * HOUR }));
  assert.deepEqual(tool.points, [{ time_t: T, offset: 0, price: 1.1, interval: '60' }, { time_t: T + 3 * 3600, offset: 0, price: 1.25, interval: '60' }]);
  assert.deepEqual(tool.state, base.state);
});

test('style, text, lock and order edits land where TradingView keeps them, nothing else changes', () => {
  const base = stored('LineToolTrendLine', [{ time_t: T, price: 1.1, interval: '60' }, { time_t: T + 3600, price: 1.2, interval: '60' }], { lineColor: 'rgba(255, 0, 255, 0.5)', lineWidth: 1, lineStyle: 0, textcolor: '#ffffff', showLabel: false });
  const drawing = imported(base);
  const edited = { ...drawing, style: { ...drawing.style, lineColor: '#00ff00', lineOpacity: 1, lineWidth: 4, lineStyle: 'dotted' as const }, text: 'Entry', locked: true, zIndex: 9 };
  const { tool } = patchedOf(patchTradingViewLineTool(base, drawing, edited, { serverOffsetAt: () => 2 * HOUR }));
  const state = tool.state as Record<string, unknown>;
  assert.deepEqual([state.lineColor, state.lineWidth, state.lineStyle, state.text, state.showLabel, state.frozen, tool.zorder], ['rgba(0, 255, 0, 1)', 4, 1, 'Entry', true, true, 9]);
  assert.equal(state.linecolor, undefined);
  assert.deepEqual(state.alertsUnknownSetting, base.state.alertsUnknownSetting);
  assert.deepEqual(tool.points, base.points);
});

test('a rectangle\'s fill and a fib\'s levels go back in their own shapes', () => {
  const rectangle = stored('LineToolRectangle', [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }], { color: '#2962FF', backgroundColor: 'rgba(41, 98, 255, 0.25)', fillBackground: true });
  const box = imported(rectangle);
  const filled = patchedOf(patchTradingViewLineTool(rectangle, box, { ...box, style: { ...box.style, fillColor: '#ff0000', fillOpacity: 0.5 } }, { serverOffsetAt: () => 0 })).tool.state as Record<string, unknown>;
  assert.deepEqual([filled.backgroundColor, filled.fillBackground], ['rgba(255, 0, 0, 0.5)', true]);
  const fib = stored('LineToolFibRetracement', [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }], { level1: [0, '#787B86', true, ''], level2: { coeff: 0.618, color: 'rgb(8, 153, 129)', visible: true } });
  const levels = imported(fib);
  const changed = (levels.props?.levels as { value: number; color: string; isVisible: boolean }[]).map((level, index) => (index === 1 ? { ...level, value: 0.5, isVisible: false } : level));
  const state = patchedOf(patchTradingViewLineTool(fib, levels, { ...levels, props: { ...levels.props, levels: changed } }, { serverOffsetAt: () => 0 })).tool.state as Record<string, unknown>;
  assert.deepEqual(state.level1, [0, '#787b86', true, '']);
  assert.deepEqual(state.level2, { coeff: 0.5, color: '#089981', visible: false });
});

test('a long position goes back as an entry and tick distances, and needs the price step', () => {
  const base = stored('LineToolRiskRewardLong', [{ time_t: T, price: 1.1 }, { time_t: T + 7200, price: 1.1 }], { profitLevel: 200, stopLevel: 100 });
  const drawing = imported(base, { serverOffsetAt: () => 0, tickSize: 0.00001 });
  const [entry, target, stop] = drawing.anchors;
  const moved = { ...drawing, anchors: [entry, { ...target, price: 1.103 }, { ...stop, price: 1.0995 }] };
  const { tool } = patchedOf(patchTradingViewLineTool(base, drawing, moved, { serverOffsetAt: () => 0, tickSize: 0.00001 }));
  const state = tool.state as Record<string, unknown>;
  assert.deepEqual([state.profitLevel, state.stopLevel], [300, 50]);
  assert.deepEqual(patchTradingViewLineTool(base, drawing, moved, { serverOffsetAt: () => 0 }).kind, 'unwritable');
});

test('edits TradingView has no place for are named', () => {
  const base = stored('LineToolTrendLine', [{ time_t: T, price: 1 }, { time_t: T + 60, price: 2 }], {});
  const drawing = imported(base, { serverOffsetAt: () => 0, tickSize: 0.00001 });
  const { unwritten } = patchedOf(patchTradingViewLineTool(base, drawing, { ...drawing, props: { ...drawing.props, meridianOnly: 3 } }, { serverOffsetAt: () => 0 }));
  assert.deepEqual(unwritten, ['meridianOnly']);
  assert.equal(patchTradingViewLineTool(base, drawing, { ...drawing, type: 'ray' }, { serverOffsetAt: () => 0 }).kind, 'unwritable');
});

test('a position\'s third point, kept on the entry, moves with the entry', () => {
  const base = stored('LineToolRiskRewardLong', [{ time_t: T, offset: 0, price: 2.02574, interval: '240' }, { time_t: T, offset: 65, price: 2.02574, interval: '240' }, { time_t: T, offset: 0, price: 2.02574, interval: '240' }], { profitLevel: 200, stopLevel: 100 });
  const drawing = imported(base, { serverOffsetAt: () => 0, tickSize: 0.00001 });
  assert.equal(drawing.anchors[1].time, (T + 65 * 4 * 3600) * 1000);
  const [entry, target, stop] = drawing.anchors;
  const raised = { ...drawing, anchors: [{ ...entry, price: 2.03 }, { ...target, price: 2.032 }, { ...stop, price: 2.029 }] };
  const { tool } = patchedOf(patchTradingViewLineTool(base, drawing, raised, { serverOffsetAt: () => 0, tickSize: 0.00001 }));
  assert.deepEqual(tool.points, [
    { time_t: T, offset: 0, price: 2.03, interval: '240' },
    { time_t: T + 65 * 4 * 3600, offset: 0, price: 2.03, interval: '240' },
    { time_t: T, offset: 0, price: 2.03, interval: '240' },
  ]);
  const state = tool.state as Record<string, unknown>;
  assert.deepEqual([state.profitLevel, state.stopLevel], [200, 100]);
});

test('a newer four-point position moves its stop point with the stop, and every extra point with the entry', () => {
  const stopPrice = 2.02574 - 275 * 0.00001;
  const base = stored('LineToolRiskRewardLong', [
    { time_t: T, offset: 0, price: 2.02574, interval: '240' },
    { time_t: T + 7 * 86400, offset: 0, price: 2.02574, interval: '240' },
    { time_t: T, offset: 0, price: 2.02574, interval: '240' },
    { time_t: T + 8 * 3600, offset: 0, price: stopPrice, interval: '240' },
  ], { profitLevel: 2440, stopLevel: 275 });
  const drawing = imported(base, { serverOffsetAt: () => 0, tickSize: 0.00001 });
  const [entry, target, stop] = drawing.anchors;
  const edited = { ...drawing, anchors: [{ time: entry.time + 4 * 3600_000, price: entry.price }, target, { ...stop, price: 2.0220 }] };
  const { tool } = patchedOf(patchTradingViewLineTool(base, drawing, edited, { serverOffsetAt: () => 0, tickSize: 0.00001 }));
  const points = tool.points as { time_t: number; price: number }[];
  assert.deepEqual(points.map((point) => [point.time_t - T, Number(point.price.toFixed(5))]), [[4 * 3600, 2.02574], [7 * 86400, 2.02574], [4 * 3600, 2.02574], [12 * 3600, 2.022]]);
  const state = tool.state as Record<string, unknown>;
  assert.deepEqual([state.profitLevel, state.stopLevel], [2440, 374]);
});
