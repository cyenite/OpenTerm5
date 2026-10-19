import { useState } from 'react';
import type { MenuItem } from '../MenuBar';
import { chartTimeInput, parseChartTimeInput } from '../../lib/backtest/chart-time';
import { backtest, dismissBacktestNotice, endBacktest, exitBacktestMode, jumpForward, jumpToSession, useActiveBacktest } from '../../lib/backtest/runtime';
import { openMenuAt } from '../../lib/context-menu';
import { formatTime } from '../../lib/format';
import { marketSessions } from '../../lib/market-sessions';
import { replay, replayInterval, replayIntervals, setReplayInterval, setReplaySpeed, stepReplay, toggleReplayPlay } from '../../lib/replay';
import { replaySpeeds } from '../../lib/replay-model';
import { useStore } from '../../lib/store';
import { placeBacktestOrder, togglePanel } from '../../lib/commands';
import { openDialog, workspace } from '../../lib/workspace';
import { ToolButton } from '../Toolbar';

const menuAbove = (event: React.MouseEvent<HTMLElement>, items: readonly MenuItem[]) => {
  const box = event.currentTarget.getBoundingClientRect();
  openMenuAt(box.left, box.top - 4, items);
};

// The running backtest's controls, floating over the charts so they take no room from them. The
// backtest runs on its own clock: bar replay stays off and the charts are not shaded.
export function BacktestTransport() {
  const item = useActiveBacktest();
  const session = useStore(replay, (state) => state.session);
  const speed = useStore(workspace, (state) => state.replaySpeed);
  const isPanelShown = useStore(workspace, (state) => state.isBacktestPanelShown);
  const isStarting = useStore(backtest, (state) => state.isStarting);
  const notice = useStore(backtest, (state) => state.notice);
  const isPlacing = useStore(workspace, (state) => state.tool === 'riskOrder');
  const [date, setDate] = useState<string | null>(null);
  if (!item || !session) {
    // Backtest mode before a session: start or resume one, or leave.
    return (
      <div className="backtest-transport" role="toolbar" aria-label="Backtest mode" onMouseDown={(event) => event.stopPropagation()}>
        <div className="backtest-transport-row">
          <span className="backtest-transport-name">Backtest mode</span>
          <span className="backtest-transport-clock">{isStarting ? 'Loading history…' : 'No session running'}</span>
          <span className="toolbar-divider" />
          <ToolButton icon="plus" text="New Session" isPrimary isDisabled={isStarting} hint={{ title: 'New Session', description: 'Choose a symbol, a start date, the balance and the costs.' }} onClick={() => openDialog({ kind: 'backtests' })} />
          <ToolButton icon="panels" isActive={isPanelShown} hint={{ title: isPanelShown ? 'Hide Sessions' : 'Show Sessions', description: 'Your saved sessions, to resume one.' }} onClick={() => togglePanel('isBacktestPanelShown')} />
          <ToolButton icon="exit" hint={{ title: 'Leave Backtest Mode', description: 'Go back to the layout you had.' }} onClick={exitBacktestMode} />
        </div>
        {notice && (
          <div className="backtest-transport-notice" role="status">
            <span>{notice}</span>
            <button type="button" className="row-close" aria-label="Dismiss" onClick={dismissBacktestNotice}>×</button>
          </div>
        )}
      </div>
    );
  }
  const time = session.time;
  const interval = replayInterval(session);
  const isRunning = time !== null && !isStarting;
  const isStopped = !isRunning || session.isFinished;
  const shown = notice ?? session.notice;
  const jumps: MenuItem[] = [
    ...marketSessions.map((market) => ({ label: `Next ${market.label} Open`, action: () => void jumpToSession(market.key) })),
    { label: '', isSeparator: true },
    { label: 'Jump to Date...', action: () => setDate(time === null ? '' : chartTimeInput(time)) },
    { label: 'Jump to End Date', isDisabled: !session.limit, action: () => session.limit && jumpForward(session.limit) },
  ];
  const speeds: MenuItem[] = replaySpeeds.map((candidate) => ({ label: candidate.key, isChecked: candidate.key === speed, action: () => setReplaySpeed(candidate.key) }));
  const intervals: MenuItem[] = [
    { label: `Auto${!session.chosenInterval && interval ? ` (${interval})` : ''}`, isChecked: !session.chosenInterval, action: () => setReplayInterval(null) },
    { label: '', isSeparator: true },
    ...replayIntervals(session).map((candidate) => ({ label: candidate, isChecked: candidate === session.chosenInterval, action: () => setReplayInterval(candidate) })),
  ];
  const jumpToDate = () => {
    const target = date ? parseChartTimeInput(date) : null;
    if (target !== null) jumpForward(target);
    setDate(null);
  };

  return (
    <div className="backtest-transport" role="toolbar" aria-label={`Backtest ${item.name}`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="backtest-transport-row">
        <span className="backtest-transport-name" title={item.name}>{item.name}</span>
        <span className="backtest-transport-clock" aria-live="polite">{isStarting ? 'Loading history…' : time === null ? '' : formatTime(time, false)}</span>
        <span className="toolbar-divider" />
        <ToolButton icon={session.isPlaying ? 'pause' : 'play'} isDisabled={isStopped} hint={{ title: session.isPlaying ? 'Pause' : 'Play', shortcut: 'Shift+Down' }} onClick={toggleReplayPlay} />
        <ToolButton icon="stepForward" isDisabled={isStopped} hint={{ title: 'Step', shortcut: 'Shift+Right', description: interval ? `Move every chart on by one ${interval} bar. Orders fill on the way.` : undefined }} onClick={stepReplay} />
        <ToolButton text={speed} hasMenu hint={{ title: 'Speed', description: 'How fast Play steps the charts.' }} onClick={(event) => menuAbove(event, speeds)} />
        <ToolButton text={interval ?? 'Auto'} hasMenu isDisabled={!interval} hint={{ title: 'Step Size', description: 'How far each step moves the clock. Charts on longer timeframes show their current bar forming.' }} onClick={(event) => menuAbove(event, intervals)} />
        <ToolButton icon="riskOrder" text="Place Order" isPrimary={!isPlacing} isActive={isPlacing} isDisabled={!isRunning} hint={{ title: 'Place Order', shortcut: 'F9', description: 'Drag the entry on the chart, then click the stop loss and take profit. Set the risk in the planner; the volume follows it.' }} onClick={() => (isPlacing ? workspace.set({ tool: 'cursor' }) : placeBacktestOrder())} />
        <span className="toolbar-divider" />
        <ToolButton text="Jump To" hasMenu isDisabled={!isRunning} hint={{ title: 'Jump To', description: 'The next Sydney, Tokyo, London or New York open, or a later date. Orders fill on every bar passed.' }} onClick={(event) => menuAbove(event, jumps)} />
        <span className="toolbar-divider" />
        <ToolButton icon="panels" isActive={isPanelShown} hint={{ title: isPanelShown ? 'Hide Analytics' : 'Show Analytics', description: 'The session panel: account, equity curve, trades and statistics.' }} onClick={() => togglePanel('isBacktestPanelShown')} />
        <ToolButton icon="exit" hint={{ title: 'End Session', description: 'Save the backtest and return the charts to live. Resume it any time from Backtest.' }} onClick={endBacktest} />
      </div>
      {date !== null && (
        <form className="backtest-transport-row" onSubmit={(event) => { event.preventDefault(); jumpToDate(); }}>
          <input type="datetime-local" aria-label="Jump to (chart time)" value={date} min={time === null ? undefined : chartTimeInput(time)} autoFocus onChange={(event) => setDate(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setDate(null); } }} />
          <button type="submit" className="is-primary">Jump</button>
          <button type="button" onClick={() => setDate(null)}>Cancel</button>
        </form>
      )}
      {shown && (
        <div className="backtest-transport-notice" role="status">
          <span>{shown}</span>
          {notice && <button type="button" className="row-close" aria-label="Dismiss" onClick={dismissBacktestNotice}>×</button>}
        </div>
      )}
    </div>
  );
}
