import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { session, signingIn } from '../../lib/session';
import { useStore } from '../../lib/store';
import { closeSymbolPrompt, symbolPrompt, type SymbolPromptState } from '../../lib/symbol-prompt';
import { searchSymbols, symbolCategory } from '../../lib/symbol-search';
import { setChartSymbol } from '../../lib/workspace';
import { SigningIn } from '../ui/SigningIn';
import { SurfacePortal } from '../ui/Surface';

const RESULT_LIMIT = 50;

interface SymbolPromptBoxProps {
  prompt: SymbolPromptState;
}

// Centred on the window it was typed in, as TradingView's symbol search is: a chart cell can be too
// small to hold the list.
function SymbolPromptBox({ prompt }: SymbolPromptBoxProps) {
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const symbols = useStore(session, (state) => state.symbols);
  const signIn = useStore(session, signingIn);
  const [text, setText] = useState(prompt.text);
  const [active, setActive] = useState(0);
  const results = useMemo(() => text.trim() ? searchSymbols(symbols, text, { limit: RESULT_LIMIT }) : [], [symbols, text]);
  const hasSymbols = Object.keys(symbols).length > 0;

  useLayoutEffect(() => {
    const field = input.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, [prompt]);

  useLayoutEffect(() => {
    list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const pick = (name: string) => {
    closeSymbolPrompt();
    setChartSymbol(prompt.chartId, name);
  };

  return (
    <div className="symbol-prompt" role="dialog" aria-label="Symbol search" onMouseDown={(event) => { if (event.target !== input.current) event.preventDefault(); }}>
      <div className="timeframe-prompt-title">Symbol search</div>
      <input
        ref={input}
        value={text}
        role="combobox"
        spellCheck={false}
        autoComplete="off"
        aria-label="Symbol"
        aria-expanded={results.length > 0}
        aria-controls="openterm-symbol-prompt"
        aria-activedescendant={results[active] ? `openterm-symbol-prompt-${active}` : undefined}
        onChange={(event) => { setText(event.target.value.toUpperCase()); setActive(0); }}
        onBlur={closeSymbolPrompt}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (results.length) setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
          } else if (event.key === 'Enter') {
            const hit = results[active] ?? results[0];
            if (hit) pick(hit.name);
          } else if (event.key === 'Escape') closeSymbolPrompt();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      />
      {results.length ? (
        <ul ref={list} id="openterm-symbol-prompt" role="listbox" className="symbol-search-hits">
          {results.map((spec, index) => (
            <li
              key={spec.name}
              id={`openterm-symbol-prompt-${index}`}
              role="option"
              aria-selected={index === active}
              className={`symbol-search-hit${index === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(spec.name)}
            >
              <span aria-hidden />
              <b>{spec.name}</b>
              <span className="symbol-search-description">{spec.description}</span>
              <span className="symbol-search-category">{symbolCategory(spec.path)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="symbol-search-empty">{!text.trim() ? 'Type a symbol or its description.' : hasSymbols ? `No symbols match "${text.trim()}".` : signIn ? <SigningIn signIn={signIn} /> : 'Log in to an account to search its symbols.'}</p>
      )}
    </div>
  );
}

export function SymbolPromptHost() {
  const prompt = useStore(symbolPrompt, (state) => state.prompt);
  if (!prompt) return null;
  return <SurfacePortal view={prompt.view}><SymbolPromptBox key={`${prompt.chartId}-${prompt.text}`} prompt={prompt} /></SurfacePortal>;
}
