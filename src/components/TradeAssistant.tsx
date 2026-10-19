import { useEffect, useRef, useState } from 'react';
import { plannerRiskModes, type BulkKind, type RiskOrderOutcome, type RiskOrderRequest } from '../../shared/automation';
import { orderType, type Position } from '../../shared/protocol';
import { distanceUnits } from '../../shared/risk';
import { placeRiskOrder, runBulkTrades } from '../lib/automation';
import { defaultSymbol } from '../lib/broker-symbols';
import { togglePanel } from '../lib/commands';
import { formatMoney, formatPrice, formatVolume } from '../lib/format';
import { replayTradingHint, useIsReplayingChart } from '../lib/replay-session';
import { useRiskPreview } from '../lib/risk-preview';
import { riskPreferences, setRiskPreferences } from '../lib/risk-preferences';
import { closePosition, session } from '../lib/session';
import { useStore } from '../lib/store';
import { assistantEntry, assistantPlan, assistantPreferences, assistantRequest, assistantTabs, chartSides, closeScopes, entryKinds, partialVolume, type AssistantPlan, type AssistantPreferences } from '../lib/trade-assistant';
import { activeChart, workspace } from '../lib/workspace';
import { Panel } from './Panel';
import { NumberField, Segmented, SelectField, Switch, TextField } from './ui/Controls';

interface Outcome {
  text: string;
  isGood: boolean | null;
}

const setPreferences = (patch: Partial<AssistantPreferences>) => assistantPreferences.set(patch);

function useCanTrade(): boolean {
  return useStore(session, (state) => !!state.account && state.status?.isTradeAllowed === true && state.status?.capabilities?.trading === true && state.link.state === 'open');
}

interface SummaryProps {
  symbol: string;
}

function Summary({ symbol }: SummaryProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const point = useStore(session, (state) => state.symbols[symbol]?.point);
  const account = useStore(session, (state) => state.account);
  const positions = useStore(session, (state) => state.positions.filter((position) => position.symbol === symbol));
  const spread = tick && point ? Math.round((tick.ask - tick.bid) / point) : null;
  const profit = positions.reduce((sum, position) => sum + position.profit + position.swap, 0);
  const lots = positions.reduce((sum, position) => sum + (position.side === 'buy' ? position.volume : -position.volume), 0);
  return (
    <div className="assistant-summary">
      <div>
        <strong>{symbol}</strong>
        <span>Spread {spread ?? '-'}</span>
        <span>{positions.length} open{positions.length ? `, net ${formatVolume(lots)}` : ''}</span>
        {positions.length > 0 && <span className={profit > 0 ? 'is-profit' : profit < 0 ? 'is-loss' : ''}>{formatMoney(profit)}</span>}
      </div>
      {account && (
        <div className="is-muted">
          <span>Balance {formatMoney(account.balance)}</span>
          <span>Equity {formatMoney(account.equity)} {account.currency}</span>
        </div>
      )}
    </div>
  );
}

interface SideButtonProps {
  side: 'buy' | 'sell';
  price: number | undefined;
  digits: number;
  preview: RiskOrderOutcome | null;
  problem: string | null;
  isBusy: boolean;
  isDisabled: boolean;
  onPlace: () => void;
}

function SideButton({ side, price, digits, preview, problem, isBusy, isDisabled, onPlace }: SideButtonProps) {
  return (
    <button
      type="button"
      className={`assistant-side is-${side}`}
      disabled={isDisabled || isBusy || !preview || !!problem}
      title={problem ?? undefined}
      aria-busy={isBusy}
      onClick={onPlace}
    >
      <span>{isBusy && <span className="spinner" aria-hidden />}{side === 'buy' ? 'Buy' : 'Sell'} {preview ? formatVolume(preview.lots) : ''}</span>
      <strong>{formatPrice(price, digits)}</strong>
    </button>
  );
}

interface PreviewTableProps {
  digits: number;
  currency: string;
  buy: RiskOrderOutcome | null;
  sell: RiskOrderOutcome | null;
  buyProblem: string | null;
  sellProblem: string | null;
}

function PreviewTable({ digits, currency, buy, sell, buyProblem, sellProblem }: PreviewTableProps) {
  const cell = (outcome: RiskOrderOutcome | null, problem: string | null, read: (value: RiskOrderOutcome) => string) =>
    problem ? '-' : outcome ? read(outcome) : '…';
  const rows: [string, (value: RiskOrderOutcome) => string][] = [
    ['Lots', (value) => formatVolume(value.lots)],
    ['Entry', (value) => formatPrice(value.entry, digits)],
    ['Stop', (value) => value.stopLoss ? formatPrice(value.stopLoss, digits) : 'none'],
    ['Targets', (value) => value.takeProfits.some(Boolean) ? value.takeProfits.map((price) => formatPrice(price, digits)).join('\n') : 'none'],
    ['Risk', (value) => Number.isFinite(value.riskMoney) ? `${formatMoney(value.riskMoney)}\u00a0${currency}` : 'unlimited'],
  ];
  const warnings = [...new Set([...(sell?.warnings ?? []), ...(buy?.warnings ?? [])])];
  const problems = [...new Set([sellProblem, buyProblem].filter((problem): problem is string => !!problem))];
  return (
    <div className="assistant-preview" aria-live="polite">
      <table className="grid details">
        <thead>
          <tr><th /><th className="side-sell">Sell</th><th className="side-buy">Buy</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, read]) => (
            <tr key={label}>
              <th>{label}</th>
              <td className="num">{cell(sell, sellProblem, read)}</td>
              <td className="num">{cell(buy, buyProblem, read)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {problems.map((problem) => <small key={problem} className="is-bad">{problem}</small>)}
      {warnings.map((warning) => <small key={warning}>{warning}</small>)}
    </div>
  );
}

// While a changed request is being priced the preview is empty; the last result for the symbol
// stays meanwhile, or the chart's plan lines would vanish under a drag on every step.
function useSteadyPreview(request: RiskOrderRequest, refresh: unknown, symbol: string) {
  const current = useRiskPreview(request, refresh);
  const last = useRef<{ symbol: string; result: typeof current } | null>(null);
  if (current.preview || current.problem) last.current = { symbol, result: current };
  return !current.preview && !current.problem && last.current?.symbol === symbol ? last.current.result : current;
}

interface SectionProps {
  symbol: string;
  canTrade: boolean;
  onOutcome: (outcome: Outcome) => void;
}

function TradeSection({ symbol, canTrade, onOutcome }: SectionProps) {
  const preferences = useStore(assistantPreferences, (state) => state);
  const risk = useStore(riskPreferences, (state) => state);
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const digits = useStore(session, (state) => state.symbols[symbol]?.digits ?? 5);
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  const price = useStore(assistantEntry, (state) => state.price);
  const [busySide, setBusySide] = useState<'buy' | 'sell' | null>(null);
  const isPending = preferences.entry !== 'market';
  const mode = plannerRiskModes.find((item) => item.key === risk.mode)!;

  const setPrice = (value: number) => assistantEntry.set({ price: value });
  useEffect(() => setPrice(0), [symbol]);
  useEffect(() => {
    if (isPending && price === 0 && tick) setPrice(Number(((tick.bid + tick.ask) / 2).toFixed(digits)));
  }, [isPending, price, tick, digits]);

  const buyRequest = assistantRequest({ side: 'buy', symbol, risk, preferences, price });
  const sellRequest = assistantRequest({ side: 'sell', symbol, risk, preferences, price });
  const refresh = isPending ? tick?.bid === undefined : `${tick?.bid}:${tick?.ask}`;
  const buy = useSteadyPreview(buyRequest, refresh, symbol);
  const sell = useSteadyPreview(sellRequest, refresh, symbol);
  const charted = preferences.chartSide === 'buy' ? buy : preferences.chartSide === 'sell' ? sell : null;
  const plan: AssistantPlan | null = charted?.preview && !charted.problem && preferences.chartSide !== 'off' ? {
    side: preferences.chartSide,
    symbol,
    lots: charted.preview.lots,
    entry: charted.preview.entry,
    stopLoss: charted.preview.stopLoss,
    riskMoney: charted.preview.riskMoney,
    takeProfits: charted.preview.takeProfits,
    isPending,
  } : null;
  const planKey = JSON.stringify(plan);
  useEffect(() => assistantPlan.set({ plan }), [planKey]);
  useEffect(() => () => assistantPlan.set({ plan: null }), []);

  const place = async (side: 'buy' | 'sell') => {
    const request = side === 'buy' ? buyRequest : sellRequest;
    const preview = side === 'buy' ? buy.preview : sell.preview;
    const label = `Assistant ${orderType(request.type)?.label.toLowerCase() ?? request.type} ${preview?.lots ?? ''} ${symbol}`.replace(/\s+/g, ' ');
    setBusySide(side);
    onOutcome({ text: `${label}…`, isGood: null });
    try {
      const outcome = await placeRiskOrder(label, request);
      const failed = outcome.results.length ? outcome.results.find((result) => !result.isSuccess) : { comment: 'no order was sent' };
      onOutcome(failed
        ? { text: `${label} failed: ${failed.comment}`, isGood: false }
        : { text: `${request.type} ${outcome.lots} ${symbol} placed, risk ${formatMoney(outcome.riskMoney)} ${currency}`, isGood: true });
    } catch (error) {
      onOutcome({ text: `${label} failed: ${(error as Error).message}`, isGood: false });
    } finally {
      setBusySide(null);
    }
  };

  return (
    <div className="assistant-section">
      <div className="assistant-grid">
        <SelectField label="Risk" value={risk.mode} options={plannerRiskModes} onChange={(value) => setRiskPreferences({ mode: value })} />
        <NumberField label="Amount" value={risk.value} step={risk.mode === 'money' ? 10 : 0.1} suffix={risk.mode === 'money' ? currency : mode.unit} onChange={(value) => setRiskPreferences({ value })} />
        <SelectField label="Stop in" value={preferences.unit} options={distanceUnits} onChange={(unit) => setPreferences({ unit })} />
        <NumberField label="Stop loss" value={preferences.stop} step={preferences.unit === 'price' ? 10 ** -digits : 1} hint="0 places no stop." onChange={(stop) => setPreferences({ stop })} />
        <TextField label="Targets (R)" value={preferences.targets} placeholder="2" hint="1, 2, 3 takes profit in parts." onChange={(targets) => setPreferences({ targets })} />
        <TextField label="Comment" value={preferences.comment} placeholder="None" onChange={(comment) => setPreferences({ comment })} />
      </div>
      <Segmented label="Entry" value={preferences.entry} options={entryKinds} onChange={(entry) => setPreferences({ entry })} />
      {isPending && <NumberField label="Entry price" value={price} step={10 ** -digits} hint="Buy and sell take the limit or stop side that suits this price." onChange={setPrice} />}
      <div className="assistant-lines">
        <span>Lines on chart</span>
        <Segmented label="Lines on chart" value={preferences.chartSide} options={chartSides} onChange={(chartSide) => setPreferences({ chartSide })} />
      </div>
      <PreviewTable digits={digits} currency={currency} buy={buy.preview} sell={sell.preview} buyProblem={buy.problem} sellProblem={sell.problem} />
      <div className="assistant-actions">
        <SideButton side="sell" price={tick?.bid} digits={digits} preview={sell.preview} problem={sell.problem} isBusy={busySide === 'sell'} isDisabled={!canTrade || !!busySide} onPlace={() => void place('sell')} />
        <SideButton side="buy" price={tick?.ask} digits={digits} preview={buy.preview} problem={buy.problem} isBusy={busySide === 'buy'} isDisabled={!canTrade || !!busySide} onPlace={() => void place('buy')} />
      </div>
      <button type="button" className="assistant-plan" disabled={!canTrade} title="Place the entry, stop and target by dragging lines on the chart" onClick={() => workspace.set({ tool: 'riskOrder' })}>
        Plan on chart…
      </button>
    </div>
  );
}

const closeActions: { kind: BulkKind; label: string; isConfirmed?: boolean }[] = [
  { kind: 'closeAll', label: 'Close all', isConfirmed: true },
  { kind: 'closeProfitable', label: 'Profitable' },
  { kind: 'closeLosing', label: 'Losing', isConfirmed: true },
  { kind: 'closeBuys', label: 'Buys' },
  { kind: 'closeSells', label: 'Sells' },
  { kind: 'deletePending', label: 'Pending orders', isConfirmed: true },
  { kind: 'breakEvenAll', label: 'Break-even' },
];

function CloseSection({ symbol, canTrade, onOutcome }: SectionProps) {
  const preferences = useStore(assistantPreferences, (state) => state);
  const scope = preferences.scope === 'symbol' ? symbol : undefined;
  const positions = useStore(session, (state) => state.positions.filter((position) => !scope || position.symbol === scope));
  const orders = useStore(session, (state) => state.orders.filter((order) => !scope || order.symbol === scope));
  const [isBusy, setIsBusy] = useState(false);
  const where = scope ?? 'every symbol';

  const run = async (action: (typeof closeActions)[number]) => {
    if (action.isConfirmed && !window.confirm(`${action.label} on ${where}?`)) return;
    const label = `${action.label} ${where}`;
    setIsBusy(true);
    onOutcome({ text: `${label}…`, isGood: null });
    try {
      const outcomes = await runBulkTrades(label, { kind: action.kind, ...(scope ? { symbol: scope } : {}) });
      const failed = outcomes.filter((outcome) => !outcome.result.isSuccess);
      onOutcome(failed.length
        ? { text: `${label}: ${failed.length} of ${outcomes.length} failed: ${failed[0].result.comment}`, isGood: false }
        : { text: `${label}: ${outcomes.length} done`, isGood: true });
    } catch (error) {
      onOutcome({ text: `${label} failed: ${(error as Error).message}`, isGood: false });
    } finally {
      setIsBusy(false);
    }
  };

  const closePart = async () => {
    const symbols = session.get().symbols;
    const parts = positions
      .map((position): [Position, number | null] => [position, symbols[position.symbol] ? partialVolume(position.volume, preferences.closePercent, symbols[position.symbol]) : null]);
    const label = `Close ${preferences.closePercent}% of ${where}`;
    const skipped = parts.filter(([, volume]) => volume === null).length;
    setIsBusy(true);
    onOutcome({ text: `${label}…`, isGood: null });
    try {
      const results = await Promise.all(parts.filter(([, volume]) => volume !== null).map(([position, volume]) => closePosition(position, volume!)));
      const failed = results.filter((result) => !result.isSuccess);
      const notes = [failed.length ? `${failed.length} failed: ${failed[0].comment}` : '', skipped ? `${skipped} too small to split` : ''].filter(Boolean).join(', ');
      onOutcome({ text: `${label}: ${results.length - failed.length} done${notes ? `, ${notes}` : ''}`, isGood: !failed.length && !skipped });
    } finally {
      setIsBusy(false);
    }
  };

  const isDisabled = !canTrade || isBusy;
  return (
    <div className="assistant-section">
      <Segmented label="Scope" value={preferences.scope} options={closeScopes} onChange={(value) => setPreferences({ scope: value })} />
      <p className="is-muted">{positions.length} position{positions.length === 1 ? '' : 's'} and {orders.length} pending order{orders.length === 1 ? '' : 's'} on {where}.</p>
      <div className="assistant-buttons">
        {closeActions.map((action) => (
          <button key={action.kind} type="button" disabled={isDisabled || (action.kind === 'deletePending' ? !orders.length : !positions.length)} onClick={() => void run(action)}>
            {action.label}
          </button>
        ))}
      </div>
      <div className="assistant-part">
        <NumberField label="Close in parts" value={preferences.closePercent} step={5} min={1} max={100} suffix="%" hint="Of every position in scope, in volume steps." onChange={(closePercent) => setPreferences({ closePercent })} />
        <button type="button" disabled={isDisabled || !positions.length || !(preferences.closePercent > 0)} onClick={() => void closePart()}>
          Close {preferences.closePercent}%
        </button>
      </div>
    </div>
  );
}

function ManageSection() {
  const preferences = useStore(assistantPreferences, (state) => state);
  const risk = useStore(riskPreferences, (state) => state);
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  return (
    <div className="assistant-section">
      <p className="is-muted">Applies to trades placed from the Trade Assistant. OpenTerm5 manages them while it runs.</p>
      <Switch label="Break-even after first target" hint="With several targets, later parts move their stop to entry when the first fills." isOn={preferences.isBreakEvenAfterFirst} onChange={(isBreakEvenAfterFirst) => setPreferences({ isBreakEvenAfterFirst })} />
      <NumberField label="Break-even at" value={preferences.breakEvenR} step={0.25} suffix="R" hint="Moves the stop to entry at this profit. 0 is off." onChange={(breakEvenR) => setPreferences({ breakEvenR })} />
      <NumberField label="Trailing stop" value={preferences.trailing} step={10} suffix="pts" hint="Starts once in profit by the same distance. 0 is off." onChange={(trailing) => setPreferences({ trailing })} />
      <Switch label="Hidden stops" hint="Stop and targets stay in OpenTerm5 and close at market; the broker sees none." isOn={preferences.isStealth} onChange={(isStealth) => setPreferences({ isStealth })} />
      <NumberField label="Commission per lot" value={risk.commissionPerLot} step={0.5} suffix={currency} hint="Round turn, counted inside the risk. Shared with the chart planner." onChange={(commissionPerLot) => setRiskPreferences({ commissionPerLot })} />
    </div>
  );
}

export function TradeAssistant() {
  const tab = useStore(assistantPreferences, (state) => state.tab);
  const chart = useStore(workspace, activeChart);
  const symbol = chart?.symbol ?? defaultSymbol();
  const isReplaying = useIsReplayingChart(chart?.id);
  const canTrade = useCanTrade() && !isReplaying;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  return (
    <Panel title="Trade Assistant" dock="tradeAssistant" onClose={() => togglePanel('isTradeAssistantShown')}>
      <div className="trade-assistant">
        <div className="panel-tabs is-top">
          {assistantTabs.map((candidate) => (
            <button key={candidate.key} className={tab === candidate.key ? 'is-active' : ''} onClick={() => setPreferences({ tab: candidate.key })}>
              {candidate.label}
            </button>
          ))}
        </div>
        <div className="scroll">
          <Summary symbol={symbol} />
          {isReplaying && <p className="assistant-outcome is-bad">{replayTradingHint}.</p>}
          {tab === 'trade' && <TradeSection symbol={symbol} canTrade={canTrade} onOutcome={setOutcome} />}
          {tab === 'close' && <CloseSection symbol={symbol} canTrade={canTrade} onOutcome={setOutcome} />}
          {tab === 'manage' && <ManageSection />}
          {outcome && (
            <p className={`assistant-outcome${outcome.isGood === true ? ' is-good' : outcome.isGood === false ? ' is-bad' : ''}`} role="status">
              {outcome.text}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
