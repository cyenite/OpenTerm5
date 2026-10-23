import { applyTheme, resolveTheme, systemThemeId, type MeridianTheme } from '@meridian/charts/themes';
import { Store } from '../lib/store';

// The phone follows its own light or dark setting rather than the computer's theme.
const query = matchMedia('(prefers-color-scheme: dark)');

export const mobileTheme = new Store<{ theme: MeridianTheme }>({ theme: resolveTheme(systemThemeId, query.matches) });

export function startMobileTheme(): void {
  const apply = () => {
    const theme = resolveTheme(systemThemeId, query.matches);
    applyTheme(theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.ui.chrome);
    mobileTheme.set({ theme });
  };
  query.addEventListener('change', apply);
  apply();
}
