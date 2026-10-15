import assert from 'node:assert/strict';
import test from 'node:test';
import { createTheme, getTheme, isThemePreference, listThemes, meridianDark, meridianLight, registerTheme, resolveTheme, systemThemeId, themeCssVariables } from './themes';

test('the system preference follows the operating system between Meridian dark and light', () => {
  assert.equal(resolveTheme(systemThemeId, true), meridianDark);
  assert.equal(resolveTheme(systemThemeId, false), meridianLight);
  assert.equal(resolveTheme('meridian-midnight', false).id, 'meridian-midnight');
  assert.equal(resolveTheme('removed-theme', false), meridianDark);
  assert.equal(isThemePreference(systemThemeId), true);
  assert.equal(isThemePreference('greenOnBlack'), false);
});

test('a theme becomes CSS custom properties for the host', () => {
  const variables = themeCssVariables(meridianDark);
  assert.equal(variables['--surface-raised'], meridianDark.ui.surfaceRaised);
  assert.equal(variables['--chrome-blur'], meridianDark.ui.chromeBlur);
  assert.equal(Object.keys(variables).length, Object.keys(meridianDark.ui).length);
  assert.equal(meridianLight.chart.background, '#ffffff');
});

test('hosts derive and register their own themes', () => {
  const brand = createTheme(meridianDark, { id: 'brand', label: 'Brand', ui: { accent: '#ff00aa' }, chart: { up: '#00ff00' } });
  assert.equal(brand.ui.accent, '#ff00aa');
  assert.equal(brand.ui.surface, meridianDark.ui.surface);
  assert.equal(brand.chart.up, '#00ff00');
  assert.equal(brand.mode, 'dark');
  const unregister = registerTheme(brand);
  assert.equal(getTheme('brand'), brand);
  assert.ok(listThemes().includes(brand));
  unregister();
  assert.equal(getTheme('brand'), undefined);
  assert.throws(() => registerTheme({ ...brand, id: systemThemeId }));
});
