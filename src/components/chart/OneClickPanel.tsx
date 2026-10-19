import { useState } from 'react';
import { formatPrice, formatVolume, roundToStep } from '../../lib/format';
import { log, sendOrder, session } from '../../lib/session';
import { useStore } from '../../lib/store';

interface QuickTradePanelProps {
  bid: number | undefined;
  ask: number | undefined;
  digits: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  canTrade: boolean;
  onTrade: (side: 'buy' | 'sell', volume: number) => Promise<void>;
}

// Sell and buy at market with a volume between them, on the chart. The live One-Click panel and
// the backtest's panel are the same strip over different brokers.
export function QuickTradePanel({ bid, ask, digits, volumeMin, volumeMax, volumeStep, canTrade, onTrade }: QuickTradePanelProps) {
  const [volume, setVolume] = useState(0.1);
  const [pendingSide, setPendingSide] = useState<'buy' | 'sell' | null>(null);
  const isQuoted = bid !== undefined && ask !== undefined;

  const trade = async (side: 'buy' | 'sell') => {
    setPendingSide(side);
    try {
      await onTrade(side, volume);
    } finally {
      setPendingSide(null);
    }
  };

  const adjust = (delta: number) => setVolume(roundToStep(Math.min(volumeMax, Math.max(volumeMin, volume + delta)), volumeStep));

  return (
    <div className="one-click" onMouseDown={(event) => event.stopPropagation()}>
      <button className="one-click-side is-sell" disabled={!canTrade || !!pendingSide || !isQuoted} aria-busy={pendingSide === 'sell'} onClick={() => trade('sell')}>
        <span>{pendingSide === 'sell' && <span className="spinner" aria-hidden />}SELL</span>
        <strong>{formatPrice(bid, digits)}</strong>
      </button>
      <div className="one-click-volume">
        <button onClick={() => adjust(-volumeStep)} aria-label="Decrease volume">-</button>
        <input
          value={volume}
          type="number"
          step={volumeStep}
          aria-label="Volume"
          onChange={(event) => setVolume(Number(event.target.value) || volumeStep)}
        />
        <button onClick={() => adjust(volumeStep)} aria-label="Increase volume">+</button>
      </div>
      <button className="one-click-side is-buy" disabled={!canTrade || !!pendingSide || !isQuoted} aria-busy={pendingSide === 'buy'} onClick={() => trade('buy')}>
        <span>{pendingSide === 'buy' && <span className="spinner" aria-hidden />}BUY</span>
        <strong>{formatPrice(ask, digits)}</strong>
      </button>
    </div>
  );
}

interface OneClickPanelProps {
  symbol: string;
  digits: number;
}

export function OneClickPanel({ symbol, digits }: OneClickPanelProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const spec = useStore(session, (state) => state.symbols[symbol]);
  const canTrade = useStore(session, (state) => !!state.account && state.status?.isTradeAllowed === true && state.status?.capabilities?.trading === true && state.link.state === 'open');

  const trade = async (side: 'buy' | 'sell', volume: number) => {
    const result = await sendOrder({ action: 'deal', symbol, type: side, volume });
    if (!result.isSuccess) {
      log(`one click ${side} ${formatVolume(volume)} ${symbol} failed: ${result.comment}`, 'Trades');
    }
  };

  return <QuickTradePanel bid={tick?.bid} ask={tick?.ask} digits={digits} volumeMin={spec?.volumeMin ?? 0.01} volumeMax={spec?.volumeMax ?? 100} volumeStep={spec?.volumeStep ?? 0.01} canTrade={canTrade} onTrade={trade} />;
}
