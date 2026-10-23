import { useEffect, useRef, useState } from 'react';
import type { RiskOrderRequest } from '../../../shared/automation';
import { marketOfMode, orderType, type Market, type OrderTypeKey, type TradeResult } from '../../../shared/protocol';
import { distanceUnits, riskModes, type DistanceUnit, type RiskMode } from '../../../shared/risk';
import { placeRiskOrder } from '../../lib/automation';
import { formatMoney, formatPrice } from '../../lib/format';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { useRiskPreview } from '../../lib/risk-preview';
import { NumberField, Segmented, SelectField, Switch, TextField } from '../ui/Controls';
import { LeverageField } from './LeverageField';

interface RiskTicketProps {
  symbol: string;
  canTrade: boolean;
  onResult: (title: string, result: TradeResult | null) => void;
}

const entryKinds = [
  { key: 'market', label: 'Market' },
  { key: 'limit', label: 'Limit' },
  { key: 'stop', label: 'Stop' },
] as const;

type EntryKind = (typeof entryKinds)[number]['key'];

// Forex and crypto accounts keep separate settings: a pip stop or a per-lot commission means
// nothing on a crypto contract. Exchanges share theirs; the crypto key predates Binance.
const storageKeys: Record<Market, string> = { fx: 'openterm.riskTicket.v1', crypto: 'openterm.riskTicket.bybit.v1' };

interface Preferences {
  mode: RiskMode;
  value: number;
  unit: DistanceUnit;
  stop: number;
  targets: string;
  commission: number;
  breakEvenR: number;
  trailing: number;
  isStealth: boolean;
  isBreakEvenAfterFirst: boolean;
}

function loadPreferences(market: Market): Preferences {
  const fallback: Preferences = market === 'fx'
    ? { mode: 'percentBalance', value: 1, unit: 'pips', stop: 20, targets: '1, 2', commission: 0, breakEvenR: 0, trailing: 0, isStealth: false, isBreakEvenAfterFirst: true }
    : { mode: 'percentBalance', value: 1, unit: 'percent', stop: 1, targets: '1, 2', commission: 0, breakEvenR: 0, trailing: 0, isStealth: false, isBreakEvenAfterFirst: true };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(storageKeys[market]) ?? '{}') }; }
  catch { return fallback; }
}

export function RiskTicket(props: RiskTicketProps) {
  const market = useStore(session, (state) => marketOfMode(state.status?.mode));
  return <RiskTicketForm key={market} market={market} {...props} />;
}

interface RiskTicketFormProps extends RiskTicketProps {
  market: Market;
}

function RiskTicketForm({ symbol, canTrade, market, onResult }: RiskTicketFormProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const digits = useStore(session, (state) => state.symbols[symbol]?.digits ?? 5);
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  const baseCurrency = useStore(session, (state) => state.symbols[symbol]?.currencyBase ?? '');
  const isExchange = market === 'crypto';
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [entry, setEntry] = useState<EntryKind>('market');
  const [price, setPrice] = useState(0);
  const [preferences, setPreferences] = useState(() => loadPreferences(market));
  const [isBusy, setIsBusy] = useState(false);
  const [leverageVersion, setLeverageVersion] = useState(0);
  const unit = isExchange ? baseCurrency : 'lots';
  const set = (patch: Partial<Preferences>) => setPreferences({ ...preferences, ...patch });

  useEffect(() => {
    try { localStorage.setItem(storageKeys[market], JSON.stringify(preferences)); }
    catch { /* preferences are a convenience */ }
  }, [preferences, market]);

  // The entry price belongs to the symbol it was set for; another symbol starts from its own quote.
  const pricedSymbol = useRef(symbol);
  useEffect(() => {
    if (pricedSymbol.current === symbol) return;
    pricedSymbol.current = symbol;
    setPrice(0);
  }, [symbol]);

  useEffect(() => {
    if (entry !== 'market' && price === 0 && tick) setPrice(side === 'buy' ? tick.ask : tick.bid);
  }, [entry, price, tick, side]);

  const type: OrderTypeKey = entry === 'market' ? side : `${side}${entry === 'limit' ? 'Limit' : 'Stop'}` as OrderTypeKey;
  const multiples = preferences.targets.split(',').map((item) => Number(item.trim())).filter((value) => value > 0).slice(0, 5);
  const request: RiskOrderRequest = {
    type, symbol, mode: preferences.mode, value: preferences.value,
    ...(entry !== 'market' ? { price } : {}),
    ...(preferences.stop > 0 ? { stopLoss: { unit: preferences.unit, value: preferences.stop } } : {}),
    ...(multiples.length && preferences.stop > 0 ? { takeProfitR: multiples } : {}),
    commissionPerLot: isExchange ? undefined : preferences.commission || undefined,
    management: {
      isStealth: preferences.isStealth,
      isBreakEvenAfterFirstTarget: preferences.isBreakEvenAfterFirst && multiples.length > 1,
      ...(preferences.breakEvenR > 0 ? { breakEvenR: preferences.breakEvenR } : {}),
      ...(preferences.trailing > 0 ? { trailing: { startPoints: preferences.trailing, distancePoints: preferences.trailing, stepPoints: 10 } } : {}),
    },
  };
  const { preview, problem } = useRiskPreview(request, `${entry === 'market' ? `${tick?.bid}:${tick?.ask}` : tick?.bid === undefined}:${leverageVersion}`);

  const place = async () => {
    const label = `Risk ${orderType(type)?.label.toLowerCase() ?? type} ${preview?.lots ?? ''} ${symbol}`.replace(/\s+/g, ' ');
    setIsBusy(true);
    onResult(label, null);
    try {
      const outcome = await placeRiskOrder(label, request);
      const failed = outcome.results.find((result) => !result.isSuccess);
      onResult(
        `${type} ${outcome.lots} ${symbol} in ${outcome.results.length} order${outcome.results.length === 1 ? '' : 's'}, risk ${formatMoney(outcome.riskMoney)} ${currency}`,
        failed ?? { ...outcome.results[0], comment: outcome.results.map((result) => result.comment).join('; ') },
      );
    } catch (error) {
      onResult(`${type} ${symbol}`, { retcode: 0, isSuccess: false, comment: (error as Error).message });
    } finally { setIsBusy(false); }
  };

  return (
    <div className="risk-ticket">
      <div className="risk-row">
        <Segmented label="Side" value={side} options={[{ key: 'buy', label: 'Buy' }, { key: 'sell', label: 'Sell' }]} onChange={setSide} />
        <Segmented label="Entry" value={entry} options={entryKinds} onChange={setEntry} />
      </div>
      {entry !== 'market' && <NumberField label="Entry price" value={price} step={10 ** -digits} onChange={setPrice} />}
      <div className="form-grid">
        <SelectField label="Risk" value={preferences.mode} options={riskModes} onChange={(mode) => set({ mode })} />
        <NumberField label="Amount" value={preferences.value} step={preferences.mode === 'lots' ? 0.01 : 0.1} suffix={preferences.mode === 'money' ? currency : riskModes.find((mode) => mode.key === preferences.mode)?.unit} onChange={(value) => set({ value })} />
        <SelectField label="Stop in" value={preferences.unit} options={distanceUnits} onChange={(unit) => set({ unit })} />
        <NumberField label="Stop loss" value={preferences.stop} step={preferences.unit === 'price' ? 10 ** -digits : preferences.unit === 'percent' ? 0.1 : 1} suffix={preferences.unit === 'percent' ? '%' : undefined} onChange={(stop) => set({ stop })} />
        <TextField label="Targets (R)" value={preferences.targets} placeholder="1, 2, 3" hint="Multiples of the stop distance. Volume is split evenly across targets." onChange={(targets) => set({ targets })} />
        {isExchange
          ? <LeverageField symbol={symbol} suggested={preview?.safeLeverage} onChanged={() => setLeverageVersion((version) => version + 1)} />
          : <NumberField label="Commission per lot" value={preferences.commission} step={0.5} suffix={currency} hint="Round turn. Counted inside the risk." onChange={(commission) => set({ commission })} />}
      </div>
      <details className="reference">
        <summary>Management</summary>
        <div className="form-grid">
          <Switch label="Break-even after first target" hint="Later legs move to entry when the first target fills." isOn={preferences.isBreakEvenAfterFirst} onChange={(isBreakEvenAfterFirst) => set({ isBreakEvenAfterFirst })} />
          <NumberField label="Break-even at" value={preferences.breakEvenR} step={0.25} suffix="R" hint="0 is off." onChange={(breakEvenR) => set({ breakEvenR })} />
          <NumberField label="Trailing stop" value={preferences.trailing} step={10} suffix="pts" hint="Starts once in profit by the same distance. 0 is off." onChange={(trailing) => set({ trailing })} />
          <Switch label="Hidden stops" hint="Stop and targets stay in OpenTerm5 and close at market; the broker sees none. Only while the app runs." isOn={preferences.isStealth} onChange={(isStealth) => set({ isStealth })} />
        </div>
      </details>
      <div className={`risk-preview${problem ? ' is-bad' : ''}`} aria-live="polite">
        {problem ? <span>{problem}</span> : preview ? (
          <>
            <span><b>{preview.lots}</b> {unit}</span>
            <span>Entry <b>{formatPrice(preview.entry, digits)}</b></span>
            <span>Stop <b>{preview.stopLoss ? formatPrice(preview.stopLoss, digits) : 'none'}</b></span>
            <span>Risk <b>{Number.isFinite(preview.riskMoney) ? `${formatMoney(preview.riskMoney)} ${currency}` : 'unlimited'}</b></span>
            {preview.leverage !== undefined && <span>Margin <b>{formatMoney(preview.margin ?? Number.NaN)} {currency}</b> at {preview.leverage}x</span>}
            {preview.liquidationPrice === 0 && <span>No liquidation at this size</span>}
            {!!preview.liquidationPrice && <span>Liquidation about <b>{formatPrice(preview.liquidationPrice, digits)}</b></span>}
            {preview.takeProfits.some(Boolean) && <span>Targets <b>{preview.takeProfits.map((value) => formatPrice(value, digits)).join(' / ')}</b></span>}
            {preview.warnings.map((warning) => <small key={warning}>{warning}</small>)}
            {isExchange && <small className="is-muted">Risk includes the exchange's taker fee on the entry and at the stop.</small>}
          </>
        ) : <span className="is-muted">Calculating…</span>}
      </div>
      <div className="dialog-actions is-split">
        <button type="button" className={side === 'buy' ? 'is-buy' : 'is-sell'} disabled={!canTrade || isBusy || !preview || !!problem} onClick={() => void place()}>
          {side === 'buy' ? 'Buy' : 'Sell'} {preview ? `${preview.lots} ${unit}` : ''} with {preferences.mode === 'lots' ? 'fixed size' : 'risk sizing'}
        </button>
      </div>
    </div>
  );
}
