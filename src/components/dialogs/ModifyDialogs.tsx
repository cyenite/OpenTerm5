import { useState, type ReactNode } from 'react';
import { orderType, type TradeRequest, type TradeResult } from '../../../shared/protocol';
import { formatMoney, formatPrice, formatVolume } from '../../lib/format';
import { closePosition, sendOrder, session } from '../../lib/session';
import { useMoneyPerUnit } from '../../lib/valuation';
import { floorToStep } from '../../../shared/risk';
import { validateDrag } from '../../../shared/order-plan';
import { useStore } from '../../lib/store';
import { Dialog } from './Dialog';
import { Segmented } from '../ui/Controls';
import { runBulkTrades } from '../../lib/automation';
import { openDialog } from '../../lib/workspace';
import { PriceField, ResultView } from './OrderDialog';

const levelModes = [
  { key: 'price', label: 'Price' },
  { key: 'points', label: 'Points' },
  { key: 'money', label: 'Money' },
] as const;

type LevelMode = (typeof levelModes)[number]['key'];

interface LevelFieldProps {
  label: string;
  kind: 'sl' | 'tp';
  mode: LevelMode;
  value: number;
  side: 'buy' | 'sell';
  digits: number;
  point: number;
  volume: number;
  priceOpen: number;
  currency: string;
  moneyPerUnit: number | null;
  error: string | null;
  extra?: ReactNode;
  onChange: (value: number) => void;
}

// The level is always stored as a price; points and money are views of the distance from the open
// price, positive towards the loss for a stop and towards the profit for a target.
function LevelField({ label, kind, mode, value, side, digits, point, volume, priceOpen, currency, moneyPerUnit, error, extra, onChange }: LevelFieldProps) {
  const direction = (side === 'buy' ? 1 : -1) * (kind === 'sl' ? -1 : 1);
  const distance = value ? (value - priceOpen) * direction : 0;
  const perPrice = moneyPerUnit === null ? null : volume * moneyPerUnit;
  const money = perPrice === null || !value ? null : distance * perPrice;
  const points = Math.round(distance / point);
  const shown = !value ? '' : mode === 'price' ? Number(value.toFixed(digits)) : mode === 'points' ? points : money === null ? '' : Number(money.toFixed(2));
  const fromInput = (raw: number) => {
    if (!raw) return onChange(0);
    if (mode === 'price') return onChange(raw);
    const gap = mode === 'points' ? raw * point : perPrice ? raw / perPrice : 0;
    onChange(gap ? Number((priceOpen + gap * direction).toFixed(digits)) : 0);
  };
  const isMoneyUnavailable = mode === 'money' && perPrice === null;
  return (
    <div className={`level-field is-${kind}`}>
      <label htmlFor={`level-${kind}`}>{label}</label>
      <div className="level-input">
        <input
          id={`level-${kind}`}
          type="number"
          step={mode === 'price' ? point : mode === 'points' ? 1 : 1}
          value={shown}
          disabled={isMoneyUnavailable}
          placeholder={isMoneyUnavailable ? 'Valuation unavailable' : 'Not set'}
          onChange={(event) => fromInput(Number(event.target.value))}
        />
        {mode !== 'price' && <span className="level-unit">{mode === 'points' ? 'pts' : currency}</span>}
        {!!value && <button type="button" title={`Remove the ${label.toLowerCase()}`} aria-label={`Remove the ${label.toLowerCase()}`} onClick={() => onChange(0)}>×</button>}
      </div>
      <div className={`level-meta${error ? ' is-error' : ''}`}>
        {error ?? (value
          ? <>
              {mode !== 'price' && <span>{formatPrice(value, digits)}</span>}
              {mode !== 'money' && money !== null && <b className={kind === 'sl' ? (money > 0 ? 'is-loss' : 'is-profit') : 'is-profit'}>{kind === 'sl' ? (money > 0 ? '−' : '+') : '+'}{formatMoney(Math.abs(money))} {currency}</b>}
              {mode !== 'points' && <span>{points} pts</span>}
            </>
          : 'Not set')}
        {extra}
      </div>
    </div>
  );
}

interface ModifyPositionDialogProps {
  ticket: number;
}

export function ModifyPositionDialog({ ticket }: ModifyPositionDialogProps) {
  const position = useStore(session, (state) => state.positions.find((candidate) => candidate.ticket === ticket));
  const spec = useStore(session, (state) => (position ? state.symbols[position.symbol] : undefined));
  const tick = useStore(session, (state) => (position ? state.ticks[position.symbol] : undefined));
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  const balance = useStore(session, (state) => state.account?.balance ?? 0);
  const canCloseBy = useStore(session, (state) => !!position && !!state.account?.isHedging && state.account.isFifo === false && state.positions.some((other) => other.symbol === position.symbol && other.side !== position.side));
  const moneyPerUnit = useMoneyPerUnit(position?.symbol ?? '');
  const [sl, setSl] = useState(position?.sl ?? 0);
  const [tp, setTp] = useState(position?.tp ?? 0);
  const [mode, setMode] = useState<LevelMode>('price');
  const [volume, setVolume] = useState(position?.volume ?? 0);
  const [result, setResult] = useState<{ title: string; value: TradeResult | null } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (!position && !result) {
    return (
      <Dialog title={`Position #${ticket}`}>
        <p className="empty">This position is closed.</p>
      </Dialog>
    );
  }

  const run = async (title: string, action: () => Promise<TradeResult>) => {
    setIsBusy(true);
    setResult({ title, value: null });
    setResult({ title, value: await action() });
    setIsBusy(false);
  };

  if (!position) {
    return <Dialog title={`Position #${ticket}`} width={480}>{result && <ResultView title={result.title} result={result.value} onBack={() => setResult(null)} />}</Dialog>;
  }

  const digits = spec?.digits ?? 5;
  const point = spec?.point ?? 10 ** -digits;
  const step = spec?.volumeStep || 0.01;
  const minimum = spec?.volumeMin || step;
  const closePrice = (position.side === 'buy' ? tick?.bid : tick?.ask) ?? position.priceCurrent;
  const direction = position.side === 'buy' ? 1 : -1;
  const slError = sl ? validateDrag({ kind: 'sl', side: position.side, price: sl, reference: closePrice }) : null;
  const tpError = tp ? validateDrag({ kind: 'tp', side: position.side, price: tp, reference: closePrice }) : null;
  const isChanged = Math.abs(sl - position.sl) > point / 2 || Math.abs(tp - position.tp) > point / 2;
  const isVolumeValid = volume >= minimum - 1e-9 && volume <= position.volume + 1e-9;
  const profit = position.profit + position.swap;
  const percent = Math.round(volume / position.volume * 100);
  const toVolume = (share: number) => Math.min(position.volume, Math.max(minimum, floorToStep(position.volume * share / 100, step)));
  const risk = sl ? (position.priceOpen - sl) * direction : 0;
  const reward = tp ? (tp - position.priceOpen) * direction : 0;
  const riskMoney = moneyPerUnit !== null && risk > 0 ? risk * position.volume * moneyPerUnit : null;
  const isInProfit = (closePrice - position.priceOpen) * direction > 0;
  const closingProfit = profit * (isVolumeValid ? volume / position.volume : 0);
  // Position times are on the broker's server clock, like quote times, so compare the two.
  const openedFor = Math.max(0, (tick?.time ?? Date.now()) - position.time);
  const duration = openedFor < 3_600_000 ? `${Math.max(1, Math.round(openedFor / 60_000))} min` : openedFor < 86_400_000 ? `${Math.floor(openedFor / 3_600_000)} h ${Math.round(openedFor % 3_600_000 / 60_000)} min` : `${Math.floor(openedFor / 86_400_000)} d ${Math.floor(openedFor % 86_400_000 / 3_600_000)} h`;
  const reverse = async () => {
    if (!window.confirm(`Close #${ticket} and open ${formatVolume(position.volume)} ${position.symbol} ${position.side === 'buy' ? 'sell' : 'buy'}?`)) return;
    setIsBusy(true);
    setResult({ title: `Reverse #${ticket}`, value: null });
    try {
      const outcomes = await runBulkTrades(`Reverse #${ticket}`, { kind: 'reverse', ticket });
      const failed = outcomes.find((outcome) => !outcome.result.isSuccess);
      setResult({ title: `Reverse #${ticket}`, value: failed?.result ?? outcomes.at(-1)?.result ?? { retcode: 0, isSuccess: false, comment: 'Nothing was sent' } });
    } catch (error) {
      setResult({ title: `Reverse #${ticket}`, value: { retcode: 0, isSuccess: false, comment: (error as Error).message } });
    } finally { setIsBusy(false); }
  };

  return (
    <Dialog title={`Position #${ticket}`} width={480}>
      {result ? (
        <ResultView title={result.title} result={result.value} onBack={() => setResult(null)} />
      ) : (
        <div className="position-dialog">
          <header className="position-summary">
            <div className="position-title">
              <span className={`side-badge is-${position.side}`}>{position.side}</span>
              <b>{position.symbol}</b>
              <span>{formatVolume(position.volume)} lots</span>
              <span className="is-muted" title={new Date(position.time).toLocaleString()}>open {duration}</span>
            </div>
            <dl className="position-figures">
              <div><dt>Open</dt><dd>{formatPrice(position.priceOpen, digits)}</dd></div>
              <div><dt>Current</dt><dd>{formatPrice(closePrice, digits)}</dd></div>
              <div><dt>Profit</dt><dd className={profit >= 0 ? 'is-profit' : 'is-loss'}>{profit > 0 ? '+' : ''}{formatMoney(profit)} {currency}</dd></div>
              <div><dt>Points</dt><dd className={isInProfit ? 'is-profit' : 'is-loss'}>{Math.round((closePrice - position.priceOpen) * direction / point)}</dd></div>
            </dl>
            {(position.comment || position.swap !== 0) && <p className="is-muted position-note">{position.comment && <>Comment “{position.comment}”</>}{position.comment && position.swap !== 0 && ' · '}{position.swap !== 0 && <>Swap {formatMoney(position.swap)}</>}</p>}
          </header>

          <section className="position-section">
            <div className="section-heading">
              <h3>Stop loss and take profit</h3>
              <Segmented label="Enter levels as" value={mode} options={levelModes} onChange={setMode} />
            </div>
            <div className="level-grid">
              <LevelField
                label="Stop loss" kind="sl" mode={mode} value={sl} side={position.side} digits={digits} point={point} volume={position.volume}
                priceOpen={position.priceOpen} currency={currency} moneyPerUnit={moneyPerUnit} error={slError} onChange={setSl}
                extra={isInProfit && <button type="button" className="is-link" title="Move the stop loss to the open price" onClick={() => setSl(position.priceOpen)}>Break-even</button>}
              />
              <LevelField
                label="Take profit" kind="tp" mode={mode} value={tp} side={position.side} digits={digits} point={point} volume={position.volume}
                priceOpen={position.priceOpen} currency={currency} moneyPerUnit={moneyPerUnit} error={tpError} onChange={setTp}
                extra={risk > 0 && <span className="level-presets">{[1, 2, 3].map((multiple) => <button key={multiple} type="button" className="is-link" title={`Target ${multiple} times the stop distance`} onClick={() => setTp(Number((position.priceOpen + direction * risk * multiple).toFixed(digits)))}>{multiple}R</button>)}</span>}
              />
            </div>
            <p className="position-ratio">
              {risk > 0 && reward > 0 ? <>Risk : reward <b>1 : {(reward / risk).toFixed(2)}</b></> : risk > 0 ? 'Set a take profit to see the risk : reward.' : risk < 0 ? <>Stop loss locks in <b className="is-profit">{moneyPerUnit !== null ? `${formatMoney(-risk * position.volume * moneyPerUnit)} ${currency}` : `${Math.round(-risk / point)} pts`}</b>.</> : 'No stop loss: the loss on this position is not limited.'}
              {riskMoney !== null && balance > 0 && <> · At risk <b className="is-loss">{(riskMoney / balance * 100).toFixed(2)}%</b> of balance</>}
            </p>
            <div className="dialog-actions">
              <button type="button" disabled={!isChanged || isBusy} onClick={() => { setSl(position.sl); setTp(position.tp); }}>Reset</button>
              <button
                type="button"
                className="is-primary"
                disabled={isBusy || !isChanged || !!slError || !!tpError}
                onClick={() => run(`Modify #${ticket} sl ${sl ? formatPrice(sl, digits) : 'none'}, tp ${tp ? formatPrice(tp, digits) : 'none'}`, () => sendOrder({ action: 'sltp', symbol: position.symbol, position: ticket, sl, tp }))}
              >
                Modify
              </button>
            </div>
          </section>

          <section className="position-section">
            <div className="section-heading">
              <h3>Close</h3>
              <span className="is-muted">{percent}% of the position</span>
            </div>
            <div className="close-row">
              <input type="range" min={1} max={100} value={Math.min(100, Math.max(1, percent))} aria-label="Share of the position to close" onChange={(event) => setVolume(toVolume(Number(event.target.value)))} />
              <input type="number" min={minimum} max={position.volume} step={step} value={volume} aria-label="Volume to close" onChange={(event) => setVolume(Number(event.target.value))} />
            </div>
            <div className="segmented is-compact close-shares" role="group" aria-label="Close share">
              {[25, 50, 75, 100].map((share) => (
                <button key={share} type="button" className={Math.abs(volume - toVolume(share)) < 1e-9 ? 'is-active' : ''} onClick={() => setVolume(toVolume(share))}>{share === 100 ? 'All' : `${share}%`}</button>
              ))}
            </div>
            <button
              type="button"
              className={`close-button ${position.side === 'buy' ? 'is-sell' : 'is-buy'}`}
              disabled={isBusy || !isVolumeValid}
              onClick={() => run(`Close #${ticket} ${formatVolume(volume)} ${position.symbol}`, () => closePosition(position, volume))}
            >
              Close {formatVolume(volume)} lots at {formatPrice(closePrice, digits)}
              {isVolumeValid && <small>{closingProfit >= 0 ? '+' : ''}{formatMoney(closingProfit)} {currency}</small>}
            </button>
            {!isVolumeValid && <p className="is-loss level-meta">Volume must be between {formatVolume(minimum)} and {formatVolume(position.volume)}.</p>}
            {isVolumeValid && volume < position.volume && <p className="is-muted level-meta">{formatVolume(position.volume - volume)} lots stay open with the same stop loss and take profit.</p>}
          </section>

          <footer className="position-tools">
            <button type="button" className="is-link" onClick={() => openDialog({ kind: 'manage', ticket })}>Trailing stop, partial targets…</button>
            {canCloseBy && <button type="button" className="is-link" onClick={() => openDialog({ kind: 'closeBy', ticket })}>Close by opposite…</button>}
            <button type="button" className="is-link" disabled={isBusy} onClick={() => void reverse()}>Reverse</button>
            <button type="button" className="is-link" onClick={() => openDialog({ kind: 'order', symbol: position.symbol, type: position.side })}>Add to position…</button>
          </footer>
        </div>
      )}
    </Dialog>
  );
}

interface ModifyOrderDialogProps {
  ticket: number;
}

export function ModifyOrderDialog({ ticket }: ModifyOrderDialogProps) {
  const order = useStore(session, (state) => state.orders.find((candidate) => candidate.ticket === ticket));
  const digits = useStore(session, (state) => (order ? state.symbols[order.symbol]?.digits : undefined) ?? 5);
  const [price, setPrice] = useState(order?.priceOpen ?? 0);
  const [sl, setSl] = useState(order?.sl ?? 0);
  const [tp, setTp] = useState(order?.tp ?? 0);
  const [result, setResult] = useState<{ title: string; value: TradeResult | null } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (!order && !result) {
    return (
      <Dialog title={`Order #${ticket}`}>
        <p className="empty">This order is no longer pending.</p>
      </Dialog>
    );
  }

  const run = async (title: string, request: TradeRequest) => {
    setIsBusy(true);
    setResult({ title, value: null });
    setResult({ title, value: await sendOrder(request, title) });
    setIsBusy(false);
  };

  return (
    <Dialog title={order ? `Order #${ticket} ${orderType(order.type)?.label} ${formatVolume(order.volume)} ${order.symbol}` : `Order #${ticket}`} width={420}>
      {result ? (
        <ResultView title={result.title} result={result.value} onBack={() => setResult(null)} />
      ) : (
        order && (
          <div className="order-form">
            <PriceField label="Price" value={price} digits={digits} onChange={setPrice} />
            <div className="field-pair">
              <PriceField label="Stop Loss" value={sl} digits={digits} onChange={setSl} />
              <PriceField label="Take Profit" value={tp} digits={digits} onChange={setTp} />
            </div>
            <div className="dialog-actions">
              <button disabled={isBusy} onClick={() => run(`Delete order #${ticket}`, { action: 'remove', order: ticket })}>
                Delete
              </button>
              <button
                className="is-primary"
                disabled={isBusy || price <= 0}
                onClick={() => run(`Modify order #${ticket} at ${formatPrice(price, digits)}`, { action: 'modify', order: ticket, symbol: order.symbol, price, sl, tp, expiration: order.expiration })}
              >
                Modify
              </button>
            </div>
          </div>
        )
      )}
    </Dialog>
  );
}
