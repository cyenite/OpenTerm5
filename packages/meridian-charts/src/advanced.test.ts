import assert from 'node:assert/strict';
import test from 'node:test';
import { PriceScale } from './core/price-scale';
import { applyDrawingFields, drawingFields, isShownOn } from './drawings/settings';
import { styleFor, toolDefinitions } from './drawings/tools';
import { applySettingsFields, defaultSettings, restoreSettings, settingsFields } from './settings';
import { meridianDark } from './themes';
import type { SerializedDrawing } from './types';
import type { FieldValues } from './ui/dialog';

const close = (actual: number, expected: number, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≉ ${expected}`);

function scale(mode: PriceScale['mode'], low: number, high: number): PriceScale {
  const result = new PriceScale();
  result.top = 0;
  result.height = 400;
  result.base = 100;
  result.setMode(mode);
  result.fit(low, high);
  return result;
}

test('every scale mode maps prices to pixels and back', () => {
  for (const mode of ['normal', 'log', 'percent', 'indexed'] as const) {
    for (const isInverted of [false, true]) {
      const subject = scale(mode, 90, 130);
      subject.isInverted = isInverted;
      for (const price of [90, 100, 117.5, 130]) close(subject.yToPrice(subject.priceToY(price)), price, 1e-7);
      const top = subject.priceToY(130);
      const bottom = subject.priceToY(90);
      assert.equal(top < bottom, !isInverted, `${mode} ${isInverted ? 'inverted ' : ''}puts higher prices ${isInverted ? 'lower' : 'higher'}`);
    }
  }
});

test('a log scale gives equal ratios equal distances', () => {
  const subject = scale('log', 10, 1000);
  close(subject.priceToY(10) - subject.priceToY(100), subject.priceToY(100) - subject.priceToY(1000), 1e-6);
});

test('percent and indexed scales label against the base price', () => {
  const percent = scale('percent', 95, 110);
  assert.equal(percent.format(110, String), '10.00%');
  assert.equal(percent.format(95, String), '−5.00%');
  const indexed = scale('indexed', 95, 110);
  assert.equal(indexed.format(110, String), '110.00');
  assert.ok(percent.ticks(String).every((tick) => tick.label.endsWith('%')));
  assert.ok(scale('log', 10, 1000).ticks(String).length >= 2);
});

test('saved chart settings are validated field by field', () => {
  assert.deepEqual(restoreSettings(undefined), defaultSettings);
  assert.deepEqual(restoreSettings('nonsense'), defaultSettings);
  const restored = restoreSettings({ upColor: '#00ff00', downColor: 'red', scaleMode: 'log', crosshairStyle: 'wavy', rightMarginBars: 500, isWatermarkShown: 'yes', extra: 1 });
  assert.equal(restored.upColor, '#00ff00');
  assert.equal(restored.downColor, null);
  assert.equal(restored.scaleMode, 'log');
  assert.equal(restored.crosshairStyle, defaultSettings.crosshairStyle);
  assert.equal(restored.rightMarginBars, 100);
  assert.equal(restored.isWatermarkShown, defaultSettings.isWatermarkShown);
  assert.equal('extra' in restored, false);
});

test('chart settings survive the dialog, and theme colours stay unset', () => {
  const settings = { ...defaultSettings, upColor: '#123456', scaleMode: 'percent' as const, isOhlcShown: false };
  const fields = settingsFields(settings, meridianDark);
  assert.ok(new Set(fields.map((field) => field.tab)).size >= 4);
  const values: FieldValues = Object.fromEntries(fields.map((field) => [field.key, field.value as FieldValues[string]]));
  assert.deepEqual(applySettingsFields(values, meridianDark), settings);
});

function drawing(type: string, anchors: SerializedDrawing['anchors']): SerializedDrawing {
  return { id: 'd1', type, paneId: 'price', anchors, style: styleFor(type), locked: false, visible: true, zIndex: 1, createdAt: 0 };
}

test('drawing settings edit style, coordinates and visibility', () => {
  const definition = toolDefinitions.get('rectangle')!;
  const subject = drawing('rectangle', [{ time: 1_000, price: 1.1 }, { time: 61_000, price: 1.2 }]);
  const fields = drawingFields(subject, definition);
  assert.deepEqual([...new Set(fields.map((field) => field.tab))].filter((tab) => ['Style', 'Coordinates', 'Visibility'].includes(tab!)), ['Style', 'Coordinates', 'Visibility']);
  const values: FieldValues = Object.fromEntries(fields.map((field) => [field.key, field.value as FieldValues[string]]));
  const unchanged = applyDrawingFields(subject, definition, values);
  assert.deepEqual(unchanged.anchors, subject.anchors);
  assert.deepEqual({ ...unchanged.style, extendRight: undefined }, { ...subject.style, extendRight: undefined, fillColor: subject.style.fillColor ?? subject.style.lineColor, fillOpacity: subject.style.fillOpacity ?? 0.15 });
  assert.equal(unchanged.props?.visibility, undefined, 'shown everywhere by default');

  const edited = applyDrawingFields(subject, definition, { ...values, lineWidth: 3, 'price:1': 1.25, 'time:0': 2_000, 'visible:seconds': false, 'visible:minutes': false });
  assert.equal(edited.style.lineWidth, 3);
  assert.deepEqual(edited.anchors, [{ time: 2_000, price: 1.1 }, { time: 61_000, price: 1.25 }]);
  assert.equal(isShownOn(edited, 60_000), false, 'hidden on minute charts');
  assert.equal(isShownOn(edited, 5_000), false, 'hidden on seconds charts');
  assert.equal(isShownOn(edited, 3_600_000), true, 'shown on hourly charts');
  assert.equal(subject.anchors[0].time, 1_000, 'the original is left alone');
});

test('text tools get a Text tab', () => {
  const entry = [...toolDefinitions.values()].find((definition) => definition.hasText && definition.anchors !== 'free');
  assert.ok(entry, 'a text tool exists');
  const subject = { ...drawing(entry.type, [{ time: 0, price: 1 }, { time: 60_000, price: 2 }, { time: 120_000, price: 3 }].slice(0, typeof entry.anchors === 'number' ? entry.anchors : 2)), text: 'Hello' };
  const fields = drawingFields(subject, entry);
  assert.ok(fields.some((field) => field.tab === 'Text' && field.key === 'text'));
  const values: FieldValues = Object.fromEntries(fields.map((field) => [field.key, field.value as FieldValues[string]]));
  assert.equal(applyDrawingFields(subject, entry, { ...values, text: 'World' }).text, 'World');
});
