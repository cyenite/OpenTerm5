import { defaultRiskPreferences, type RiskPreferences } from '../../shared/automation';
import { automation } from './automation';
import { log } from './session';
import { Store } from './store';

export const riskPreferences = new Store<RiskPreferences>(defaultRiskPreferences);

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function loadRiskPreferences(): void {
  automation.request('preferences.risk', {}).then((preferences) => riskPreferences.set(preferences)).catch((error: Error) => log(`Risk settings unavailable: ${error.message}`, 'Automation'));
}

// Saved in the main process (risk-preferences.json) so the choice survives restarts
// and is shared by the chart planner and the order ticket.
export function setRiskPreferences(patch: Partial<RiskPreferences>): void {
  riskPreferences.set(patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    automation.request('preferences.setRisk', riskPreferences.get()).then((saved) => riskPreferences.set(saved)).catch((error: Error) => log(`Risk settings were not saved: ${error.message}`, 'Automation'));
  }, 400);
}
