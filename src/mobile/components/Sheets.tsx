import { useEffect, useState, type ReactNode } from 'react';
import { plannerRiskModes, type PlannerRiskMode, type RiskOrderOutcome, type RiskOrderRequest } from '../../../shared/automation';
import type { Position } from '../../../shared/protocol';
import { placeRiskOrder } from '../../lib/automation';
import { formatMoney, formatPrice, formatVolume, roundToStep } from '../../lib/format';
import { closePosition, sendOrder, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { bridge, canTrade, requestChart } from '../bridge';
import { closeSheet, navigation, type MobileSheet } from '../navigation';
import { ConfirmButton } from './ConfirmButton';

const sizings = [
  { key: 'risk', label: 'By risk' },
  { key: 'lots', label: 'Lots' },
] as const;

type Sizing = (typeof sizings)[number]['key'];

const PREVIEW_MS = 400;
const priceOf = (text: string) => {
  const value = Number(text.replace(',', '.'));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : undefined;
};

interface SheetProps {
  title: string;
  children: ReactNode;
}

function Sheet({ title, children }: SheetProps) {
  return (
    <div className="phone-sheet-backdrop" onClick={(event) => event.target === event.currentTarget && closeSheet()}>
      <div className="phone-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="phone-sheet-head"><h2>{title}</h2><button type="button" className="phone-icon-button" aria-label="Close" onClick={closeSheet}>×</button></header>
        {children}
      </div>
    </div>
  );
}

interface PriceFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function PriceField({ label, value, placeholder, onChange }: PriceFieldProps) {
  return (
    <label className="phone-field">
      <span>{label}</span>
      <input type="text" inputMode="decimal" value={value} placeholder={placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

interface OrderSheetProps {
  symbol: string;
  side: Position['side'];
}

// A market order, sized by lots or by the risk to the stop loss. Every order goes through the
// computer, so its guards and the risk sizing use the same rules as there.
function OrderSheet({ symbol, side: initialSide }: OrderSheetProps) {
  const spec = useStore(session, (state) => state.symbols[symbol]);
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const isTrader = useStore(bridge, canTrade);
  const [side, setSide] = useState(initialSide);
  const [sizing, setSizing] = useState<Sizing>('risk');
  const [lots, setLots] = useState(spec?.volumeMin ?? 0.01);
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [riskMode, setRiskMode] = useState<PlannerRiskMode>('percentEquity');
  const [riskValue, setRiskValue] = useState(1);
  const [preview, setPreview] = useState<RiskOrderOutcome | null>(null);
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const digits = spec?.digits ?? 5;
  const step = spec?.volumeStep ?? 0.01;
  const stopPrice = priceOf(stop);
  const targetPrice = priceOf(target);

  useEffect(() => {
    void window.automation.request('preferences.risk', {}).then((preferences) => {
      setRiskMode(preferences.mode);
      setRiskValue(preferences.value);
    }).catch(() => undefined);
  }, []);

  const riskRequest = (): RiskOrderRequest | null => stopPrice ? {
    type: side, symbol, mode: riskMode, value: riskValue,
    stopLoss: { unit: 'price', value: stopPrice },
    ...(targetPrice ? { takeProfits: [{ distance: { unit: 'price' as const, value: targetPrice }, share: 100 }] } : {}),
  } : null;

  useEffect(() => {
    setPreview(null);
    const request = sizing === 'risk' ? riskRequest() : null;
    if (!request || !isTrader) return;
    const timer = setTimeout(() => {
      void window.automation.request('manager.risk', { ...request, isDryRun: true }).then(setPreview).catch((error: Error) => setMessage(error.message));
    }, PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [sizing, side, stop, target, riskMode, riskValue, isTrader]);

  const label = sizing === 'risk' ? `${side === 'buy' ? 'Buy' : 'Sell'} ${preview ? formatVolume(preview.lots) : ''} ${symbol}` : `${side === 'buy' ? 'Buy' : 'Sell'} ${formatVolume(lots)} ${symbol}`;
  const send = async () => {
    setIsBusy(true);
    setMessage('');
    try {
      if (sizing === 'risk') {
        const request = riskRequest();
        if (!request) throw new Error('Set a stop loss to size by risk.');
        const outcome = await placeRiskOrder(label, request);
        const failed = outcome.results.find((result) => !result.isSuccess);
        setMessage(failed ? failed.comment : `Done: ${formatVolume(outcome.lots)} lots, risking ${formatMoney(outcome.riskMoney)}.`);
        if (!failed && outcome.results.length) setTimeout(closeSheet, 1_200);
      } else {
        const result = await sendOrder({ action: 'deal', type: side, symbol, volume: lots, ...(stopPrice ? { sl: stopPrice } : {}), ...(targetPrice ? { tp: targetPrice } : {}) }, label);
        setMessage(result.comment);
        if (result.isSuccess) setTimeout(closeSheet, 1_200);
      }
    } catch (error) { setMessage((error as Error).message); }
    finally { setIsBusy(false); }
  };

  const riskUnit = plannerRiskModes.find((mode) => mode.key === riskMode)?.unit ?? '';
  const isReady = isTrader && !!tick && (sizing === 'lots' ? lots > 0 : !!preview && preview.lots > 0);
  return (
    <Sheet title={symbol}>
      <div className="phone-segmented" role="radiogroup" aria-label="Side">
        <button type="button" role="radio" aria-checked={side === 'sell'} className={side === 'sell' ? 'is-active is-sell' : ''} onClick={() => setSide('sell')}>Sell {formatPrice(tick?.bid, digits)}</button>
        <button type="button" role="radio" aria-checked={side === 'buy'} className={side === 'buy' ? 'is-active is-buy' : ''} onClick={() => setSide('buy')}>Buy {formatPrice(tick?.ask, digits)}</button>
      </div>
      <div className="phone-segmented" role="radiogroup" aria-label="Size">
        {sizings.map((item) => <button key={item.key} type="button" role="radio" aria-checked={sizing === item.key} className={sizing === item.key ? 'is-active' : ''} onClick={() => setSizing(item.key)}>{item.label}</button>)}
      </div>
      {sizing === 'lots'
        ? <div className="phone-stepper">
          <button type="button" aria-label="Less" onClick={() => setLots(Math.max(spec?.volumeMin ?? step, roundToStep(lots - step, step)))}>−</button>
          <span>{formatVolume(lots)} lots</span>
          <button type="button" aria-label="More" onClick={() => setLots(Math.min(spec?.volumeMax ?? 100, roundToStep(lots + step, step)))}>+</button>
        </div>
        : <label className="phone-field">
          <span>Risk ({plannerRiskModes.find((mode) => mode.key === riskMode)?.label})</span>
          <input type="text" inputMode="decimal" value={String(riskValue)} onChange={(event) => setRiskValue(Number(event.target.value.replace(',', '.')) || 0)} />
          <small>{riskUnit === '%' ? 'Percent lost if the stop loss is hit.' : 'Amount lost if the stop loss is hit.'}</small>
        </label>}
      <PriceField label={sizing === 'risk' ? 'Stop loss (required)' : 'Stop loss'} value={stop} placeholder={formatPrice(side === 'buy' ? tick?.bid : tick?.ask, digits)} onChange={setStop} />
      <PriceField label="Take profit" value={target} onChange={setTarget} />
      {preview && <p className="phone-muted">{formatVolume(preview.lots)} lots, risking {formatMoney(preview.riskMoney)}{preview.warnings.length ? `. ${preview.warnings.join(' ')}` : ''}</p>}
      {message && <p className="phone-banner" role="status">{message}</p>}
      {isTrader
        ? <ConfirmButton className={`phone-primary is-${side}`} label={label} confirmLabel={`Tap again: ${label}`} isBusy={isBusy} isDisabled={!isReady} onConfirm={() => void send()} />
        : <p className="phone-banner">This phone can view only.</p>}
    </Sheet>
  );
}

interface PositionSheetProps {
  ticket: number;
}

function PositionSheet({ ticket }: PositionSheetProps) {
  const position = useStore(session, (state) => state.positions.find((item) => item.ticket === ticket));
  const digits = useStore(session, (state) => position ? state.symbols[position.symbol]?.digits ?? 5 : 5);
  const isTrader = useStore(bridge, canTrade);
  const [stop, setStop] = useState(position?.sl ? String(position.sl) : '');
  const [target, setTarget] = useState(position?.tp ? String(position.tp) : '');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  if (!position) return <Sheet title="Position"><p className="phone-muted">This position is closed.</p></Sheet>;
  const run = async (work: () => Promise<{ comment: string; isSuccess: boolean }>, isClosing: boolean) => {
    setIsBusy(true);
    try {
      const result = await work();
      setMessage(result.comment);
      if (result.isSuccess && isClosing) setTimeout(closeSheet, 1_000);
    } finally { setIsBusy(false); }
  };
  const modify = () => run(() => sendOrder({ action: 'sltp', position: position.ticket, symbol: position.symbol, sl: priceOf(stop) ?? 0, tp: priceOf(target) ?? 0 }), false);
  return (
    <Sheet title={`${position.side === 'buy' ? 'Buy' : 'Sell'} ${formatVolume(position.volume)} ${position.symbol}`}>
      <p className={`phone-profit ${position.profit >= 0 ? 'is-profit' : 'is-loss'}`}>{formatMoney(position.profit)}</p>
      <p className="phone-muted">Opened at {formatPrice(position.priceOpen, digits)}, now {formatPrice(position.priceCurrent, digits)}. Ticket {position.ticket}.</p>
      <PriceField label="Stop loss" value={stop} onChange={setStop} />
      <PriceField label="Take profit" value={target} onChange={setTarget} />
      {message && <p className="phone-banner" role="status">{message}</p>}
      {isTrader
        ? <div className="phone-actions">
          <ConfirmButton label="Save SL and TP" confirmLabel="Tap again to save" isBusy={isBusy} onConfirm={() => void modify()} />
          <ConfirmButton className="phone-primary is-close" label="Close position" confirmLabel={`Tap again: close ${formatVolume(position.volume)}`} isBusy={isBusy} onConfirm={() => void run(() => closePosition(position), true)} />
        </div>
        : <p className="phone-banner">This phone can view only.</p>}
    </Sheet>
  );
}

interface SymbolSheetProps {
  chartId: string;
}

function SymbolSheet({ chartId }: SymbolSheetProps) {
  const symbols = useStore(session, (state) => state.symbols);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const text = query.trim().toUpperCase();
  const matches = Object.values(symbols).filter((spec) => !text || spec.name.toUpperCase().includes(text) || spec.description.toUpperCase().includes(text)).slice(0, 50);
  const choose = (symbol: string) => void requestChart('charts.setMarket', { chartId, symbol }).then(closeSheet).catch((reason: Error) => setError(reason.message));
  return (
    <Sheet title="Symbol">
      <input className="phone-search" type="search" placeholder="Search symbols" value={query} autoFocus autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
      {error && <p className="phone-error" role="alert">{error}</p>}
      <ul className="phone-list phone-sheet-list">{matches.map((spec) => (
        <li key={spec.name}><button type="button" className="phone-row" onClick={() => choose(spec.name)}><span className="phone-row-main"><b>{spec.name}</b><small>{spec.description}</small></span></button></li>
      ))}</ul>
    </Sheet>
  );
}

interface ActiveSheetProps {
  sheet: MobileSheet;
}

function ActiveSheet({ sheet }: ActiveSheetProps) {
  switch (sheet.kind) {
    case 'order': return <OrderSheet symbol={sheet.symbol} side={sheet.side} />;
    case 'position': return <PositionSheet ticket={sheet.ticket} />;
    case 'symbol': return <SymbolSheet chartId={sheet.chartId} />;
  }
}

export function SheetHost() {
  const sheet = useStore(navigation, (state) => state.sheet);
  return sheet ? <ActiveSheet key={JSON.stringify(sheet)} sheet={sheet} /> : null;
}
