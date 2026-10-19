import { useState } from 'react';
import { orderType } from '../../../shared/protocol';
import { chartTimeInput, parseChartTimeInput } from '../../lib/backtest/chart-time';
import { floatingProfit } from '../../lib/backtest/engine';
import { backtest, cancelBacktestOrder, closeBacktestPosition, modifyBacktestOrder, modifyBacktestPosition, useActiveBacktest } from '../../lib/backtest/runtime';
import { simulationOf } from '../../lib/backtest/session-model';
import { formatMoney, formatPrice, formatTime, formatVolume } from '../../lib/format';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from '../dialogs/Dialog';
import { PriceField } from '../dialogs/OrderDialog';

// Changing or closing what a backtest already holds. New orders are planned in the Trade
// Assistant or on the chart, sized by risk.

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
