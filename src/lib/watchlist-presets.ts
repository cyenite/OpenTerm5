import { presetName } from './presets';

export interface WatchlistPreset {
  readonly name: string;
  readonly scope: string;
  readonly symbols: readonly string[];
}

export const watchlistStorageKey = 'terminal5.watchlists.v1';

export function watchlistScope(endpoint: string, profile: string): string {
  return JSON.stringify([endpoint, profile]);
}

export function restoreWatchlists(value: unknown): WatchlistPreset[] {
  if (!Array.isArray(value)) throw new Error('Saved Market Watch sets are invalid.');
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Saved Market Watch set is invalid.');
    const preset = entry as Partial<WatchlistPreset>;
    if (typeof preset.scope !== 'string' || typeof preset.name !== 'string' || !Array.isArray(preset.symbols) || !preset.symbols.every((symbol) => typeof symbol === 'string' && !!symbol && symbol.length <= 128)) {
      throw new Error('Saved Market Watch set is invalid.');
    }
    return { scope: preset.scope, name: presetName(preset.name), symbols: [...new Set(preset.symbols)] };
  });
}

export function saveWatchlist(presets: readonly WatchlistPreset[], scope: string, name: string, symbols: readonly string[]): WatchlistPreset[] {
  if (!scope || !symbols.length) throw new Error('Connect an account and select at least one symbol before saving.');
  const entry = { scope, name: presetName(name), symbols: [...new Set(symbols)] };
  return [...presets.filter((preset) => preset.scope !== scope || preset.name !== entry.name), entry];
}

export async function applyWatchlist(
  preset: WatchlistPreset,
  scope: string,
  symbols: readonly { name: string; visible: boolean }[],
  select: (name: string, isVisible: boolean) => Promise<void>,
  currentScope: () => string,
): Promise<void> {
  if (preset.scope !== scope || currentScope() !== scope) throw new Error('This set belongs to a different account or web endpoint.');
  const available = new Set(symbols.map((symbol) => symbol.name));
  const missing = preset.symbols.filter((name) => !available.has(name));
  if (missing.length) throw new Error(`Symbols unavailable on this account: ${missing.join(', ')}`);
  const desired = new Set(preset.symbols);
  const changes = [...symbols.filter((symbol) => symbol.visible && !desired.has(symbol.name)).map((symbol) => ({ name: symbol.name, isVisible: false })), ...symbols.filter((symbol) => !symbol.visible && desired.has(symbol.name)).map((symbol) => ({ name: symbol.name, isVisible: true }))];
  for (const change of changes) {
    if (currentScope() !== scope) throw new Error('Account changed while applying the set. Review Market Watch before retrying.');
    try {
      await select(change.name, change.isVisible);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Broker request failed.';
      throw new Error(`Could not update ${change.name}: ${detail}. Earlier changes may already be applied; review Market Watch before retrying.`);
    }
    if (currentScope() !== scope) throw new Error('Account changed while applying the set. Review Market Watch before retrying.');
  }
}
