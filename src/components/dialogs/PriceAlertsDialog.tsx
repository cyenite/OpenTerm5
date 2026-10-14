import { Component } from 'react';
import { alertConditions, type AlertCondition, type PriceAlert } from '../../lib/price-alerts-model';
import { priceAlerts, updateAlerts } from '../../lib/price-alerts';
import { requireSymbols, session } from '../../lib/session';
import { currentWatchedSpecs } from '../../lib/watchlists';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface AlertsState {
  error: string;
  price: string;
  symbol: string;
  condition: AlertCondition;
  alerts: PriceAlert[];
}

export class PriceAlertsDialog extends Component<Record<string, never>, AlertsState> {
  state: AlertsState = { error: '', price: '', symbol: currentWatchedSpecs()[0]?.name ?? '', condition: 'bidAbove', alerts: priceAlerts.get().alerts };
  private unsubscribe?: () => void;

  componentDidMount(): void { this.unsubscribe = priceAlerts.subscribe(() => this.setState({ alerts: priceAlerts.get().alerts })); }
  componentWillUnmount(): void { this.unsubscribe?.(); }

  private save = async (): Promise<void> => {
    try {
      const profileId = session.get().profileId;
      const price = Number(this.state.price);
      if (!profileId || !session.get().status?.isConnected) throw new Error('Connect to a saved trading account first.');
      if (!session.get().symbols[this.state.symbol]) throw new Error('Select a symbol from this broker.');
      if (!Number.isFinite(price) || price <= 0) throw new Error('Enter a positive price.');
      await requireSymbols([this.state.symbol]);
      if (profileId !== session.get().profileId) throw new Error('The active account changed. Add the alert again.');
      const alert: PriceAlert = { id: crypto.randomUUID(), profileId, symbol: this.state.symbol, condition: this.state.condition, price, createdAt: Date.now(), triggeredAt: null, isEnabled: true };
      updateAlerts([...priceAlerts.get().alerts, alert]);
      this.setState({ error: '', price: '' });
    } catch (error) { this.setState({ error: (error as Error).message }); }
  };

  private remove = (id: string): void => {
    try { updateAlerts(priceAlerts.get().alerts.filter((alert) => alert.id !== id)); }
    catch { this.setState({ error: 'Alerts could not be saved.' }); }
  };

  render() {
    const { symbol, price, condition, error, alerts } = this.state;
    const watched = currentWatchedSpecs();
    const current = session.get().symbols[symbol];
    const visible = current && !watched.includes(current) ? [current, ...watched] : watched;
    return <Dialog title="Price Alerts" width={650}>
      <p className="is-muted">Alerts fire once in the Journal while this app is running and the matching account is connected. Inactive accounts are not monitored.</p>
      <form className="order-form" onSubmit={(event) => { event.preventDefault(); void this.save(); }}>
        <label className="field"><span>Symbol</span><select value={symbol} onChange={(event) => this.setState({ symbol: event.target.value })}>{visible.map((spec) => <option key={spec.name}>{spec.name}</option>)}</select></label>
        <label className="field"><span>Condition</span><select value={condition} onChange={(event) => this.setState({ condition: event.target.value as AlertCondition })}>{alertConditions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label className="field"><span>Price</span><input value={price} type="number" step="any" min="0" required onChange={(event) => this.setState({ price: event.target.value })} /></label>
        <button type="submit">Add alert</button>
      </form>
      {error && <p role="alert" className="is-loss">{error}</p>}
      <div className="scroll" style={{ maxHeight: 260 }}><table className="grid"><thead><tr><th>Symbol</th><th>Condition</th><th>Price</th><th>Status</th><th /></tr></thead><tbody>{alerts.map((alert) => <tr key={alert.id}><td>{alert.symbol}</td><td>{alertConditions.find((item) => item.key === alert.condition)?.label}</td><td>{alert.price}</td><td>{alert.triggeredAt ? 'Triggered' : alert.profileId === session.get().profileId ? 'Armed' : 'Inactive account'}</td><td><button onClick={() => this.remove(alert.id)}>Remove</button></td></tr>)}</tbody></table>{!alerts.length && <p>No price alerts.</p>}</div>
      <div className="dialog-actions"><button onClick={closeDialog}>Close</button></div>
    </Dialog>;
  }
}
