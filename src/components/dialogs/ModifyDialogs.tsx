import { useState } from 'react';
import { orderType, type TradeRequest, type TradeResult } from '../../../shared/protocol';
import { formatMoney, formatPrice, formatVolume } from '../../lib/format';
import { closePosition, sendOrder, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { Dialog } from './Dialog';
import { PriceField, ResultView } from './OrderDialog';
import { TickChart } from './TickChart';

interface ModifyPositionDialogProps {
  ticket: number;
}

export function ModifyPositionDialog({ ticket }: ModifyPositionDialogProps) {
  const position = useStore(session, (state) => state.positions.find((candidate) => candidate.ticket === ticket));
  const digits = useStore(session, (state) => (position ? state.symbols[position.symbol]?.digits : undefined) ?? 5);
  const [sl, setSl] = useState(position?.sl ?? 0);
  const [tp, setTp] = useState(position?.tp ?? 0);
  const [volume, setVolume] = useState(position?.volume ?? 0);
  const [result, setResult] = useState<{ title: string; value: TradeResult } | null>(null);
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
    setResult({ title, value: await action() });
    setIsBusy(false);
  };

  const title = position ? `Position #${ticket} ${position.side} ${formatVolume(position.volume)} ${position.symbol}` : `Position #${ticket}`;

  return (
    <Dialog title={title} width={620}>
      {result ? (
        <ResultView title={result.title} result={result.value} onBack={() => setResult(null)} />
      ) : (
        position && (
          <div className="order-dialog">
            <TickChart symbol={position.symbol} digits={digits} />
            <div className="order-form">
              <p className="order-check">
                Open {formatPrice(position.priceOpen, digits)}, current {formatPrice(position.priceCurrent, digits)}, profit{' '}
                <b className={position.profit >= 0 ? 'is-profit' : 'is-loss'}>{formatMoney(position.profit)}</b>
              </p>
              <div className="field-pair">
                <PriceField label="Stop Loss" value={sl} digits={digits} onChange={setSl} />
                <PriceField label="Take Profit" value={tp} digits={digits} onChange={setTp} />
              </div>
              <div className="dialog-actions">
                <button
                  className="is-primary"
                  disabled={isBusy}
                  onClick={() => run(`Modify #${ticket} sl: ${sl || '-'} tp: ${tp || '-'}`, () => sendOrder({ action: 'sltp', symbol: position.symbol, position: ticket, sl, tp }))}
                >
                  Modify
                </button>
              </div>
              <label className="field">
                <span>Volume to close</span>
                <input type="number" min={0} max={position.volume} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
              </label>
              <div className="dialog-actions">
                <button
                  className={position.side === 'buy' ? 'is-sell' : 'is-buy'}
                  disabled={isBusy || volume <= 0 || volume > position.volume}
                  onClick={() => run(`Close #${ticket} ${formatVolume(volume)} ${position.symbol}`, () => closePosition(position, volume))}
                >
                  Close {position.side === 'buy' ? 'Sell' : 'Buy'} by Market
                </button>
              </div>
            </div>
          </div>
        )
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
  const [result, setResult] = useState<{ title: string; value: TradeResult } | null>(null);
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
    setResult({ title, value: await sendOrder(request) });
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
