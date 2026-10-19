import { useEffect, useState } from 'react';
import { orderType, orderTypes, type OrderTypeKey } from '../../../shared/protocol';
import { distanceToPrice, distanceUnits, riskModes, type DistanceUnit, type RiskMode } from '../../../shared/risk';
import { chartTimeInput, parseChartTimeInput } from '../../lib/backtest/chart-time';
import { floatingProfit } from '../../lib/backtest/engine';
import type { PendingType, Side } from '../../lib/backtest/model';
import {
  activeBacktest,
  backtest,
  backtestMarket,
  backtestPending,
  backtestQuote,
  backtestRiskLots,
  cancelBacktestOrder,
  closeBacktestPosition,
  modifyBacktestOrder,
  modifyBacktestPosition,
  prepareSymbol,
  useActiveBacktest,
} from '../../lib/backtest/runtime';
import { simulationOf } from '../../lib/backtest/session-model';
import { formatMoney, formatPrice, formatTime, formatVolume, roundToStep } from '../../lib/format';
import { replay } from '../../lib/replay-session';
import { useStore } from '../../lib/store';
import { closeDialog, workspace } from '../../lib/workspace';
import { Segmented } from '../ui/Controls';
import { Dialog } from '../dialogs/Dialog';
import { PriceField } from '../dialogs/OrderDialog';

type TicketType = 'market' | PendingType;

const ticketTypes: readonly { key: TicketType; label: string }[] = [
  { key: 'market', label: 'Market' },
  ...orderTypes.filter((type) => type.isPending).map((type) => ({ key: type.key as PendingType, label: type.label })),
];

const isStopLimit = (type: TicketType) => type === 'buyStopLimit' || type === 'sellStopLimit';

// The symbols a ticket offers: the replaying charts' and every symbol the session has priced.
function useTicketSymbols(initial: string): string[] {
  const chartIds = useStore(replay, (state) => state.session?.chartIds ?? []);
  const charts = useStore(workspace, (state) => state.charts);
  const priced = useStore(backtest, (state) => Object.keys(activeBacktest(state)?.terms ?? {}));
  return [...new Set([initial, ...chartIds.map((id) => charts.find((chart) => chart.id === id)?.symbol ?? ''), ...priced])].filter(Boolean);
}

interface DistanceFieldProps {
  label: string;
  value: number;
  unit: DistanceUnit;
  digits: number;
  onChange: (value: number) => void;
}

function DistanceField({ label, value, unit, digits, onChange }: DistanceFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} step={unit === 'price' ? 10 ** -digits : 1} value={value || ''} placeholder={unit === 'price' ? 'none' : `none (${unit})`} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </label>
  );
}

interface BacktestOrderDialogProps {
  initialSymbol: string;
  initialType?: OrderTypeKey;
  initialPrice?: number;
}

export function BacktestOrderDialog({ initialSymbol, initialType, initialPrice }: BacktestOrderDialogProps) {
  const item = useActiveBacktest();
  const symbols = useTicketSymbols(initialSymbol);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [type, setType] = useState<TicketType>(initialType && orderType(initialType)?.isPending ? initialType as PendingType : 'market');
  const [mode, setMode] = useState<RiskMode>('lots');
  const [amount, setAmount] = useState(0.1);
  const [price, setPrice] = useState(initialPrice ?? 0);
  const [stopLimit, setStopLimit] = useState(0);
  const [unit, setUnit] = useState<DistanceUnit>('price');
  const [sl, setSl] = useState(0);
  const [tp, setTp] = useState(0);
  const [expiration, setExpiration] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const quote = useStore(backtest, (state) => backtestQuote(state, symbol));
  const terms = useStore(backtest, (state) => activeBacktest(state)?.terms[symbol]);
  const digits = terms?.digits ?? quote?.digits ?? 5;

  useEffect(() => {
    let isCurrent = true;
    setError(null);
    void prepareSymbol(symbol).then((problem) => { if (isCurrent && problem) setError(problem); });
    return () => { isCurrent = false; };
  }, [symbol]);

  useEffect(() => {
    if (quote && price === 0 && type !== 'market') setPrice(orderType(type)?.isBuy ? quote.ask : quote.bid);
  }, [quote, type, price]);

  if (!item) return <Dialog title="Backtest Order"><p>No backtest is running.</p></Dialog>;
  const limits = terms ? { digits: terms.digits, point: terms.point } : { digits, point: 10 ** -digits };
  const entryFor = (side: Side) => type === 'market' ? (quote ? (side === 'buy' ? quote.ask : quote.bid) : 0) : isStopLimit(type) ? stopLimit : price;
  const levels = (side: Side) => {
    const entry = entryFor(side);
    return {
      entry,
      sl: sl > 0 && entry > 0 ? distanceToPrice(side, entry, sl, unit, limits, true) : 0,
      tp: tp > 0 && entry > 0 ? distanceToPrice(side, entry, tp, unit, limits, false) : 0,
    };
  };
  const sizing = (side: Side) => {
    const { entry, sl: stop } = levels(side);
    if (mode === 'lots') return { lots: roundToStep(amount, terms?.volumeStep ?? 0.01), riskMoney: null, error: null };
    return backtestRiskLots(symbol, side, entry, stop, mode, amount);
  };
  const expiry = expiration ? parseChartTimeInput(expiration) ?? 0 : 0;

  const send = async (side: Side) => {
    const size = sizing(side);
    if (size.error) { setError(size.error); return; }
    const { sl: stop, tp: target } = levels(side);
    setIsBusy(true);
    const problem = type === 'market'
      ? await backtestMarket({ side, symbol, volume: size.lots, sl: stop, tp: target, comment })
      : await backtestPending({ type, symbol, volume: size.lots, price, stopLimit, sl: stop, tp: target, expiration: expiry, comment });
    setIsBusy(false);
    if (problem) setError(problem);
    else closeDialog();
  };

  const pendingSide: Side = type !== 'market' && orderType(type)?.isBuy ? 'buy' : 'sell';
  const preview = (side: Side) => {
    const size = sizing(side);
    const { entry, sl: stop, tp: target } = levels(side);
    if (size.error) return <span className="is-loss">{size.error}</span>;
    const reward = stop > 0 && target > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : 0;
    return (
      <span>
        {side === 'buy' ? 'Buy' : 'Sell'} <b>{formatVolume(size.lots)}</b> lots
        {stop > 0 && <> · SL <b>{formatPrice(stop, digits)}</b></>}
        {target > 0 && <> · TP <b>{formatPrice(target, digits)}</b></>}
        {size.riskMoney !== null && Number.isFinite(size.riskMoney) && <> · risk <b>{formatMoney(size.riskMoney)} {item.currency}</b></>}
        {reward > 0 && <> · <b>{reward.toFixed(2)}R</b></>}
      </span>
    );
  };

  return (
    <Dialog title={`Backtest Order: ${symbol}`} width={520}>
      <div className="order-form backtest-ticket">
        <p className="is-muted">Fills on the replay at {item.book.time ? formatTime(item.book.time, false) : 'its start'}, in the simulated account of {item.name}.</p>
        <label className="field">
          <span>Symbol</span>
          <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setPrice(0); setStopLimit(0); }}>
            {symbols.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(event) => { setType(event.target.value as TicketType); setPrice(0); }}>
            {ticketTypes.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
          </select>
        </label>
        <div className="field">
          <span>Size</span>
          <Segmented label="Size by" value={mode} options={riskModes} onChange={setMode} />
        </div>
        <label className="field">
          <span>{mode === 'lots' ? 'Volume' : 'Risk'}</span>
          <span className="input-with-suffix">
            <input type="number" min={0} step={mode === 'lots' ? terms?.volumeStep ?? 0.01 : mode === 'money' ? 10 : 0.1} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
            <em>{mode === 'lots' ? 'lots' : mode === 'money' ? item.currency : '%'}</em>
          </span>
        </label>
        {type !== 'market' && (
          <div className="field-pair">
            <PriceField label={isStopLimit(type) ? 'Stop price' : 'Price'} value={price} digits={digits} onChange={setPrice} />
            {isStopLimit(type) && <PriceField label="Limit price" value={stopLimit} digits={digits} onChange={setStopLimit} />}
          </div>
        )}
        <div className="field">
          <span>Stops in</span>
          <Segmented label="Stop loss and take profit in" value={unit} options={distanceUnits} onChange={(next) => { setUnit(next); setSl(0); setTp(0); }} />
        </div>
        <div className="field-pair">
          <DistanceField label="Stop Loss" value={sl} unit={unit} digits={digits} onChange={setSl} />
          <DistanceField label="Take Profit" value={tp} unit={unit} digits={digits} onChange={setTp} />
        </div>
        {type !== 'market' && (
          <label className="field">
            <span>Expiration</span>
            <input type="datetime-local" value={expiration} min={item.book.time ? chartTimeInput(item.book.time) : undefined} title="Chart time. Leave empty for good till cancelled." onChange={(event) => setExpiration(event.target.value)} />
          </label>
        )}
        <label className="field">
          <span>Comment</span>
          <input maxLength={31} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="order-quote" aria-label="Replay quote">
          <span className="is-sell">{formatPrice(quote?.bid, digits) || '-'}</span>
          <span>/</span>
          <span className="is-buy">{formatPrice(quote?.ask, digits) || '-'}</span>
        </div>
        <p className="order-check">{type === 'market' ? <>{preview('sell')}<br />{preview('buy')}</> : preview(pendingSide)}</p>
        {error && <p className="is-loss" role="alert">{error}</p>}
        {type === 'market' ? (
          <div className="dialog-actions is-split">
            <button className="is-sell" disabled={isBusy || !quote} onClick={() => void send('sell')}>Sell by Market</button>
            <button className="is-buy" disabled={isBusy || !quote} onClick={() => void send('buy')}>Buy by Market</button>
          </div>
        ) : (
          <div className="dialog-actions">
            <button className="is-primary" disabled={isBusy || !quote || price <= 0} onClick={() => void send(pendingSide)}>Place {orderType(type)?.label}</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface BacktestPositionDialogProps {
  ticket: number;
}

export function BacktestPositionDialog({ ticket }: BacktestPositionDialogProps) {
  const item = useActiveBacktest();
  const bids = useStore(backtest, (state) => state.bids);
  const position = item?.book.positions.find((candidate) => candidate.ticket === ticket);
  const [sl, setSl] = useState(position?.sl ?? 0);
  const [tp, setTp] = useState(position?.tp ?? 0);
  const [volume, setVolume] = useState(position?.volume ?? 0);
  const [error, setError] = useState<string | null>(null);
  if (!item || !position) return <Dialog title={`Position #${ticket}`}><p>Position #{ticket} is closed.</p><div className="dialog-actions"><button className="is-primary" onClick={closeDialog}>OK</button></div></Dialog>;
  const terms = item.terms[position.symbol];
  const digits = terms?.digits ?? 5;
  const profit = floatingProfit(simulationOf(item), position, bids);
  const run = (problem: string | null) => (problem ? setError(problem) : closeDialog());
  return (
    <Dialog title={`Backtest Position #${ticket}: ${position.side} ${formatVolume(position.volume)} ${position.symbol}`} width={460}>
      <div className="order-form backtest-ticket">
        <p>Opened {formatTime(position.time, false)} at <b>{formatPrice(position.priceOpen, digits)}</b>. Profit now <b className={profit && profit > 0 ? 'is-profit' : profit && profit < 0 ? 'is-loss' : ''}>{formatMoney(profit ?? undefined)} {item.currency}</b>.</p>
        <div className="field-pair">
          <PriceField label="Stop Loss" value={sl} digits={digits} onChange={setSl} />
          <PriceField label="Take Profit" value={tp} digits={digits} onChange={setTp} />
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={() => setSl(position.priceOpen)}>Stop to Break-even</button>
          <button type="button" className="is-primary" onClick={() => run(modifyBacktestPosition(ticket, sl, tp))}>Modify</button>
        </div>
        <label className="field">
          <span>Close volume</span>
          <input type="number" min={terms?.volumeMin} max={position.volume} step={terms?.volumeStep ?? 0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
        </label>
        {error && <p className="is-loss" role="alert">{error}</p>}
        <div className="dialog-actions is-split">
          <button type="button" className={position.side === 'buy' ? 'is-sell' : 'is-buy'} onClick={() => run(closeBacktestPosition(ticket, volume >= position.volume ? undefined : volume))}>
            Close {volume >= position.volume ? 'Position' : `${formatVolume(volume)} lots`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface BacktestOrderEditDialogProps {
  ticket: number;
}

export function BacktestOrderEditDialog({ ticket }: BacktestOrderEditDialogProps) {
  const item = useActiveBacktest();
  const order = item?.book.orders.find((candidate) => candidate.ticket === ticket);
  const [price, setPrice] = useState(order?.price ?? 0);
  const [stopLimit, setStopLimit] = useState(order?.stopLimit ?? 0);
  const [sl, setSl] = useState(order?.sl ?? 0);
  const [tp, setTp] = useState(order?.tp ?? 0);
  const [expiration, setExpiration] = useState(order?.expiration ? chartTimeInput(order.expiration) : '');
  const [error, setError] = useState<string | null>(null);
  if (!item || !order) return <Dialog title={`Order #${ticket}`}><p>Order #{ticket} is no longer pending.</p><div className="dialog-actions"><button className="is-primary" onClick={closeDialog}>OK</button></div></Dialog>;
  const digits = item.terms[order.symbol]?.digits ?? 5;
  const run = (problem: string | null) => (problem ? setError(problem) : closeDialog());
  const expiry = expiration ? parseChartTimeInput(expiration) ?? 0 : 0;
  return (
    <Dialog title={`Backtest Order #${ticket}: ${orderType(order.type)?.label} ${formatVolume(order.volume)} ${order.symbol}`} width={460}>
      <div className="order-form backtest-ticket">
        <div className="field-pair">
          <PriceField label={order.stopLimit ? 'Stop price' : 'Price'} value={price} digits={digits} onChange={setPrice} />
          {order.stopLimit > 0 && <PriceField label="Limit price" value={stopLimit} digits={digits} onChange={setStopLimit} />}
        </div>
        <div className="field-pair">
          <PriceField label="Stop Loss" value={sl} digits={digits} onChange={setSl} />
          <PriceField label="Take Profit" value={tp} digits={digits} onChange={setTp} />
        </div>
        <label className="field">
          <span>Expiration</span>
          <input type="datetime-local" value={expiration} title="Chart time. Leave empty for good till cancelled." onChange={(event) => setExpiration(event.target.value)} />
        </label>
        {error && <p className="is-loss" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={() => run(cancelBacktestOrder(ticket))}>Delete</button>
          <button type="button" className="is-primary" onClick={() => run(modifyBacktestOrder(ticket, { price, stopLimit, sl, tp, expiration: expiry }))}>Modify</button>
        </div>
      </div>
    </Dialog>
  );
}
