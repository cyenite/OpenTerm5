import { indicatorCatalogue } from '@meridian/charts';
import type { MenuItem } from '../components/MenuBar';
import { entryLabel, indicatorEntries, sectionEntries, type IndicatorEntry } from './indicator-catalog';
import { indicatorFavorites } from './indicator-favorites';
import { pineScripts } from './pine/pine-scripts';
import { addIndicator, closeDialog, openDialog, workspace } from './workspace';

// Menus reach indicators the way TradingView's toolbar does: the Indicators dialog for all of
// them, and a menu of favourites.

export function studyTitle(kind: string): string {
  const entry = indicatorEntries(indicatorCatalogue(), pineScripts.get().scripts).find((candidate) => candidate.type === kind);
  return entry ? entryLabel(entry) : kind;
}

export function favoriteIndicators(): IndicatorEntry[] {
  return sectionEntries(indicatorEntries(indicatorCatalogue(), pineScripts.get().scripts), 'favorites', new Set(indicatorFavorites.get().types));
}

// The toolbar button toggles the dialog, as TradingView's does.
export function toggleIndicatorsDialog(): void {
  if (workspace.get().dialog?.kind === 'indicators') closeDialog();
  else openDialog({ kind: 'indicators' });
}

export function favoriteIndicatorItems(chartId: string | undefined): MenuItem[] {
  const favorites = favoriteIndicators();
  if (!favorites.length) return [{ label: 'No favorite indicators added yet', isDisabled: true }];
  return favorites.map((entry) => ({ label: entryLabel(entry), isDisabled: !chartId, action: () => chartId && addIndicator(chartId, entry.type) }));
}

export function indicatorMenuItems(chartId: string | undefined): MenuItem[] {
  return [
    { label: 'Indicators...', shortcut: '/', action: () => openDialog({ kind: 'indicators' }) },
    { label: 'Favorite Indicators', items: favoriteIndicatorItems(chartId) },
  ];
}
