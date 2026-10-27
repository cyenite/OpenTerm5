import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryThemes } from './theme-library';
import { contrastRatio, createTheme, getTheme, isThemePreference, listThemes, meridianDark, meridianLight, readableTextOn, registerTheme, resolveTheme, systemThemeId, themeCssVariables } from './themes';

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
  assert.equal(Object.keys(variables).length, Object.keys(meridianDark.ui).length + 6);
  assert.equal(variables['--buy-text'], readableTextOn(meridianDark.ui.buy, meridianDark));
  assert.equal(meridianLight.chart.background, '#ffffff');
});

test('hosts derive and register their own themes', () => {
  const brand = createTheme(meridianDark, { id: 'brand', label: 'Brand', ui: { accent: '#ff00aa' }, chart: { up: '#00ff00' } });
  assert.equal(brand.ui.accent, '#ff00aa');
  assert.equal(brand.ui.surface, meridianDark.ui.surface);
  assert.equal(brand.chart.up, '#00ff00');
  assert.equal(brand.mode, 'dark');
  assert.equal(brand.isChartOnly, undefined);
  assert.equal(createTheme(meridianDark, { id: 'chart-brand', label: 'Chart Brand', isChartOnly: true }).isChartOnly, true);
  const unregister = registerTheme(brand);
  assert.equal(getTheme('brand'), brand);
  assert.ok(listThemes().includes(brand));
  unregister();
  assert.equal(getTheme('brand'), undefined);
  assert.throws(() => registerTheme({ ...brand, id: systemThemeId }));
});

test('labels on filled tags stay white where white reads, otherwise take the theme ink', () => {
  assert.equal(readableTextOn('#2962ff', meridianLight), '#ffffff');
  assert.equal(readableTextOn('#7aa2f7', getTheme('tokyo-night')!), getTheme('tokyo-night')!.ui.chrome);
  assert.equal(readableTextOn('#f5f5f7', meridianLight), meridianLight.ui.text);
  assert.equal(readableTextOn('rgb(0 0 0 / 0.5)', meridianDark), '#ffffff');
  assert.equal(readableTextOn('var(--buy)', meridianDark), '#ffffff');
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#fff', 'rgb(255, 255, 255)'), 1);
  assert.equal(contrastRatio('red', '#000000'), null);
});

test('the theme library registers application and chart-only themes', () => {
  const ids = libraryThemes.map((patch) => patch.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(getTheme(id), id);
  assert.equal(getTheme('tokyo-night')?.isChartOnly, undefined);
  assert.equal(getTheme('chart-aurora')?.isChartOnly, true);
  assert.equal(getTheme('catppuccin-latte')?.ui.controlShadow, meridianLight.ui.controlShadow);
  assert.equal(listThemes().filter((theme) => theme.isChartOnly).length, 7);
});

test('every built-in theme keeps prices, P/L, labels and candles readable', () => {
  const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 0;
  for (const { id, ui, chart, isChartOnly } of listThemes()) {
    const check = (label: string, fg: string, bg: string, min: number) => assert.ok(ratio(fg, bg) >= min, `${id} ${label}: ${ratio(fg, bg).toFixed(2)}:1`);
    if (!isChartOnly) {
      for (const key of ['text', 'muted', 'accent', 'buy', 'sell', 'profit', 'loss', 'up', 'down', 'good', 'warn'] as const) check(key, ui[key], ui.surface, 4.5);
      check('accentText', ui.accentText, ui.accent, 4.5);
    }
    const theme = getTheme(id)!;
    for (const key of ['buy', 'sell', 'profit', 'loss', 'warn', 'bad', 'muted'] as const) check(`label on ${key}`, readableTextOn(ui[key], theme), ui[key], 4.5);
    check('chart text', chart.text, chart.background, 4.5);
    if (chart.backgroundGradient) check('chart text on gradient', chart.text, chart.backgroundGradient, 4.5);
    check('up candles', chart.up, chart.background, 3);
    check('down candles', chart.down, chart.background, 3);
  }
});
