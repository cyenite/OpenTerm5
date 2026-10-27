import { applyTheme, getTheme, listThemes, resolveTheme, systemThemeId, type MeridianTheme } from '@meridian/charts/themes';
import { importedThemes } from './custom-themes';
import { Store } from './store';
import { workspace } from './workspace';

// The resolved Meridian theme: what the 'system' preference means right now, applied to the
// application chrome and read by every chart.
export const themeStore = new Store<{ theme: MeridianTheme }>({ theme: resolveTheme(workspace.get().theme, false) });

export function startTheming(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let applied: MeridianTheme | null = null;
  const update = () => {
    const theme = resolveTheme(workspace.get().theme, media.matches);
    if (theme === applied) return;
    applied = theme;
    applyTheme(theme);
    themeStore.set({ theme });
  };
  update();
  workspace.subscribe(update);
  importedThemes.subscribe(update);
  media.addEventListener('change', update);
}

// A chart's own theme, or the application's when it has none or its theme was removed.
export function chartTheme(themeId: string | undefined, appTheme: MeridianTheme): MeridianTheme {
  return (themeId && getTheme(themeId)) || appTheme;
}

// Menu groups, dark themes first. Only a chart offers the chart-only themes.
export function themeGroups(isForChart: boolean): MeridianTheme[][] {
  const themes = listThemes();
  const windowThemes = themes.filter((theme) => !theme.isChartOnly);
  const groups = [windowThemes.filter((theme) => theme.mode === 'dark'), windowThemes.filter((theme) => theme.mode === 'light')];
  if (isForChart) groups.push(themes.filter((theme) => theme.isChartOnly));
  return groups.filter((group) => group.length);
}

export function setThemePreference(theme: string): void {
  workspace.set({ theme });
}

export { systemThemeId };
