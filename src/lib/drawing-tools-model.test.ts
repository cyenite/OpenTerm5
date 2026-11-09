import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultDrawingTools, parseDrawingTools, savedDrawingTools } from './drawing-tools-model';

test('saved rail switches come back, and anything unreadable falls back to the defaults', () => {
  assert.deepEqual(parseDrawingTools({ cursor: 'dot', magnet: 'strong', isStayMode: true, isLocked: true, isHidden: false }), { cursor: 'dot', magnet: 'strong', isStayMode: true, isLocked: true, isHidden: false });
  assert.deepEqual(parseDrawingTools({ cursor: 'eraser', magnet: 'huge', isStayMode: 'yes' }), defaultDrawingTools);
  assert.deepEqual(parseDrawingTools(null), defaultDrawingTools);
});

test('the tool in hand is not saved with the switches', () => {
  const saved = savedDrawingTools({ tool: 'trend-line', cursor: 'dot', magnet: 'weak', isStayMode: true, isLocked: false, isHidden: true });
  assert.equal('tool' in saved, false);
  assert.deepEqual(parseDrawingTools(JSON.parse(JSON.stringify(saved))), saved);
});
