import { useEffect, useState } from 'react';
import { session, terminal } from './session';
import { useStore } from './store';

// Money per 1 lot per 1.0 price move in the account currency, or null until the broker has
// supplied the symbol's conversion rates.
export function useMoneyPerUnit(symbol: string): number | null {
  const canTrade = useStore(session, (state) => !!state.account && state.link.state === 'open');
  const [moneyPerUnit, setMoneyPerUnit] = useState<number | null>(null);
  useEffect(() => {
    let isCurrent = true;
    setMoneyPerUnit(null);
    if (!canTrade || !symbol) return;
    terminal.request('symbols.valuation', { symbol }).then((valuation) => { if (isCurrent) setMoneyPerUnit(valuation.moneyPerUnit); }).catch(() => undefined);
    return () => { isCurrent = false; };
  }, [symbol, canTrade]);
  return moneyPerUnit;
}

export function moneyAt(side: 'buy' | 'sell', priceOpen: number, volume: number, price: number, moneyPerUnit: number): number {
  return (price - priceOpen) * (side === 'buy' ? 1 : -1) * volume * moneyPerUnit;
}
