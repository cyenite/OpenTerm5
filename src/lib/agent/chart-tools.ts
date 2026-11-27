import { getStudy, indicatorCatalogue, timeframeMs, toolGroups, type DrawingPoint, type MeridianChart, type SerializedDrawing } from '@meridian/charts';
import { styleFor, toolDefinitions } from '@meridian/charts/drawings/tools';
import type { AgentApi, AgentToolCall, AgentToolName } from '../../../shared/agent';
import { chartInstance } from '../chart-instances';
import { entryLabel, indicatorEntries } from '../indicator-catalog';
import { isChartTimeframe, parseTimeframe, toChartTimeframe, type ChartTimeframe } from '../mt5-timeframes';
import { pineScripts } from '../pine/pine-scripts';
import { isReplayingChart, replay } from '../replay-session';
import { activeChart, addIndicator, setChartTimeframe, tabOfChart, updateChart, workspace, type ChartConfig } from '../workspace';
import {
  agentDrawing, agentDrawingPrefix, barInterval, barRows, barSummary, describeDrawing, formatChartTime, isAgentDrawing, isHexColor, parseChartTime, pointsProblem, snapToBar,
} from './chart-tools-model';

declare global {
  interface Window {
    agent?: AgentApi;
  }
}

const LOAD_TIMEOUT_MS = 15_000;
const RELOAD_START_MS = 2_000;
const MAX_DRAWINGS_LISTED = 100;

type Args = Readonly<Record<string, unknown>>;

class ToolError extends Error {}

function fail(message: string): never {
  throw new ToolError(message);
}

function chartFor(args: Args): ChartConfig {
  const state = workspace.get();
  if (args.chartId === undefined) return activeChart(state) ?? fail('No chart is open.');
  return state.charts.find((chart) => chart.id === args.chartId) ?? fail(`There is no chart ${String(args.chartId)}; chart_state lists them.`);
}

function engineFor(chart: ChartConfig): MeridianChart {
  return chartInstance(chart.id) ?? fail(`Chart ${chart.id} (${chart.symbol}) is not on screen; open its layout first.`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ToolError(message)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadedEngine(chart: ChartConfig): Promise<MeridianChart> {
  const engine = engineFor(chart);
  await withTimeout(engine.ready(), LOAD_TIMEOUT_MS, `${chart.symbol} ${chart.timeframe} bars are still loading; a broker chart needs a logged-in account.`);
  return engine;
}

function chartSummary(chart: ChartConfig) {
  return { id: chart.id, symbol: chart.symbol, timeframe: chart.timeframe };
}

async function chartState(args: Args) {
  const state = workspace.get();
  const chart = chartFor(args);
  const engine = chartInstance(chart.id);
  const active = activeChart(state);
  const ids = tabOfChart(state, chart.id)?.chartIds ?? [chart.id];
  const layout = state.charts.filter((candidate) => ids.includes(candidate.id) && chartInstance(candidate.id)).map((candidate) => ({ ...chartSummary(candidate), isActive: candidate.id === active?.id }));
  const bars = engine?.bars() ?? [];
  const range = engine?.visibleRange();
  const drawings = engine?.drawings() ?? chart.drawings;
  return {
    chart: { ...chartSummary(chart), chartType: chart.type, isOnScreen: !!engine, isReplaying: isReplayingChart(replay.get().session, chart.id) },
    layout,
    visibleRange: range ? { from: formatChartTime(range.from), to: formatChartTime(range.to) } : null,
    lastBar: bars.length ? barRows(bars.slice(-1))[0] : null,
    loadedBars: bars.length,
    indicators: chart.indicators.map((indicator) => ({ id: indicator.id, type: indicator.kind, title: getStudy(indicator.kind)?.title ?? indicator.kind, inputs: indicator.params })),
    drawings: drawings.slice(-MAX_DRAWINGS_LISTED).map(describeDrawing),
    ...(drawings.length > MAX_DRAWINGS_LISTED ? { drawingsLeftOut: drawings.length - MAX_DRAWINGS_LISTED } : {}),
  };
}

async function getBars(args: Args) {
  const chart = chartFor(args);
  const engine = await loadedEngine(chart);
  const count = typeof args.count === 'number' && Number.isInteger(args.count) ? Math.min(2000, Math.max(1, args.count)) : 200;
  const bars = engine.bars().slice(-count);
  return { ...chartSummary(chart), columns: ['time', 'open', 'high', 'low', 'close', 'volume'], rows: barRows(bars), summary: barSummary(bars) };
}

function studyInputs(type: string) {
  return (getStudy(type)?.inputs ?? []).map((input) => ({
    key: input.key,
    title: input.title,
    type: input.type,
    default: input.default,
    ...(input.options ? { options: input.options } : {}),
    ...(input.min === undefined ? {} : { min: input.min }),
    ...(input.max === undefined ? {} : { max: input.max }),
  }));
}

function listIndicators(args: Args) {
  const entries = indicatorEntries(indicatorCatalogue(), pineScripts.get().scripts);
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  const describe = (entry: (typeof entries)[number]) => ({ type: entry.type, title: entryLabel(entry), overlay: entry.overlay });
  if (!query) return { indicators: entries.map(describe) };
  const matches = entries.filter((entry) => entry.title.toLowerCase().includes(query) || entry.type.toLowerCase().includes(query)).slice(0, 30);
  return { indicators: matches.map((entry) => ({ ...describe(entry), inputs: studyInputs(entry.type) })) };
}

function listDrawingTools() {
  return {
    tools: toolGroups.flatMap((group) => group.sections.flatMap((section) => section.tools.flatMap((tool) => {
      const definition = toolDefinitions.get(tool.type);
      if (!definition) return [];
      return [{
        type: tool.type,
        label: tool.label,
        group: section.title,
        points: definition.anchors,
        ...(definition.anchorNames ? { pointNames: definition.anchorNames } : {}),
        ...(definition.hasText ? { hasText: true } : {}),
      }];
    }))),
  };
}

async function setTimeframe(args: Args) {
  const chart = chartFor(args);
  const text = typeof args.timeframe === 'string' ? args.timeframe : fail('timeframe is required.');
  const timeframe: ChartTimeframe = parseTimeframe(text) ?? (isChartTimeframe(text) ? text : fail(`"${text}" is not a timeframe the terminal offers.`));
  if (isReplayingChart(replay.get().session, chart.id)) fail('The chart is in bar replay; changing its timeframe would end the replay.');
  const engine = engineFor(chart);
  const before = engine.ready();
  setChartTimeframe(chart.id, timeframe);
  if (chart.timeframe !== timeframe) {
    const started = Date.now();
    while (engine.ready() === before && Date.now() - started < RELOAD_START_MS) await wait(25);
  }
  const loaded = await loadedEngine({ ...chart, timeframe });
  const bars = loaded.bars();
  return { ...chartSummary({ ...chart, timeframe }), loadedBars: bars.length, lastBar: bars.length ? barRows(bars.slice(-1))[0] : null };
}

function addChartIndicator(args: Args) {
  const chart = chartFor(args);
  const type = typeof args.type === 'string' ? args.type : fail('type is required.');
  const study = getStudy(type) ?? fail(`There is no indicator "${type}"; list_indicators finds types.`);
  const inputs = (args.inputs ?? {}) as Record<string, unknown>;
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) fail('inputs must be an object.');
  const keys = new Set((study.inputs ?? []).map((input) => input.key));
  const unknown = Object.keys(inputs).filter((key) => !keys.has(key));
  if (unknown.length) fail(`${study.title} has no input ${unknown.join(', ')}; its inputs are ${[...keys].join(', ') || 'none'}.`);
  const values = Object.fromEntries(Object.entries(inputs).filter((entry): entry is [string, number | string | boolean] => ['number', 'string', 'boolean'].includes(typeof entry[1])));
  addIndicator(chart.id, type, values);
  return { added: { type, title: study.title, inputs: values }, chart: chartSummary(chart) };
}

function removeChartIndicator(args: Args) {
  const chart = chartFor(args);
  const indicator = chart.indicators.find((candidate) => candidate.id === args.id) ?? fail(`Chart ${chart.id} has no indicator ${String(args.id)}; chart_state lists them.`);
  updateChart(chart.id, (current) => ({ indicators: current.indicators.filter((candidate) => candidate.id !== indicator.id) }));
  return { removed: { id: indicator.id, type: indicator.kind } };
}

let drawingSeq = 0;

async function draw(args: Args) {
  const chart = chartFor(args);
  const engine = await loadedEngine(chart);
  const specs = Array.isArray(args.drawings) && args.drawings.length ? args.drawings as Args[] : fail('drawings must list at least one drawing.');
  if (specs.length > 50) fail('Draw at most 50 objects at a time.');
  const bars = engine.bars();
  const times = bars.map((bar) => bar.time);
  const interval = barInterval(bars, timeframeMs(toChartTimeframe(chart.timeframe)));
  const all = engine.drawings();
  let zIndex = all.reduce((top, drawing) => Math.max(top, drawing.zIndex), 0);
  const now = Date.now();
  const made = specs.map((spec, index): SerializedDrawing => {
    const where = specs.length > 1 ? `Drawing ${index + 1}: ` : '';
    const type = typeof spec.type === 'string' ? spec.type : fail(`${where}type is required.`);
    const definition = toolDefinitions.get(type) ?? fail(`${where}there is no drawing tool "${type}"; list_drawing_tools lists them.`);
    const points = Array.isArray(spec.points) ? spec.points as Args[] : fail(`${where}points are required.`);
    const problem = pointsProblem(type, definition.anchors, points.length);
    if (problem) fail(where + problem);
    const anchors = points.map((point, pointIndex): DrawingPoint => {
      const time = parseChartTime(point.time) ?? fail(`${where}point ${pointIndex + 1} has no readable time; use "YYYY-MM-DD HH:MM".`);
      const price = typeof point.price === 'number' && Number.isFinite(point.price) ? point.price : fail(`${where}point ${pointIndex + 1} needs a numeric price.`);
      return { time: snapToBar(time, times, interval), price };
    });
    if (spec.color !== undefined && !isHexColor(spec.color)) fail(`${where}color must be #rrggbb.`);
    const style = { ...styleFor(type), ...(isHexColor(spec.color) ? { lineColor: spec.color } : {}) };
    const text = definition.hasText ? (typeof spec.text === 'string' ? spec.text : definition.defaultText ?? '') : undefined;
    return agentDrawing({ id: `${agentDrawingPrefix}${now.toString(36)}-${(++drawingSeq).toString(36)}`, type, style, anchors, zIndex: ++zIndex, createdAt: now, ...(text === undefined ? {} : { text }) });
  });
  updateChart(chart.id, (current) => ({ drawings: [...current.drawings, ...made] }));
  return { drawn: made.map(describeDrawing), chart: chartSummary(chart) };
}

function removeAgentDrawings(args: Args) {
  const chart = chartFor(args);
  const ids = Array.isArray(args.ids) ? new Set(args.ids.map(String)) : null;
  const isRemoved = (drawing: SerializedDrawing) => isAgentDrawing(drawing) && (!ids || ids.has(drawing.id));
  const removed = chart.drawings.filter(isRemoved).map((drawing) => drawing.id);
  if (removed.length) updateChart(chart.id, (current) => ({ drawings: current.drawings.filter((drawing) => !isRemoved(drawing)) }));
  const userIds = ids ? [...ids].filter((id) => !removed.includes(id)) : [];
  return { removed, ...(userIds.length ? { notRemoved: userIds, reason: 'Only drawings the agent made can be removed this way.' } : {}) };
}

const executors: Record<AgentToolName, (args: Args) => unknown> = {
  chart_state: chartState,
  get_bars: getBars,
  list_indicators: listIndicators,
  list_drawing_tools: listDrawingTools,
  set_timeframe: setTimeframe,
  add_indicator: addChartIndicator,
  remove_indicator: removeChartIndicator,
  draw,
  remove_agent_drawings: removeAgentDrawings,
};

export async function runAgentTool(call: AgentToolCall): Promise<unknown> {
  const executor = executors[call.name] ?? fail(`Unknown tool ${String(call.name)}.`);
  return executor(call.args ?? {});
}

export function startAgentTools(): void {
  window.agent?.serve(runAgentTool);
}
