import { applyTheme, resolveTheme, systemThemeId, type MeridianTheme } from '@meridian/charts/themes';
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
  media.addEventListener('change', update);
}

export function setThemePreference(theme: string): void {
  workspace.set({ theme });
}

export { systemThemeId };
