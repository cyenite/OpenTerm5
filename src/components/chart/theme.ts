import type { ColorScheme } from '../../lib/workspace';

export interface ChartTheme {
  grid: string;
  text: string;
  line: string;
  askLine: string;
  bidLine: string;
  volumes: string;
  barUp: string;
  barDown: string;
  candleBull: string;
  candleBear: string;
  background: string;
  candleBorder: string;
  indicators: string[];
}

// Colours follow MT5's built-in chart schemes (Charts > Properties > Colors).
export const chartThemes: Record<ColorScheme, ChartTheme> = {
  greenOnBlack: {
    grid: '#2f3f46',
    text: '#ffffff',
    line: '#00ff00',
    askLine: '#ff0000',
    bidLine: '#778899',
    volumes: '#32cd32',
    barUp: '#00ff00',
    barDown: '#00ff00',
    candleBull: '#000000',
    candleBear: '#ffffff',
    background: '#000000',
    candleBorder: '#00ff00',
    indicators: ['#ff0000', '#ffd700', '#1e90ff', '#ff00ff', '#00ffff'],
  },
  colorOnWhite: {
    grid: '#e1e4e8',
    text: '#000000',
    line: '#000000',
    askLine: '#ff0000',
    bidLine: '#778899',
    volumes: '#32cd32',
    barUp: '#008000',
    barDown: '#ff0000',
    candleBull: '#ffffff',
    candleBear: '#000000',
    background: '#ffffff',
    candleBorder: '#000000',
    indicators: ['#ff0000', '#0000ff', '#ff8c00', '#8b008b', '#008b8b'],
  },
  blackOnWhite: {
    grid: '#d3d3d3',
    text: '#000000',
    line: '#000000',
    askLine: '#ff0000',
    bidLine: '#778899',
    volumes: '#000000',
    barUp: '#000000',
    barDown: '#000000',
    candleBull: '#ffffff',
    candleBear: '#000000',
    background: '#ffffff',
    candleBorder: '#000000',
    indicators: ['#ff0000', '#0000ff', '#ff8c00', '#8b008b', '#008b8b'],
  },
};
