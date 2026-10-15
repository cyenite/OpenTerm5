import { createTheme, defaultThemeId, meridianDark, meridianLight, registerTheme, type ThemePatch } from '@meridian/charts/themes';
import { log } from './session';
import { Store } from './store';
import { restoreThemePatches } from './tradingview-model';
import { workspace } from './workspace';

// Chart themes imported from TradingView. Each keeps only its chart colours; the rest of the
// application uses the built-in theme of the same brightness. They register when this module loads,
// before the saved theme preference is resolved.

const STORAGE_KEY = 'openterm.themes.v1';

const registered = new Map<string, () => void>();

function load(): ThemePatch[] {
  try {
    return restoreThemePatches(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

function register(patch: ThemePatch): void {
  registered.get(patch.id)?.();
  registered.set(patch.id, registerTheme(createTheme(patch.mode === 'light' ? meridianLight : meridianDark, patch)));
}

export const importedThemes = new Store<{ themes: readonly ThemePatch[] }>({ themes: load() });

importedThemes.get().themes.forEach(register);

export function saveImportedTheme(patch: ThemePatch): void {
  register(patch);
  importedThemes.set((state) => ({ themes: [...state.themes.filter((theme) => theme.id !== patch.id), patch] }));
}

export function removeImportedTheme(id: string): void {
  if (workspace.get().theme === id) workspace.set({ theme: defaultThemeId });
  registered.get(id)?.();
  registered.delete(id);
  importedThemes.set((state) => ({ themes: state.themes.filter((theme) => theme.id !== id) }));
}

export function startImportedThemes(): void {
  importedThemes.subscribe(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(importedThemes.get().themes));
    } catch (error) {
      log(`Imported themes could not be saved: ${(error as Error).message}`, 'Charts');
    }
  });
}
