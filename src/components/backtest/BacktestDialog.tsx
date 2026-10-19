import { useState } from 'react';
import { formatMoney, formatTime } from '../../lib/format';
import { chartTimeInput, parseChartTimeInput } from '../../lib/backtest/chart-time';
import { defaultBacktestSettings, type BacktestSettings } from '../../lib/backtest/model';
import { backtest, createBacktest, deleteBacktest, renameBacktest, restartBacktest, resumeBacktest } from '../../lib/backtest/runtime';
import { settingsProblem, type BacktestSession } from '../../lib/backtest/session-model';
import { backtestStats } from '../../lib/backtest/stats';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { useWatchedSpecs } from '../../lib/watchlists';
import { activeChart, closeDialog, workspace } from '../../lib/workspace';
import { EmptyState, NumberField, SelectField, TextField } from '../ui/Controls';
import { Dialog } from '../dialogs/Dialog';

const DAY = 86_400_000;

const leverages = [10, 20, 30, 50, 100, 200, 300, 400, 500, 1000].map((value) => ({ key: String(value), label: `1:${value}` }));

const spreadModes = [
  { key: 'broker', label: "The broker's current spread" },
  { key: 'fixed', label: 'A fixed spread' },
] as const;

type SpreadMode = (typeof spreadModes)[number]['key'];

const profitClass = (value: number) => (value > 0 ? 'is-profit' : value < 0 ? 'is-loss' : '');

interface SessionRowProps {
  item: BacktestSession;
  isActive: boolean;
  isBusy: boolean;
  onResume: () => void;
  onRestart: () => void;
}

function SessionRow({ item, isActive, isBusy, onResume, onRestart }: SessionRowProps) {
  const [name, setName] = useState<string | null>(null);
  const stats = backtestStats(item.book, item.settings.balance);
  const net = item.book.balance - item.settings.balance;
  const rename = () => {
    if (name !== null) renameBacktest(item.id, name);
    setName(null);
  };
  return (
    <tr className={isActive ? 'is-active' : undefined} onDoubleClick={isActive ? undefined : onResume}>
      <td>
        {name === null
          ? <span title="Double-click to rename" onDoubleClick={(event) => { event.stopPropagation(); setName(item.name); }}>{item.name}{isActive && <em className="is-muted"> (running)</em>}</span>
          : <input value={name} autoFocus aria-label="Session name" onChange={(event) => setName(event.target.value)} onBlur={rename} onKeyDown={(event) => { if (event.key === 'Enter') rename(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setName(null); } }} />}
      </td>
      <td>{item.symbol} {item.timeframe}</td>
      <td>{formatTime(item.startTime, false)} to {formatTime(item.book.time ?? item.startTime, false)}</td>
      <td className="num">{stats.trades}</td>
      <td className={`num ${profitClass(net)}`}>{formatMoney(net)} {item.currency}</td>
      <td className="num">{stats.winRate === null ? '' : `${stats.winRate.toFixed(0)} %`}</td>
      <td className="num">{item.book.maxDrawdownPercent ? `${item.book.maxDrawdownPercent.toFixed(1)} %` : ''}</td>
      <td>
        <div className="backtest-row-actions">
          <button type="button" className="is-primary" disabled={isActive || isBusy} onClick={onResume}>Resume</button>
          <button type="button" disabled={isBusy} title="Start over from the start date with the starting balance" onClick={() => { if (window.confirm(`Restart "${item.name}"? Its trades are cleared and it starts again from ${formatTime(item.startTime, false)}.`)) onRestart(); }}>Restart</button>
          <button type="button" disabled={isBusy} onClick={() => { if (window.confirm(`Delete "${item.name}" and its trades?`)) deleteBacktest(item.id); }}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

interface NewSessionFormProps {
  isBusy: boolean;
  onStart: (start: () => Promise<void>) => void;
}

function NewSessionForm({ isBusy, onStart }: NewSessionFormProps) {
  const chart = useStore(workspace, activeChart);
  const account = useStore(session, (state) => state.account);
  const specs = useWatchedSpecs();
  const [symbol, setSymbol] = useState(chart?.symbol ?? specs[0]?.name ?? '');
  const [name, setName] = useState('');
  const [start, setStart] = useState(chartTimeInput(Math.floor((Date.now() - 30 * DAY) / DAY) * DAY));
  const [end, setEnd] = useState('');
  const [spreadMode, setSpreadMode] = useState<SpreadMode>('broker');
  const [settings, setSettings] = useState<BacktestSettings>({ ...defaultBacktestSettings, spreadPoints: null });
  const [fixedSpread, setFixedSpread] = useState(10);
  const patch = (change: Partial<BacktestSettings>) => setSettings((current) => ({ ...current, ...change }));
  const currency = account?.currency ?? '';
  const startTime = parseChartTimeInput(start);
  const endTime = end ? parseChartTimeInput(end) : null;
  const chosen = { ...settings, spreadPoints: spreadMode === 'fixed' ? fixedSpread : null };
  const problem = !account ? 'Log in to an account: a backtest replays its symbols and history.'
    : !symbol ? 'Choose a symbol.'
      : startTime === null ? 'Choose a start date.'
        : startTime >= Date.now() ? 'The start must be in the past.'
          : endTime !== null && endTime <= startTime ? 'The end must be after the start.'
            : settingsProblem(chosen);
  const symbols = [...new Set([symbol, ...specs.map((spec) => spec.name)])].filter(Boolean).map((value) => ({ key: value, label: value }));

  const submit = () => {
    if (problem || startTime === null || !account) return;
    onStart(() => createBacktest({
      name: name.trim() || `${symbol} from ${formatTime(startTime, false).slice(0, 10)}`,
      symbol,
      account: `${account.login} on ${account.server}`,
      currency,
      timeframe: chart?.timeframe ?? 'H1',
      startTime,
      endTime,
      settings: chosen,
    }));
  };

  return (
    <form className="backtest-form" noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="form-grid">
        <TextField label="Name" value={name} placeholder={symbol ? `${symbol} from ${start.slice(0, 10)}` : ''} onChange={setName} />
        <SelectField label="Symbol" value={symbol} options={symbols} hint="The active chart switches to it if the layout does not show it. Other charts of the layout trade in the session too." onChange={setSymbol} />
        <label className="form-field">
          <span>Start</span>
          <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          <small>Chart time. The replay starts at the first bar every chart has.</small>
        </label>
        <label className="form-field">
          <span>End (optional)</span>
          <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
          <small>The replay stops here. Leave empty to run to the latest bar.</small>
        </label>
        <NumberField label="Starting balance" value={settings.balance} step={1000} min={1} suffix={currency} onChange={(balance) => patch({ balance })} />
        <SelectField label="Leverage" value={String(settings.leverage)} options={leverages} onChange={(value) => patch({ leverage: Number(value) })} />
        <SelectField label="Spread" value={spreadMode} options={spreadModes} hint={spreadMode === 'broker' ? 'Each symbol keeps the spread it has when the session first prices it.' : 'The same number of points on every symbol.'} onChange={setSpreadMode} />
        {spreadMode === 'fixed' && <NumberField label="Fixed spread" value={fixedSpread} min={0} suffix="points" onChange={setFixedSpread} />}
        <NumberField label="Slippage" value={settings.slippagePoints} min={0} suffix="points" hint="Against you on market orders, stops and stop losses." onChange={(slippagePoints) => patch({ slippagePoints })} />
        <NumberField label="Commission" value={settings.commissionPerLot} step={0.5} min={0} suffix={`${currency} per lot, each side`} onChange={(commissionPerLot) => patch({ commissionPerLot })} />
        <NumberField label="Stop out" value={settings.stopOutLevel} min={0} suffix="% margin level" hint="0 turns stop outs off." onChange={(stopOutLevel) => patch({ stopOutLevel })} />
      </div>
      <div className="dialog-actions">
        {problem && <span className="backtest-form-problem">{problem}</span>}
        <button type="submit" className="is-primary" disabled={!!problem || isBusy}>{isBusy ? <><span className="spinner" aria-hidden /> Loading history…</> : 'Start Backtest'}</button>
      </div>
    </form>
  );
}

// Saved backtest sessions, and a new one. A session replays the active layout from its start,
// trading a simulated account.
export function BacktestDialog() {
  const sessions = useStore(backtest, (state) => state.sessions);
  const activeId = useStore(backtest, (state) => state.activeId);
  const [view, setView] = useState<'sessions' | 'new'>(sessions.length ? 'sessions' : 'new');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (start: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    start().then(closeDialog, (reason: Error) => setError(reason.message)).finally(() => setIsBusy(false));
  };

  return (
    <Dialog title="Backtesting" width={860}>
      <div className="backtest-dialog">
        <div className="segmented" role="tablist" aria-label="Backtesting">
          <button type="button" role="tab" aria-selected={view === 'sessions'} className={view === 'sessions' ? 'is-active' : ''} onClick={() => setView('sessions')}>Sessions ({sessions.length})</button>
          <button type="button" role="tab" aria-selected={view === 'new'} className={view === 'new' ? 'is-active' : ''} onClick={() => setView('new')}>New Session</button>
        </div>
        {error && <p className="banner is-warn" role="alert">{error}</p>}
        {view === 'new' ? <NewSessionForm isBusy={isBusy} onStart={run} /> : sessions.length ? (
          <div className="backtest-sessions scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Chart</th>
                  <th>Period so far</th>
                  <th className="num">Trades</th>
                  <th className="num">Net</th>
                  <th className="num">Win rate</th>
                  <th className="num">Max DD</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((item) => <SessionRow key={item.id} item={item} isActive={item.id === activeId} isBusy={isBusy} onResume={() => run(() => resumeBacktest(item.id))} onRestart={() => run(() => restartBacktest(item.id))} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No backtests yet" detail="A backtest replays history bar by bar while you trade a simulated account, then keeps the results so you can resume it later." action={<button type="button" className="is-primary" onClick={() => setView('new')}>New Session</button>} />
        )}
      </div>
    </Dialog>
  );
}
