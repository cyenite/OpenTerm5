// OpenTerm was called Terminal5 and stored renderer state under `terminal5.*` keys. This module is
// imported first by main.tsx so the keys are renamed before any store reads its initial state.
const legacyPrefix = 'terminal5.';

try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(legacyPrefix)) continue;
    const next = `openterm.${key.slice(legacyPrefix.length)}`;
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key) ?? '');
    localStorage.removeItem(key);
  }
} catch {
  // Storage can be unavailable; the app starts with defaults.
}

export {};
