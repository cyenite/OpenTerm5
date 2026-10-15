import { PureComponent, createRef } from 'react';
import type { SymbolSpec } from '../../shared/protocol';
import { searchSymbols, symbolCategories, symbolCategory } from '../lib/symbol-search';

const RESULT_LIMIT = 60;
const CATEGORY_LIMIT = 8;
const DROPDOWN_HEIGHT = 340;

interface SymbolSearchProps {
  symbols: Record<string, SymbolSpec>;
  watched: ReadonlySet<string>;
  onPick: (name: string) => void;
  label?: string;
  placeholder?: string;
}

interface SymbolSearchState {
  query: string;
  active: number;
  category: string | null;
  place: { left: number; top: number; width: number; isAbove: boolean } | null;
}

// PureComponent: Market Watch re-renders on every tick, and the result list must not.
export class SymbolSearch extends PureComponent<SymbolSearchProps, SymbolSearchState> {
  state: SymbolSearchState = { query: '', active: 0, category: null, place: null };
  private readonly input = createRef<HTMLInputElement>();
  private readonly list = createRef<HTMLUListElement>();

  componentDidMount() {
    window.addEventListener('resize', this.close);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.close);
  }

  componentDidUpdate() {
    this.list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  focusWith(text: string): void {
    this.input.current?.focus();
    this.change(text);
  }

  focus(): void {
    this.input.current?.focus();
  }

  private close = () => this.setState({ query: '', active: 0, place: null });

  private results(): SymbolSpec[] {
    const { query, category } = this.state;
    return query.trim() ? searchSymbols(this.props.symbols, query, { category, limit: RESULT_LIMIT }) : [];
  }

  private placement(): SymbolSearchState['place'] {
    const box = this.input.current?.getBoundingClientRect();
    if (!box) return null;
    const width = Math.max(box.width, 340);
    const isAbove = window.innerHeight - box.bottom < DROPDOWN_HEIGHT && box.top > window.innerHeight - box.bottom;
    return { width, isAbove, left: Math.max(4, Math.min(box.left, window.innerWidth - width - 4)), top: isAbove ? box.top - 2 : box.bottom + 2 };
  }

  private change(query: string): void {
    this.setState({ query, active: 0, place: query.trim() ? this.placement() : null });
  }

  private pick(name: string): void {
    this.props.onPick(name);
    this.close();
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const results = this.results();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.setState(({ active }) => ({ active: (active + step + results.length) % results.length }));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = results[this.state.active] ?? results[0];
      if (hit) this.pick(hit.name);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.input.current?.blur();
    }
  };

  render() {
    const { symbols, watched, label = 'Add symbol', placeholder = '+ click to add' } = this.props;
    const { query, active, category, place } = this.state;
    const results = this.results();
    const categories = symbolCategories(symbols).slice(0, CATEGORY_LIMIT);
    const isOpen = place !== null && query.trim() !== '';
    const hasSymbols = categories.length > 0;
    return (
      <>
        <input
          ref={this.input}
          value={query}
          role="combobox"
          aria-label={label}
          aria-expanded={isOpen}
          aria-controls="openterm-symbol-search"
          aria-activedescendant={isOpen && results[active] ? `openterm-symbol-hit-${active}` : undefined}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => this.change(event.target.value)}
          onKeyDown={this.onKeyDown}
          onBlur={this.close}
        />
        {isOpen && (
          <div
            className={`symbol-search${place.isAbove ? ' is-above' : ''}`}
            style={{ left: place.left, top: place.top, width: place.width }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {categories.length > 1 && (
              <div className="symbol-search-categories" role="tablist" aria-label="Market">
                {[null, ...categories].map((name) => (
                  <button key={name ?? 'all'} type="button" role="tab" aria-selected={category === name} className={category === name ? 'is-active' : ''} onClick={() => this.setState({ category: name, active: 0 })}>
                    {name ?? 'All'}
                  </button>
                ))}
              </div>
            )}
            {results.length ? (
              <ul ref={this.list} id="openterm-symbol-search" role="listbox" className="symbol-search-hits">
                {results.map((spec, index) => (
                  <li
                    key={spec.name}
                    id={`openterm-symbol-hit-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`symbol-search-hit${index === active ? ' is-active' : ''}`}
                    title={watched.has(spec.name) ? 'Already in this watchlist' : 'Add to this watchlist'}
                    onMouseEnter={() => this.setState({ active: index })}
                    onClick={() => this.pick(spec.name)}
                  >
                    <span className="symbol-search-mark" aria-hidden>{watched.has(spec.name) ? '✓' : '+'}</span>
                    <b>{spec.name}</b>
                    <span className="symbol-search-description">{spec.description}</span>
                    <span className="symbol-search-category">{symbolCategory(spec.path)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="symbol-search-empty">{hasSymbols ? `No symbols match "${query.trim()}"${category ? ` in ${category}` : ''}.` : 'Log in to an account to search its symbols.'}</p>
            )}
            <p className="symbol-search-footer">
              {results.length === RESULT_LIMIT ? `First ${RESULT_LIMIT} matches. Keep typing to narrow. ` : ''}↑ ↓ choose · Enter add · Esc close
            </p>
          </div>
        )}
      </>
    );
  }
}
