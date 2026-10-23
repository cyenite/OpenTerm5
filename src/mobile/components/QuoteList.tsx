import { useState } from 'react';
import { formatPrice } from '../../lib/format';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { bridge, canTrade } from '../bridge';
import { openSheet } from '../navigation';
import { quotes, setQuoteSymbols } from '../quotes';

interface QuoteRowProps {
  symbol: string;
  isEditing: boolean;
}

function QuoteRow({ symbol, isEditing }: QuoteRowProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const spec = useStore(session, (state) => state.symbols[symbol]);
  const direction = useStore(session, (state) => state.directions[symbol] ?? 'flat');
  const isTrader = useStore(bridge, canTrade);
  const digits = spec?.digits ?? 5;
  const spread = tick && spec ? Math.round((tick.ask - tick.bid) / spec.point) : null;
  return (
    <li className={`phone-quote is-${direction}`}>
      <span className="phone-row-main"><b>{symbol}</b><small>{spec ? `${spec.description || spec.path}${spread !== null ? ` · spread ${spread}` : ''}` : 'Not offered by this account'}</small></span>
      {isEditing
        ? <button type="button" className="phone-chip-button" onClick={() => setQuoteSymbols(quotes.get().symbols.filter((item) => item !== symbol))}>Remove</button>
        : <span className="phone-quote-prices">
          <button type="button" className="is-sell" disabled={!isTrader || !tick} onClick={() => openSheet({ kind: 'order', symbol, side: 'sell' })}>{formatPrice(tick?.bid, digits) || '-'}</button>
          <button type="button" className="is-buy" disabled={!isTrader || !tick} onClick={() => openSheet({ kind: 'order', symbol, side: 'buy' })}>{formatPrice(tick?.ask, digits) || '-'}</button>
        </span>}
    </li>
  );
}

export function QuoteList() {
  const symbols = useStore(quotes, (state) => state.symbols);
  const offered = useStore(session, (state) => state.symbols);
  const [query, setQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const text = query.trim().toUpperCase();
  const matches = text ? Object.keys(offered).filter((name) => name.toUpperCase().includes(text) && !symbols.includes(name)).slice(0, 20) : [];
  return (
    <div className="phone-page">
      <div className="phone-title-row">
        <h1>Quotes</h1>
        <button type="button" className="phone-chip-button" onClick={() => setIsEditing(!isEditing)}>{isEditing ? 'Done' : 'Edit'}</button>
      </div>
      <input className="phone-search" type="search" placeholder="Add a symbol" value={query} autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
      {matches.length > 0 && (
        <ul className="phone-list">{matches.map((name) => (
          <li key={name}><button type="button" className="phone-row" onClick={() => { setQuoteSymbols([...symbols, name]); setQuery(''); }}><span className="phone-row-main"><b>{name}</b><small>{offered[name].description}</small></span><span aria-hidden>+</span></button></li>
        ))}</ul>
      )}
      {!symbols.length && <p className="phone-muted">No symbols yet. Search above to add one.</p>}
      <ul className="phone-list">{symbols.map((symbol) => <QuoteRow key={symbol} symbol={symbol} isEditing={isEditing} />)}</ul>
    </div>
  );
}
