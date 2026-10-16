import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MeridianChart } from '@meridian/charts';
import { registerChart } from './chart-instances';
import { makeTab } from './chart-tabs';
import type { ChartTimeframe } from './mt5-timeframes';
import { exitReplay, followReplay, pickReplayStart, replay, replayInterval, setReplayInterval, startReplay, startReplayAt, stepReplay } from './replay';
import { updateInterval, updateIntervals } from './replay-model';
import { makeChart, workspace } from './workspace';

test('update intervals fit every chart of the layout, and auto picks the largest', () => {
  assert.deepEqual(updateIntervals(['H1', 'H4', 'D1']), ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M10', 'M12', 'M15', 'M20', 'M30', 'H1']);
  assert.equal(updateInterval(['H1', 'H4', 'D1'], null), 'H1');
  assert.equal(updateInterval(['M20', 'H1'], null), 'M20', 'M20 divides an hour, so it is the step');
  assert.deepEqual(updateIntervals(['W1', 'MN1']), ['D1']);
  assert.deepEqual(updateIntervals(['S5', 'M1']), ['S1', 'S5']);
  assert.equal(updateInterval(['H1'], 'M15'), 'M15');
  assert.equal(updateInterval(['M20', 'H1'], 'M15'), 'M10', 'a chosen step that no longer divides falls back to the largest shorter one');
  assert.equal(updateInterval([], null), null);
});

interface FakeEngine {
  readonly calls: string[];
  earliest: number | null;
  next: (after: number) => number | null;
  isSelecting: boolean;
}

function fakeEngine(earliest: number, next: (after: number) => number | null): { engine: MeridianChart; fake: FakeEngine } {
  const fake: FakeEngine = { calls: [], earliest, next, isSelecting: false };
  const off = () => () => undefined;
  const engine = {
    canUndo: () => false, canRedo: () => false, isReplaying: () => false, isObjectTreeShown: () => false,
    onHistoryChange: off, onReplayChange: off, onObjectTreeChange: off,
    selectReplayStart: () => { fake.isSelecting = true; fake.calls.push('select'); },
    cancelReplaySelection: () => { fake.isSelecting = false; fake.calls.push('cancel'); },
    isReplaySelecting: () => fake.isSelecting,
    setReplay: (state: { time: number; step: string | null } | null) => { fake.isSelecting = false; fake.calls.push(state ? `replay ${state.time} ${state.step}` : 'live'); },
    earliestReplayTime: () => fake.earliest,
    nextReplayTime: (after: number) => fake.next(after),
  };
  return { engine: engine as unknown as MeridianChart, fake };
}

function layout(timeframes: ChartTimeframe[]) {
  const charts = timeframes.map((timeframe) => makeChart('EURUSD', timeframe));
  workspace.set({ charts, tabs: [makeTab('tab', charts.map((chart) => chart.id), '2h')], activeTabId: 'tab', replayMode: 'allCharts' });
  return charts.map((chart) => chart.id);
}

test('one clock drives every chart: the pick clamps to data all charts have, and steps take the soonest bar end', () => {
  const [hourly, fourHourly] = layout(['H1', 'H4']);
  const hour = 3_600_000;
  const first = fakeEngine(10 * hour, (after) => (after < 40 * hour ? (Math.floor(after / hour) + 1) * hour : null));
  const second = fakeEngine(12 * hour, (after) => (after < 40 * hour ? (Math.floor(after / (4 * hour)) + 1) * 4 * hour : null));
  const unregister = [registerChart(hourly, first.engine), registerChart(fourHourly, second.engine)];

  startReplay();
  assert.deepEqual([first.fake.calls, second.fake.calls], [['select'], ['select']]);
  pickReplayStart(5 * hour);
  assert.equal(replay.get().session?.time, 12 * hour, 'the hourly chart cannot start before the four-hour chart has data');
  assert.equal(first.fake.calls.at(-1), `replay ${12 * hour} 60`, 'auto steps by the finest chart, H1');
  stepReplay();
  assert.equal(replay.get().session?.time, 13 * hour);
  assert.equal(second.fake.calls.at(-1), `replay ${13 * hour} 60`, 'the four-hour chart follows the hourly clock with a forming bar');

  setReplayInterval('M30');
  assert.equal(replayInterval(), 'M30');
  assert.equal(first.fake.calls.at(-1), `replay ${13 * hour} 30`);

  startReplayAt(39.5 * hour);
  stepReplay();
  stepReplay();
  const session = replay.get().session!;
  assert.deepEqual([session.time, session.isFinished, session.isPlaying], [40 * hour, true, false]);

  exitReplay();
  assert.equal(replay.get().session, null);
  assert.deepEqual([first.fake.calls.at(-1), second.fake.calls.at(-1)], ['live', 'live']);
  unregister.forEach((off) => off());
});

test('active chart mode replays one chart, and a chart without data that far back goes live', () => {
  const [left, right] = layout(['M15', 'M15']);
  const minute = 60_000;
  const leftEngine = fakeEngine(0, (after) => after + 15 * minute);
  const rightEngine = fakeEngine(0, (after) => after + 15 * minute);
  const unregister = [registerChart(left, leftEngine.engine), registerChart(right, rightEngine.engine)];

  workspace.set({ replayMode: 'activeChart' });
  startReplay(right);
  assert.deepEqual([leftEngine.fake.calls, rightEngine.fake.calls], [[], ['select']]);
  pickReplayStart(60 * minute);
  assert.deepEqual(replay.get().session?.chartIds, [right]);
  exitReplay();

  workspace.set({ replayMode: 'allCharts' });
  startReplay();
  pickReplayStart(60 * minute);
  rightEngine.fake.earliest = 90 * minute;
  followReplay(right);
  const session = replay.get().session!;
  assert.deepEqual(session.chartIds, [left]);
  assert.match(session.notice ?? '', /stays live/);
  assert.equal(rightEngine.fake.calls.at(-1), 'live');
  exitReplay();
  unregister.forEach((off) => off());
});
