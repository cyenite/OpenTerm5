import assert from 'node:assert/strict';
import test from 'node:test';
import { applySettingsFields, backgroundGradientOf, defaultSettings, restoreSettings, settingsFields, themeSettings, withThemeColors } from './settings';
import { createTheme, meridianDark } from './themes';
import type { FieldValues } from './ui/dialog';

const dusk = createTheme(meridianDark, { id: 'dusk', label: 'Dusk', chart: { background: '#101020', backgroundGradient: '#302040', up: '#26a69a' } });

const formOf = (settings = defaultSettings, theme = meridianDark): FieldValues => Object.fromEntries(settingsFields(settings, theme).map((field) => [field.key, field.value as never]));

test('a gradient theme paints its gradient until the user picks a solid colour', () => {
  assert.equal(backgroundGradientOf(defaultSettings, dusk), '#302040');
  assert.equal(backgroundGradientOf({ ...defaultSettings, background: '#000000' }, dusk), null);
  assert.equal(backgroundGradientOf({ ...defaultSettings, backgroundGradient: '#ff0000' }, meridianDark), '#ff0000');
  assert.equal(formOf(defaultSettings, dusk).backgroundStyle, 'Gradient');
});

test('the dialog keeps theme colours following the theme, and stores what differs', () => {
  assert.deepEqual(applySettingsFields(formOf(defaultSettings, dusk), dusk), defaultSettings);
  const solid = applySettingsFields({ ...formOf(defaultSettings, dusk), backgroundStyle: 'Solid' }, dusk);
  assert.deepEqual([solid.background, solid.backgroundGradient], ['#101020', null]);
  const gradient = applySettingsFields({ ...formOf(), backgroundStyle: 'Gradient', backgroundGradient: '#123456' }, meridianDark);
  assert.deepEqual([gradient.background, gradient.backgroundGradient], [null, '#123456']);
});

test('a theme from the Template menu becomes this chart\'s colours', () => {
  const applied = applySettingsFields(formOf(themeSettings(defaultSettings, dusk), meridianDark), meridianDark);
  assert.deepEqual([applied.background, applied.backgroundGradient, applied.upColor, applied.downColor], ['#101020', '#302040', '#26a69a', null]);
  const light = createTheme(meridianDark, { id: 'paper', label: 'Paper', mode: 'light', chart: { background: '#fdf6e3', text: '#586e75' } });
  assert.equal(applySettingsFields(formOf(themeSettings(defaultSettings, light), meridianDark), meridianDark).textColor, '#586e75');
});

test('saved settings from before gradients restore with a solid background', () => {
  const { backgroundGradient, ...older } = defaultSettings;
  assert.equal(restoreSettings({ ...older, background: '#222222' }).backgroundGradient, backgroundGradient);
});

test('a saved single grid colour colours both grids, and a hidden OHLC readout keeps its bar change hidden', () => {
  const { verticalGridColor, horizontalGridColor, isBarChangeShown, ...older } = defaultSettings;
  const restored = restoreSettings({ ...older, gridColor: '#334455', isOhlcShown: false });
  assert.deepEqual([restored.verticalGridColor, restored.horizontalGridColor, restored.isBarChangeShown], ['#334455', '#334455', false]);
  assert.equal('gridColor' in restored, false);
  assert.equal(restoreSettings({ ...older }).isBarChangeShown, true);
  assert.equal(restoreSettings({ ...defaultSettings, gridColor: '#334455', verticalGridColor: null }).horizontalGridColor, null);
});

test('widths, font size and margins keep to their ranges', () => {
  const restored = restoreSettings({ crosshairWidth: 0, lastPriceLineWidth: 9, scaleFontSize: 40, topMarginPercent: -5, bottomMarginPercent: 80, verticalGridStyle: 'wavy', horizontalGridStyle: 'dotted' });
  assert.deepEqual(
    [restored.crosshairWidth, restored.lastPriceLineWidth, restored.scaleFontSize, restored.topMarginPercent, restored.bottomMarginPercent, restored.verticalGridStyle, restored.horizontalGridStyle],
    [1, 4, 20, 0, 40, 'solid', 'dotted'],
  );
});

test('the last price line follows the candle until a custom colour is chosen', () => {
  assert.equal(applySettingsFields(formOf(), meridianDark).lastPriceLineColor, null);
  assert.equal(applySettingsFields({ ...formOf(), lastPriceLineColorSource: 'Custom', lastPriceLineColor: '#2962ff' }, meridianDark).lastPriceLineColor, '#2962ff');
  const custom = { ...defaultSettings, lastPriceLineColor: '#2962ff', verticalGridColor: '#101010', horizontalGridStyle: 'dashed' as const, scaleFontSize: 13 };
  assert.deepEqual(applySettingsFields(formOf(custom), meridianDark), custom);
});

test('a chart switched to another theme drops its own colours and keeps the rest', () => {
  const custom = { ...themeSettings(defaultSettings, dusk), lastPriceLineColor: '#ff0000', scaleFontSize: 14, isVerticalGridShown: false };
  const switched = withThemeColors(custom);
  assert.deepEqual(switched, { ...defaultSettings, scaleFontSize: 14, isVerticalGridShown: false });
});
