import type { Tick } from '../../shared/protocol';
import { log } from './session';
import { Store } from './store';
import { evaluateAlert, restoreAlerts, type PriceAlert } from './price-alerts-model';

const key = 'openterm.price-alerts.v1';
let saved: PriceAlert[] = [];
try { saved = restoreAlerts(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { saved = []; }
export const priceAlerts = new Store<{ alerts: PriceAlert[] }>({ alerts: saved });

export function updateAlerts(alerts: PriceAlert[]): void {
  localStorage.setItem(key, JSON.stringify(alerts));
  priceAlerts.set({ alerts });
}

export function checkPriceAlerts(tick: Tick, profileId: string | null): void {
  const current = priceAlerts.get().alerts;
  const triggered = current.filter((alert) => evaluateAlert(alert, tick, profileId));
  if (!triggered.length) return;
  const ids = new Set(triggered.map((alert) => alert.id));
  const alerts = current.map((alert) => ids.has(alert.id) ? { ...alert, triggeredAt: Date.now(), isEnabled: false } : alert);
  try { updateAlerts(alerts); }
  catch { priceAlerts.set({ alerts }); log('Alert state could not be saved; keep the app open to avoid repeated alerts after restarting.', 'Alerts'); }
  for (const alert of triggered) log(`${alert.symbol}: ${alert.condition} ${alert.price} reached.`, 'Alerts');
}
