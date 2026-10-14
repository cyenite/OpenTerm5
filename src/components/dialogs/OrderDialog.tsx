import { useEffect, useState } from 'react';
import { orderType, orderTypes, type CheckResult, type OrderTypeKey, type TradeRequest, type TradeResult } from '../../../shared/protocol';
import { formatMoney, formatPrice, formatVolume, roundToStep } from '../../lib/format';
import { sendOrder, session, terminal } from '../../lib/session';
import { useWatchedSpecs } from '../../lib/watchlists';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';
import { TickChart } from './TickChart';
import { RiskTicket } from './RiskTicket';
import { Segmented } from '../ui/Controls';

const pendingTypes = orderTypes.filter((type) => type.isPending);

interface ResultViewProps {
  title: string;
  result: TradeResult | null;
  onBack: () => void;
}

export function ResultView({ title, result, onBack }: ResultViewProps) {
  if (!result) {
    return (
      <div className="order-result" role="status" aria-live="polite">
        <p>{title}</p>
        <p className="order-sending"><span className="spinner" aria-hidden /> Sending to the broker…</p>
      </div>
    );
  }
  return (
    <div className="order-result" role="status" aria-live="polite">
      <p className={result.isSuccess ? 'is-profit' : 'is-loss'}>{title}</p>
      <p>
        {result.comment} (retcode {result.retcode})
        {result.price ? ` at ${result.price}` : ''}
      </p>
      <div className="dialog-actions">
        {!result.isSuccess && <button onClick={onBack}>Back</button>}
        <button className="is-primary" onClick={closeDialog} autoFocus>
          OK
        </button>
      </div>
    </div>
  );
}

interface PriceFieldProps {
  label: string;
  value: number;
  digits: number;
  onChange: (value: number) => void;
}

export function PriceField({ label, value, digits, onChange }: PriceFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={10 ** -digits} min={0} value={value || ''} placeholder="0" onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </label>
  );
}

interface OrderDialogProps {
  initialSymbol: string;
  initialVolume?: number;
  initialPrice?: number;
  initialType?: OrderTypeKey;
}

export function OrderDialog({ initialSymbol, initialVolume, initialPrice, initialType }: OrderDialogProps) {
  const symbols = useWatchedSpecs();
  const [symbol, setSymbol] = useState(initialSymbol);
  const spec = useStore(session, (state) => state.symbols[symbol]);
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const canTrade = useStore(session, (state) => !!state.account && state.status?.isTradeAllowed === true && state.status?.capabilities?.trading === true && state.link.state === 'open');
  const [mode, setMode] = useState<'market' | 'pending'>(initialType && orderType(initialType)?.isPending ? 'pending' : 'market');
  const [pendingType, setPendingType] = useState<OrderTypeKey>(initialType ?? 'buyLimit');
  const [volume, setVolume] = useState(initialVolume ?? spec?.volumeMin ?? 0.01);
  const [price, setPrice] = useState(initialPrice ?? 0);
  const [stoplimit, setStoplimit] = useState(0);
  const [sl, setSl] = useState(0);
  const [tp, setTp] = useState(0);
  const [comment, setComment] = useState('');
  const [expiration, setExpiration] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [result, setResult] = useState<{ title: string; value: TradeResult | null } | null>(null);
  const [ticket, setTicket] = useState<'standard' | 'risk'>('standard');
  const digits = spec?.digits ?? 5;
  const step = spec?.volumeStep ?? 0.01;
  const isStopLimit = pendingType === 'buyStopLimit' || pendingType === 'sellStopLimit';

  useEffect(() => {
    if (tick && price === 0 && mode === 'pending') {
      setPrice(orderType(pendingType)?.isBuy ? tick.ask : tick.bid);
    }
  }, [mode, pendingType, tick, price]);

  useEffect(() => {
    if (!spec || volume <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      terminal
        .request('order.check', { action: 'deal', symbol, type: 'buy', volume })
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [symbol, volume, spec]);

  const submit = async (request: TradeRequest, title: string) => {
    setResult({ title, value: null });
    setResult({ title, value: await sendOrder(request, title) });
  };

  const market = (type: 'buy' | 'sell') => {
    const at = type === 'buy' ? tick?.ask : tick?.bid;
    void submit(
      { action: 'deal', symbol, type, volume, sl, tp, comment },
      `Market ${type} ${formatVolume(volume)} ${symbol}${at ? ` at ${formatPrice(at, digits)}` : ''}`,
    );
  };

  const place = () => {
    const expiry = expiration ? Math.floor(new Date(expiration).getTime() / 1000) : 0;
    void submit(
      { action: 'pending', symbol, type: pendingType, volume, price, stoplimit: isStopLimit ? stoplimit : 0, sl, tp, comment, expiration: expiry },
      `${orderType(pendingType)?.label} ${formatVolume(volume)} ${symbol} at ${formatPrice(price, digits)}`,
    );
  };

  const isVolumeValid = spec ? volume >= spec.volumeMin && volume <= spec.volumeMax : volume > 0;

  return (
    <Dialog title={`Order: ${symbol}${spec ? `, ${spec.description}` : ''}`} width={680}>
      {result ? (
        <ResultView title={result.title} result={result.value} onBack={() => setResult(null)} />
      ) : (
        <div className="order-dialog">
          <TickChart symbol={symbol} digits={digits} />
          <div className="order-form">
            <label className="field">
              <span>Symbol</span>
              <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                {[...new Set([symbol, ...symbols.map((candidate) => candidate.name)])].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <Segmented label="Ticket" value={ticket} options={[{ key: 'standard', label: 'Standard' }, { key: 'risk', label: 'Risk-based' }]} onChange={setTicket} />
            {ticket === 'risk' ? <RiskTicket symbol={symbol} canTrade={canTrade} onResult={(title, value) => setResult({ title, value })} /> : <>
            <label className="field">
              <span>Type</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as 'market' | 'pending')}>
                <option value="market">Market Execution</option>
                <option value="pending">Pending Order</option>
              </select>
            </label>
            <label className="field">
              <span>Volume</span>
              <input
                type="number"
                min={spec?.volumeMin}
                max={spec?.volumeMax}
                step={step}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                onBlur={() => setVolume(roundToStep(volume, step))}
              />
            </label>
            <div className="field-pair">
              <PriceField label="Stop Loss" value={sl} digits={digits} onChange={setSl} />
              <PriceField label="Take Profit" value={tp} digits={digits} onChange={setTp} />
            </div>
            <label className="field">
              <span>Comment</span>
              <input maxLength={31} value={comment} onChange={(event) => setComment(event.target.value)} />
            </label>
            {mode === 'pending' && (
              <>
                <label className="field">
                  <span>Type</span>
                  <select value={pendingType} onChange={(event) => setPendingType(event.target.value as OrderTypeKey)}>
                    {pendingTypes.map((type) => (
                      <option key={type.key} value={type.key}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field-pair">
                  <PriceField label="at price" value={price} digits={digits} onChange={setPrice} />
                  {isStopLimit && <PriceField label="Stop Limit price" value={stoplimit} digits={digits} onChange={setStoplimit} />}
                </div>
                <label className="field">
                  <span>Expiration</span>
                  <input type="datetime-local" value={expiration} onChange={(event) => setExpiration(event.target.value)} title="Leave empty for Good Till Cancelled" />
                </label>
              </>
            )}
            <p className="order-check">
              {check
                ? check.isSuccess
                  ? check.hasMarginEstimate === false ? check.comment : `Margin: ${formatMoney(check.margin)}  Free margin after: ${formatMoney(check.marginFree)}`
                  : check.comment
                : ''}
            </p>
            {mode === 'market' ? (
              <>
                <div className="order-quote">
                  <span className="is-sell">{formatPrice(tick?.bid, digits)}</span>
                  <span>/</span>
                  <span className="is-buy">{formatPrice(tick?.ask, digits)}</span>
                </div>
                <div className="dialog-actions is-split">
                  <button className="is-sell" disabled={!canTrade || !tick || !isVolumeValid} onClick={() => market('sell')}>
                    Sell by Market
                  </button>
                  <button className="is-buy" disabled={!canTrade || !tick || !isVolumeValid} onClick={() => market('buy')}>
                    Buy by Market
                  </button>
                </div>
                <p className="order-note">Attention! The trade will be executed at market conditions; the difference with the requested price may be significant.</p>
              </>
            ) : (
              <div className="dialog-actions">
                <button className="is-primary" disabled={!canTrade || !isVolumeValid || price <= 0} onClick={place}>
                  Place
                </button>
              </div>
            )}
            </>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
