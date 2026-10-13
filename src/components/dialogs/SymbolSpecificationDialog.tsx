import { Component } from 'react';
import type { SymbolSpec } from '../../../shared/protocol';
import { terminal } from '../../lib/session';
import { Dialog } from './Dialog';

interface SpecificationProps { readonly symbol: string }
interface SpecificationState { readonly error: string; readonly spec: SymbolSpec | null }

export class SymbolSpecificationDialog extends Component<SpecificationProps, SpecificationState> {
  state: SpecificationState = { error: '', spec: null };
  private isActive = false;
  private version = 0;

  componentDidMount() {
    this.isActive = true;
    this.load();
  }

  componentDidUpdate(previous: SpecificationProps) {
    if (previous.symbol !== this.props.symbol) this.load();
  }

  private load = () => {
    const version = ++this.version;
    this.setState({ spec: null, error: '' });
    void terminal.request('symbols.info', { symbol: this.props.symbol }).then((spec) => {
      if (this.isActive && version === this.version) this.setState({ spec });
    }).catch((reason: unknown) => {
      if (this.isActive && version === this.version) this.setState({ error: reason instanceof Error ? reason.message : 'Symbol specification could not be loaded.' });
    });
  };

  componentWillUnmount() { this.isActive = false; }

  render() {
    const { spec, error } = this.state;
    const rows: [string, string | number | undefined][] = spec ? [
      ['Description', spec.description], ['Symbol path', spec.path], ['Trading access', spec.tradeMode],
      ['Base currency', spec.currencyBase], ['Profit currency', spec.currencyProfit], ['Margin currency', spec.currencyMargin],
      ['Digits', spec.digits], ['Point', spec.point], ['Tick size', spec.tickSize], ['Contract size', spec.contractSize],
      ['Spread (points)', spec.isSpreadFloat ? 'Floating' : spec.spread],
      ['Minimum volume (lots)', spec.volumeMin], ['Maximum volume (lots)', spec.volumeMax], ['Volume step (lots)', spec.volumeStep],
      ['Minimum stops (points)', spec.stopsLevel], ['Freeze level (points)', spec.freezeLevel],
      ['Execution mode', spec.executionMode === undefined ? undefined : ['Request', 'Instant', 'Market', 'Exchange'][spec.executionMode] ?? `Unknown (${spec.executionMode})`],
      ['Filling policies (broker flags)', spec.fillingFlags], ['Expiration policies (broker flags)', spec.expirationFlags], ['Order permissions (broker flags)', spec.orderFlags], ['Swap long', spec.swapLong], ['Swap short', spec.swapShort],
    ] : [];
    return (
      <Dialog title={`Specification: ${this.props.symbol}`} width={560}>
        {error ? <p role="alert" className="is-loss">{error}</p> : !spec ? <p>Loading broker specification…</p> : (
          <div className="scroll" style={{ maxHeight: '65vh' }}>
            <table className="grid details"><tbody>{rows.map(([name, value]) => <tr key={name}><th>{name}</th><td>{value === undefined || typeof value === 'number' && !Number.isFinite(value) ? 'Unavailable' : value}</td></tr>)}</tbody></table>
            <p className="is-muted">Values come from the connected account’s detailed broker specification. Swap amounts use the broker’s calculation mode; no monetary conversion is estimated here.</p>
          </div>
        )}
      </Dialog>
    );
  }
}
