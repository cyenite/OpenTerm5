import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decidePlan, validateDrag } from './order-plan';

const quote = { bid: 1.1, ask: 1.1002 };

test('the stop decides the side and the entry decides limit or stop', () => {
  assert.equal(decidePlan({ entry: 1.095, stop: 1.09 }, quote, false).type, 'buyLimit');
  assert.equal(decidePlan({ entry: 1.105, stop: 1.1 + 0.001 }, quote, false).type, 'buyStop');
  assert.equal(decidePlan({ entry: 1.105, stop: 1.11 }, quote, false).type, 'sellLimit');
  assert.equal(decidePlan({ entry: 1.095, stop: 1.0975 }, quote, false).type, 'sellStop');
});

test('no stop means no decision yet', () => {
  const decision = decidePlan({ entry: 1.095 }, quote, false);
  assert.equal(decision.side, undefined);
  assert.equal(decision.error, undefined);
});

test('an entry inside the spread or a forced market order fills at the live price', () => {
  const inside = decidePlan({ entry: 1.1001, stop: 1.099 }, quote, false);
  assert.deepEqual([inside.type, inside.isMarket, inside.entry], ['buy', true, 1.1002]);
  const forced = decidePlan({ entry: 1.09, stop: 1.11 }, quote, true);
  assert.deepEqual([forced.type, forced.entry], ['sell', 1.1]);
});

test('impossible layouts are explained', () => {
  assert.match(decidePlan({ entry: 1.09, stop: 1.09 }, quote, false).error!, /cannot sit/);
  assert.match(decidePlan({ entry: 1.095, stop: 1.09, target: 1.093 }, quote, false).error!, /above the entry/);
  assert.match(decidePlan({ entry: 1.12, stop: 1.11 }, quote, true).error!, /beyond the stop/);
  assert.match(decidePlan({ entry: 1.0999, stop: 1.09 }, quote, false, 0.001).error!, /closer/);
  assert.match(decidePlan({ entry: 1.095, stop: 1.09 }, undefined, false).error!, /quote/);
});

test('dragged levels must stay on the correct side of the price', () => {
  assert.equal(validateDrag({ kind: 'sl', side: 'buy', price: 1.09, reference: 1.1 }), null);
  assert.match(validateDrag({ kind: 'sl', side: 'buy', price: 1.11, reference: 1.1 })!, /below/);
  assert.match(validateDrag({ kind: 'tp', side: 'sell', price: 1.11, reference: 1.1 })!, /below/);
  assert.equal(validateDrag({ kind: 'price', side: 'buy', price: 1.11, reference: 1.1 }), null);
});
