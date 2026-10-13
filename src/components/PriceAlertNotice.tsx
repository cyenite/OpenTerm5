import { Component } from 'react';
import { alertConditions } from '../lib/price-alerts-model';
import { priceAlerts } from '../lib/price-alerts';
import { openDialog } from '../lib/workspace';

export class PriceAlertNotice extends Component<Record<string, never>, { message: string }> {
  state = { message: '' };
  private lastTime = Date.now();
  private unsubscribe?: () => void;

  componentDidMount(): void {
    this.unsubscribe = priceAlerts.subscribe(() => {
      const alerts = priceAlerts.get().alerts.filter((alert) => alert.triggeredAt !== null && alert.triggeredAt >= this.lastTime);
      if (!alerts.length) return;
      this.lastTime = Math.max(...alerts.map((alert) => alert.triggeredAt!)) + 1;
      this.setState({ message: alerts.map((alert) => `${alert.symbol}: ${alertConditions.find((item) => item.key === alert.condition)?.label} ${alert.price}`).join(' · ') });
    });
  }

  componentWillUnmount(): void { this.unsubscribe?.(); }

  render() {
    return this.state.message ? <aside className="price-alert-notice" role="status" aria-live="polite"><strong>Price alert</strong><span>{this.state.message}</span><button onClick={() => openDialog({ kind: 'alerts' })}>View alerts</button><button aria-label="Dismiss price alert" onClick={() => this.setState({ message: '' })}>×</button></aside> : null;
  }
}
