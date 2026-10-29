import { feedOf, feedSymbol, feeds, isBrokerSymbol } from '../../shared/feeds';

interface SymbolNameProps {
  symbol: string;
}

// A data feed's market shows its own name and that it does not trade.
export function SymbolName({ symbol }: SymbolNameProps) {
  if (isBrokerSymbol(symbol)) return <b>{symbol}</b>;
  const label = feeds.find((feed) => feed.key === feedOf(symbol))?.label;
  return (
    <span className="symbol-name">
      <b>{feedSymbol(symbol)}</b>
      <span className="symbol-tag" title={`${label} market data. Charts of it do not trade.`}>Data only</span>
    </span>
  );
}
