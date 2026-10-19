import { useState } from 'react';
import { openMenuAt } from '../../lib/context-menu';
import { cancelReplaySelection, exitReplay, replay, replayInterval, replayIntervals, setReplayInterval, setReplaySpeed, startReplay, startReplayAt, stepReplay, toggleReplayPlay } from '../../lib/replay';
import { replaySpeeds } from '../../lib/replay-model';
import { useStore } from '../../lib/store';
import { workspace } from '../../lib/workspace';
import { backtest, endBacktest, jumpForward, jumpToSession } from '../../lib/backtest/runtime';
import { marketSessions } from '../../lib/market-sessions';
import type { MenuItem } from '../MenuBar';
import { ToolButton } from '../Toolbar';

const menuAbove = (event: React.MouseEvent<HTMLElement>, items: readonly MenuItem[]) => {
  const box = event.currentTarget.getBoundingClientRect();
  openMenuAt(box.left, box.top - 4, items);
};

// Chart times are broker times written as UTC, so the clock and the date field read them as UTC.
const formatTime = (time: number) => new Date(time).toISOString().slice(0, 16).replace('T', ' ');

// The layout's replay controls, under the charts as in TradingView: they drive every chart taking
// part at once.
export function ReplayToolbar() {
  const session = useStore(replay, (state) => state.session);
  const speed = useStore(workspace, (state) => state.replaySpeed);
  const [date, setDate] = useState<string | null>(null);
  const isBacktesting = useStore(backtest, (state) => !!state.activeId);
  if (!session) return null;
  const interval = replayInterval(session);
  const isRunning = session.time !== null && !session.isSelecting;
  // A backtest only moves forward, so it offers jumps ahead in place of an earlier start.
  const starts: MenuItem[] = isBacktesting ? [
    ...marketSessions.map((market) => ({ label: `Next ${market.label} Open`, action: () => void jumpToSession(market.key) })),
    { label: '', isSeparator: true },
    { label: 'Jump to Date...', action: () => setDate(session.time === null ? '' : formatTime(session.time).replace(' ', 'T')) },
    { label: 'Jump to End Date', isDisabled: !session.limit, action: () => session.limit && jumpForward(session.limit) },
  ] : [
    { label: 'Select Bar', action: () => startReplay() },
    { label: 'Select Date...', action: () => setDate(session.time === null ? '' : formatTime(session.time).replace(' ', 'T')) },
    { label: 'First Available Date', action: () => startReplayAt('first') },
    { label: 'Random Bar', action: () => startReplayAt('random') },
  ];
  const speeds: MenuItem[] = replaySpeeds.map((candidate) => ({ label: candidate.key, isChecked: candidate.key === speed, action: () => setReplaySpeed(candidate.key) }));
  const intervals: MenuItem[] = [
    { label: `Auto${!session.chosenInterval && interval ? ` (${interval})` : ''}`, isChecked: !session.chosenInterval, action: () => setReplayInterval(null) },
    { label: '', isSeparator: true },
    ...replayIntervals(session).map((candidate) => ({ label: candidate, isChecked: candidate === session.chosenInterval, action: () => setReplayInterval(candidate) })),
  ];
  const status = session.isSelecting
    ? `Click a bar on ${session.chartIds.length > 1 ? 'any chart' : 'the chart'} to start the replay${session.time === null ? '' : ', or press Escape to carry on'}`
    : session.time === null ? '' : formatTime(session.time);
  const goToDate = () => {
    const time = date ? Date.parse(`${date}Z`) : NaN;
    if (Number.isFinite(time)) {
      if (isBacktesting) jumpForward(time);
      else startReplayAt(time);
    }
    setDate(null);
  };

  return (
    <div className="replay-toolbar" role="toolbar" aria-label="Bar replay">
      {isBacktesting
        ? <ToolButton icon="stepForward" text="Jump To" hasMenu hint={{ title: 'Jump To', description: 'Move the backtest on to the next Sydney, Tokyo, London or New York open, or to a later date. Orders fill on the bars passed on the way.' }} onClick={(event) => menuAbove(event, starts)} />
        : <>
          <ToolButton icon="replay" text="Select Bar" hint={{ title: 'Select Bar', description: 'Pick a new start on any chart of the layout.' }} onClick={() => startReplay()} />
          <ToolButton hasMenu hint={{ title: 'Start From', description: 'A date, the first available bar or a random bar.' }} onClick={(event) => menuAbove(event, starts)} />
        </>}
      {date !== null && (
        <form className="replay-date" onSubmit={(event) => { event.preventDefault(); goToDate(); }}>
          <input type="datetime-local" aria-label={isBacktesting ? 'Jump to (chart time)' : 'Replay start (chart time)'} value={date} autoFocus onChange={(event) => setDate(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setDate(null); } }} />
          <button type="submit" className="is-primary">Go</button>
        </form>
      )}
      <span className="toolbar-divider" />
      <ToolButton icon={session.isPlaying ? 'pause' : 'play'} isDisabled={!isRunning || session.isFinished} hint={{ title: session.isPlaying ? 'Pause' : 'Play', shortcut: 'Shift+Down' }} onClick={toggleReplayPlay} />
      <ToolButton icon="stepForward" isDisabled={!isRunning || session.isFinished} hint={{ title: 'Forward', shortcut: 'Shift+Right', description: interval ? `Move every chart on by one ${interval} step.` : undefined }} onClick={stepReplay} />
      <ToolButton text={speed} hasMenu hint={{ title: 'Replay Speed', description: 'How fast Play steps the charts.' }} onClick={(event) => menuAbove(event, speeds)} />
      <ToolButton text={interval ?? 'Auto'} hasMenu isDisabled={!interval} hint={{ title: 'Update Interval', description: 'The step each update moves every chart by. Charts on longer timeframes show their current bar forming.' }} onClick={(event) => menuAbove(event, intervals)} />
      <span className="replay-status" aria-live="polite">{status}</span>
      {session.notice && <span className="replay-notice">{session.notice}</span>}
      <div className="toolbar-spacer" />
      {session.isSelecting && session.time !== null && <ToolButton text="Back to Replay" hint={{ title: 'Back to Replay', shortcut: 'Escape' }} onClick={cancelReplaySelection} />}
      <ToolButton icon="close" text="Exit Replay" textLevel={1} hint={{ title: 'Exit Bar Replay', description: isBacktesting ? 'Back to live charts. The backtest is saved; resume it from Backtesting.' : 'Back to live charts.' }} onClick={isBacktesting ? endBacktest : exitReplay} />
    </div>
  );
}
