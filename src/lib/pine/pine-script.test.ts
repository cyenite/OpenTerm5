import assert from 'node:assert/strict';
import test from 'node:test';
import { chartTimeframeOf, pineSourceProblem, pineTimeframeOf, readPineHeader } from './pine-script';

const body = 'indicator("Test", overlay = true)\nplot(close)';

test('the header gives the version, an SPDX or recognised licence, and the author', () => {
  assert.deepEqual(readPineHeader(`//@version=6\n// © 2026 builtbyuba · CKD v1.1\n// SPDX-License-Identifier: CC-BY-NC-SA-4.0\n${body}`), { version: 6, author: 'builtbyuba', license: 'CC-BY-NC-SA-4.0' });
  assert.deepEqual(readPineHeader(`// This Pine Script® code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/\n// © LuxAlgo\n//@version=5\n${body}`), { version: 5, author: 'LuxAlgo', license: 'MPL-2.0' });
  assert.deepEqual(readPineHeader(`// This work is licensed under a Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) https://creativecommons.org/licenses/by-nc-sa/4.0/\n//@version=6\n${body}`).license, 'CC-BY-NC-SA-4.0');
  assert.deepEqual(readPineHeader(`//@version=6\n${body}`), { version: 6, author: null, license: null });
});

test('only Pine v5 and v6 indicators without TradingView libraries can run', () => {
  assert.equal(pineSourceProblem(`//@version=6\n${body}`), null);
  assert.equal(pineSourceProblem(`//@version=5\n// a comment\nstudy("Old name")\nplot(close)`), null);
  assert.match(pineSourceProblem('//@PineTS\nindicator("x");\nplot(close);')!, /not Pine Script/);
  assert.match(pineSourceProblem(body)!, /no \/\/@version/);
  assert.match(pineSourceProblem(`//@version=4\n${body}`)!, /v4/);
  assert.match(pineSourceProblem('//@version=6\nstrategy("S")\nplot(close)')!, /strategy/);
  assert.match(pineSourceProblem('//@version=6\nlibrary("L")\nexport f() => 1')!, /library/);
  assert.match(pineSourceProblem(`//@version=6\n${body}\nimport TradingView/ta/7 as tvta`)!, /TradingView\/ta\/7/);
  assert.match(pineSourceProblem('   ')!, /empty/);
});

test('timeframes translate between Pine and the chart', () => {
  assert.deepEqual(['D', '1D', 'W', '3M', '60', '5S', ' 240 '].map(chartTimeframeOf), ['1D', '1D', '1W', '3M', '60', '5s', '240']);
  assert.deepEqual(['1D', '60', '5s'].map(pineTimeframeOf), ['1D', '60', '5S']);
});
