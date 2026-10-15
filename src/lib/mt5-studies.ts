import { defineIndicator, type Bar, type InputValue, type StudyOutput, type StudyPlot } from '@meridian/charts';
import { adxWilder, atr, bollinger, cci, ema, ichimoku, indicatorKinds, macd, mfi, momentum, obv, parabolicSar, roc, rsi, sma, stochastic, williams, type IndicatorKey, type Point } from './indicators';

// MetaTrader's own indicator formulas, registered as Meridian studies so charts migrated from
// earlier versions keep their exact values, next to Meridian's wider built-in catalogue.

export const mt5StudyPrefix = 'mt5-';

export const mt5StudyType = (key: IndicatorKey) => `${mt5StudyPrefix}${key}`;

const colors = ['#2962ff', '#ff9800', '#e91e63', '#00bcd4', '#9c27b0'];
const fractional = new Set(['deviations', 'acceleration', 'maxAcceleration']);
const titles: Record<string, string> = {
  period: 'Period', slowing: 'Slowing', tenkan: 'Tenkan-sen', kijun: 'Kijun-sen', senkou: 'Senkou Span B', acceleration: 'Step',
  maxAcceleration: 'Maximum', deviations: 'Deviations', fast: 'Fast EMA', slow: 'Slow EMA', signal: 'Signal SMA', isExponential: 'Exponential',
};

type Bars = readonly Bar[];

function aligned(bars: Bars, points: readonly Point[]): (number | null)[] {
  const values = new Map(points.map((point) => [point.time, point.value]));
  return bars.map((bar) => values.get(bar.time) ?? null);
}

function line(bars: Bars, key: string, title: string, points: readonly Point[], color = colors[0], kind: StudyPlot['kind'] = 'line'): StudyPlot {
  return { key, title, values: aligned(bars, points), color, kind };
}

const level = (key: string, price: number) => ({ key, price, color: '#787b86' });

function compute(key: IndicatorKey, bars: Bars, inputs: Record<string, InputValue>): StudyOutput {
  const value = (name: string) => Number(inputs[name]);
  const candles = bars.map((bar) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 }));
  switch (key) {
    case 'ma': {
      const isExponential = inputs.isExponential === true;
      return { plots: [line(bars, 'ma', isExponential ? 'EMA' : 'MA', isExponential ? ema(candles, value('period')) : sma(candles, value('period')))] };
    }
    case 'bands': {
      const result = bollinger(candles, value('period'), value('deviations'));
      return {
        plots: [line(bars, 'upper', 'Upper', result.upper, colors[3]), line(bars, 'middle', 'Middle', result.middle, colors[1]), line(bars, 'lower', 'Lower', result.lower, colors[3])],
        bands: [{ key: 'range', from: 'upper', to: 'lower', color: 'rgba(0, 188, 212, 0.06)' }],
      };
    }
    case 'rsi':
      return { plots: [line(bars, 'rsi', 'RSI', rsi(candles, value('period')), colors[4])], levels: [level('high', 70), level('low', 30)] };
    case 'ichimoku': {
      const result = ichimoku(candles, value('tenkan'), value('kijun'), value('senkou'));
      // Span A and B are projected forward by candle index; values beyond the last bar are dropped.
      const projected = (points: { index: number; value: number }[]) => {
        const values = new Map(points.map((point) => [point.index, point.value]));
        return bars.map((_, index) => values.get(index) ?? null);
      };
      return {
        plots: [
          line(bars, 'tenkan', 'Tenkan-sen', result.tenkan, '#f23645'),
          line(bars, 'kijun', 'Kijun-sen', result.kijun, '#2962ff'),
          line(bars, 'chikou', 'Chikou Span', result.chikou, '#43a047'),
          { key: 'spanA', title: 'Senkou Span A', values: projected(result.spanA), color: '#26a69a' },
          { key: 'spanB', title: 'Senkou Span B', values: projected(result.spanB), color: '#ef5350' },
        ],
        bands: [{ key: 'cloud', from: 'spanA', to: 'spanB', color: 'rgba(120, 123, 134, 0.14)' }],
      };
    }
    case 'sar':
      return { plots: [line(bars, 'sar', 'SAR', parabolicSar(candles, value('acceleration'), value('maxAcceleration')), colors[1], 'circles')] };
    case 'atr':
      return { plots: [line(bars, 'atr', 'ATR', atr(candles, value('period')))] };
    case 'stochastic': {
      const result = stochastic(candles, value('period'), value('slowing'), value('signal'));
      return { plots: [line(bars, 'main', '%K', result.main), line(bars, 'signal', '%D', result.signal, colors[1])], levels: [level('high', 80), level('low', 20)] };
    }
    case 'cci':
      return { plots: [line(bars, 'cci', 'CCI', cci(candles, value('period')), colors[3])], levels: [level('high', 100), level('low', -100)] };
    case 'momentum':
      return { plots: [line(bars, 'momentum', 'Momentum', momentum(candles, value('period')), colors[3])], levels: [level('base', 100)] };
    case 'roc':
      return { plots: [line(bars, 'roc', 'ROC', roc(candles, value('period')), colors[3])], levels: [level('zero', 0)] };
    case 'wpr':
      return { plots: [line(bars, 'wpr', '%R', williams(candles, value('period')), colors[3])], levels: [level('high', -20), level('low', -80)] };
    case 'adxWilder': {
      const result = adxWilder(candles, value('period'));
      return { plots: [line(bars, 'adx', 'ADX', result.main, colors[0]), line(bars, 'plus', '+DI', result.plus, '#089981'), line(bars, 'minus', '-DI', result.minus, '#f23645')] };
    }
    case 'obv':
      return { plots: [line(bars, 'obv', 'OBV', obv(candles))] };
    case 'mfi':
      return { plots: [line(bars, 'mfi', 'MFI', mfi(candles, value('period')), colors[4])], levels: [level('high', 80), level('low', 20)] };
    case 'macd': {
      const result = macd(candles, value('fast'), value('slow'), value('signal'));
      return { plots: [line(bars, 'main', 'MACD', result.main, '#787b86', 'histogram'), line(bars, 'signal', 'Signal', result.signal, '#f23645')] };
    }
  }
}

let isRegistered = false;

export function registerMt5Studies(): void {
  if (isRegistered) return;
  isRegistered = true;
  for (const kind of indicatorKinds) {
    defineIndicator({
      type: mt5StudyType(kind.key),
      title: `${kind.label} (MT5)`,
      overlay: kind.isOverlay,
      inputs: Object.entries(kind.defaults as Record<string, number | boolean>).map(([key, value]) => typeof value === 'boolean'
        ? { key, title: titles[key] ?? key, type: 'bool' as const, default: value }
        : { key, title: titles[key] ?? key, type: fractional.has(key) ? 'float' as const : 'int' as const, default: value, min: fractional.has(key) ? 0.001 : 1, step: fractional.has(key) ? (key === 'deviations' ? 0.1 : 0.001) : 1 }),
      compute: (bars, inputs) => compute(kind.key, bars, inputs),
    });
  }
}
