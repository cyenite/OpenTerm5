import assert from 'node:assert/strict';
import test from 'node:test';
import { cursorTools, toolGroups, utilityIcons } from '../drawings/catalogue';
import { icons, iconSvg } from './icons';

const groupIcons = ['group-lines', 'group-fibonacci', 'group-patterns', 'group-forecasting', 'group-shapes', 'group-annotation'];

const requiredNames = [
  ...toolGroups.flatMap((group) => group.sections.flatMap((section) => section.tools.map((tool) => tool.type))),
  ...cursorTools.map((tool) => tool.type),
  ...utilityIcons,
  ...groupIcons,
];

test('every drawing tool, cursor, toolbar utility and toolbar group has an icon', () => {
  const missing = requiredNames.filter((name) => !(typeof icons[name] === 'string' && icons[name].trim().length > 0));
  assert.deepEqual(missing, []);
});

test('the newer tools and toolbar controls are in the set', () => {
  const added = [
    'pitchfan', 'fib-spiral', 'gann-square-fixed', 'bars-pattern', 'ghost-feed', 'forecast',
    'undo', 'redo', 'object-tree', 'replay', 'play', 'pause', 'step-forward', 'stop', 'alert', 'chart-settings', 'copy', 'paste',
    'bring-front', 'send-back', 'visibility', 'text-edit',
  ];
  for (const name of added) assert.ok(icons[name], name);
  for (const name of added.slice(6)) assert.ok((utilityIcons as readonly string[]).includes(name), `${name} is a utility icon`);
  // Each new icon is its own drawing, not a copy of another one.
  const markup = added.map((name) => icons[name]);
  assert.equal(new Set(markup).size, markup.length);
});

test('each toolbar group has its own icon key', () => {
  for (const group of toolGroups) assert.ok(icons[`group-${group.id}`], `group-${group.id}`);
});

test('icon markup is plain geometry: no text, scripts, links, styles or ids', () => {
  for (const [name, markup] of Object.entries(icons)) {
    for (const forbidden of ['<text', '<script', 'href', 'style=', 'id=', '<style', '<use', '<image', '<foreignObject']) {
      assert.equal(markup.includes(forbidden), false, `${name} contains ${forbidden}`);
    }
    const elements = [...markup.matchAll(/<([a-zA-Z]+)\b/g)].map((match) => match[1]);
    for (const element of elements) assert.ok(['path', 'line', 'circle', 'rect', 'ellipse', 'polyline', 'polygon'].includes(element), `${name} uses <${element}>`);
  }
});

test('iconSvg wraps an icon in a 28×28 currentColor outline svg', () => {
  const svg = iconSvg('trend-line');
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /viewBox="0 0 28 28"/);
  assert.match(svg, /width="28" height="28"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.ok(svg.includes(icons['trend-line']));
  assert.match(iconSvg('favorite', 20), /width="20" height="20"/);
});

test('an unknown icon name gives an empty svg', () => {
  const svg = iconSvg('no-such-icon');
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /viewBox="0 0 28 28"/);
  assert.match(svg, /><\/svg>$/);
  assert.equal(iconSvg('toString'), svg);
});
