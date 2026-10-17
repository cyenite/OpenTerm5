import assert from 'node:assert/strict';
import test from 'node:test';
import { pineOverrides, readPineInputs, studyInputs } from './pine-inputs';

// As PineTS 0.11.1's Indicator.getInputsMeta() reports them.
const meta = [
  { id: 'in_0', name: 'Length', type: 'int', defval: 20, varId: 'len', title: 'Length', group: 'Main', display: 'all', minval: 1 },
  { id: 'in_1', name: 'Source', type: 'source', defval: 'close', title: 'Source', options: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'hlcc4', 'ohlc4'] },
  { id: 'in_2', name: 'Colour', type: 'color', defval: '#FF9800FF', title: 'Colour', group: 'Main', inline: 'a' },
  { id: 'in_3', name: 'Mode', type: 'enum', defval: 'Fast', title: 'Mode', options: ['Fast', 'Slow'] },
  { id: 'in_4', name: 'Period', type: 'int', defval: 5, title: 'Period', options: [5, 10] },
  { id: 'in_5', name: 'When', type: 'time', defval: 1767225600000, title: 'When', display: 'none' },
  { id: 'in_6', name: 'Session', type: 'session', defval: '0930-1600', title: '' },
  { name: 'no id' },
];

test('Pine inputs become study inputs keyed by their PineTS id', () => {
  const inputs = studyInputs(readPineInputs(meta));
  assert.deepEqual(inputs, [
    { key: 'in_0', title: 'Length', type: 'int', default: 20, min: 1 },
    { key: 'in_1', title: 'Source', type: 'select', default: 'close', options: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'hlcc4', 'ohlc4'] },
    { key: 'in_2', title: 'Colour', row: 'Main\u0000a', type: 'color', default: '#FF9800' },
    { key: 'in_3', title: 'Mode', type: 'select', default: 'Fast', options: ['Fast', 'Slow'] },
    { key: 'in_4', title: 'Period', type: 'select', default: '5', options: ['5', '10'] },
    { key: 'in_5', title: 'When', isCaptionHidden: true, type: 'time', default: 1767225600000 },
    { key: 'in_6', title: 'Session', type: 'text', default: '0930-1600' },
  ]);
});

test('chart values go back to PineTS typed as the script declared them', () => {
  const inputs = readPineInputs(meta);
  assert.deepEqual(pineOverrides(inputs, { in_0: 14, in_3: 'Slow', in_4: '10', in_2: '#ff000080', other: 1 }), { in_0: 14, in_2: '#ff000080', in_3: 'Slow', in_4: 10 });
});
