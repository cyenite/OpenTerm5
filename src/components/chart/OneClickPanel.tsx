import { useState } from 'react';
import { formatPrice, formatVolume, roundToStep } from '../../lib/format';
import { log, sendOrder, session } from '../../lib/session';
import { useStore } from '../../lib/store';

interface OneClickPanelProps {
  symbol: string;
  digits: number;
}

export function OneClickPanel({ symbol, digits }: OneClickPanelProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const spec = useStore(session, (state) => state.symbols[symbol]);
  const canTrade = useStore(session, (state) => !!state.account && state.status?.isTradeAllowed === true && state.status?.capabilities?.trading === true && state.link.state === 'open');
  const [volume, setVolume] = useState(0.1);
  const [pendingSide, setPendingSide] = useState<'buy' | 'sell' | null>(null);
  const step = spec?.volumeStep ?? 0.01;

  const trade = async (type: 'buy' | 'sell') => {
    setPendingSide(type);
    const result = await sendOrder({ action: 'deal', symbol, type, volume });
    setPendingSide(null);
    if (!result.isSuccess) {
      log(`one click ${type} ${formatVolume(volume)} ${symbol} failed: ${result.comment}`, 'Trades');
    }
  };

  const adjust = (delta: number) => {
    const min = spec?.volumeMin ?? 0.01;
    const max = spec?.volumeMax ?? 100;
    setVolume(roundToStep(Math.min(max, Math.max(min, volume + delta)), step));
  };

  return (
    <div className="one-click" onMouseDown={(event) => event.stopPropagation()}>
      <button className="one-click-side is-sell" disabled={!canTrade || !!pendingSide || !tick} aria-busy={pendingSide === 'sell'} onClick={() => trade('sell')}>
        <span>{pendingSide === 'sell' && <span className="spinner" aria-hidden />}SELL</span>
        <strong>{formatPrice(tick?.bid, digits)}</strong>
      </button>
      <div className="one-click-volume">
        <button onClick={() => adjust(-step)} aria-label="Decrease volume">-</button>
        <input
          value={volume}
          type="number"
          step={step}
          aria-label="Volume"
          onChange={(event) => setVolume(Number(event.target.value) || step)}
        />
        <button onClick={() => adjust(step)} aria-label="Increase volume">+</button>
      </div>
      <button className="one-click-side is-buy" disabled={!canTrade || !!pendingSide || !tick} aria-busy={pendingSide === 'buy'} onClick={() => trade('buy')}>
        <span>{pendingSide === 'buy' && <span className="spinner" aria-hidden />}BUY</span>
        <strong>{formatPrice(tick?.ask, digits)}</strong>
      </button>
    </div>
  );
}
