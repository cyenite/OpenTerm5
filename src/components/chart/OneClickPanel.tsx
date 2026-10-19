import { useState } from 'react';
import { formatPrice, formatVolume, roundToStep } from '../../lib/format';
import { log, session } from '../../lib/session';
import { useVenue } from '../../lib/trading-venue';
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
  // The chart takes part in the running backtest, so the panel trades its simulated account.
  isBacktesting: boolean;
}

export function OneClickPanel({ symbol, digits, isBacktesting }: OneClickPanelProps) {
  const venue = useVenue(isBacktesting);
  const tick = venue.quotes[symbol];
  const spec = useStore(session, (state) => state.symbols[symbol]);

  const trade = async (side: 'buy' | 'sell', volume: number) => {
    const result = await venue.sendOrder({ action: 'deal', symbol, type: side, volume });
    if (!result.isSuccess) {
      log(`one click ${side} ${formatVolume(volume)} ${symbol} failed: ${result.comment}`, 'Trades');
    }
  };

  return <QuickTradePanel bid={tick?.bid} ask={tick?.ask} digits={digits} volumeMin={spec?.volumeMin ?? 0.01} volumeMax={spec?.volumeMax ?? 100} volumeStep={spec?.volumeStep ?? 0.01} canTrade={venue.canTrade} onTrade={trade} />;
}
