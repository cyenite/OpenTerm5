// The drawing tools, arranged the way a trader expects to find them: groups on the toolbar,
// each opening a flyout split into sections.

export interface ToolInfo {
  type: string;
  label: string;
}

export interface ToolSection {
  title: string;
  tools: readonly ToolInfo[];
}

export interface ToolGroup {
  id: string;
  label: string;
  sections: readonly ToolSection[];
}

const tool = (type: string, label: string): ToolInfo => ({ type, label });

export const cursorTools: readonly ToolInfo[] = [
  tool('cross', 'Cross'),
  tool('dot', 'Dot'),
  tool('arrow-cursor', 'Arrow'),
  tool('eraser', 'Eraser'),
];

export const toolGroups: readonly ToolGroup[] = [
  {
    id: 'lines',
    label: 'Trend line tools',
    sections: [
      { title: 'Lines', tools: [
        tool('trend-line', 'Trend Line'), tool('ray', 'Ray'), tool('info-line', 'Info Line'), tool('extended-line', 'Extended Line'),
        tool('trend-angle', 'Trend Angle'), tool('horizontal-line', 'Horizontal Line'), tool('horizontal-ray', 'Horizontal Ray'),
        tool('vertical-line', 'Vertical Line'), tool('cross-line', 'Cross Line'),
      ] },
      { title: 'Channels', tools: [
        tool('parallel-channel', 'Parallel Channel'), tool('regression-trend', 'Regression Trend'), tool('flat-top-bottom', 'Flat Top/Bottom'),
        tool('disjoint-channel', 'Disjoint Channel'),
      ] },
      { title: 'Pitchforks', tools: [
        tool('pitchfork', 'Pitchfork'), tool('schiff-pitchfork', 'Schiff Pitchfork'), tool('modified-schiff-pitchfork', 'Modified Schiff Pitchfork'),
        tool('inside-pitchfork', 'Inside Pitchfork'), tool('pitchfan', 'Pitchfan'),
      ] },
    ],
  },
  {
    id: 'fibonacci',
    label: 'Gann and Fibonacci tools',
    sections: [
      { title: 'Fibonacci', tools: [
        tool('fib-retracement', 'Fib Retracement'), tool('fib-extension', 'Trend-Based Fib Extension'), tool('fib-channel', 'Fib Channel'),
        tool('fib-time-zone', 'Fib Time Zone'), tool('fib-speed-fan', 'Fib Speed Resistance Fan'), tool('fib-circles', 'Fib Circles'),
        tool('fib-arcs', 'Fib Speed Resistance Arcs'), tool('fib-wedge', 'Fib Wedge'),
        tool('fib-spiral', 'Fib Spiral'),
      ] },
      { title: 'Gann', tools: [tool('gann-box', 'Gann Box'), tool('gann-square-fixed', 'Gann Square Fixed'), tool('gann-square', 'Gann Square'), tool('gann-fan', 'Gann Fan')] },
    ],
  },
  {
    id: 'patterns',
    label: 'Patterns',
    sections: [
      { title: 'Chart patterns', tools: [
        tool('xabcd-pattern', 'XABCD Pattern'), tool('cypher-pattern', 'Cypher Pattern'), tool('head-shoulders', 'Head and Shoulders'),
        tool('abcd-pattern', 'ABCD Pattern'), tool('triangle-pattern', 'Triangle Pattern'), tool('three-drives', 'Three Drives Pattern'),
      ] },
      { title: 'Elliott waves', tools: [
        tool('elliott-impulse', 'Elliott Impulse Wave (12345)'), tool('elliott-correction', 'Elliott Correction Wave (ABC)'),
        tool('elliott-triangle', 'Elliott Triangle Wave (ABCDE)'), tool('elliott-double-combo', 'Elliott Double Combo Wave (WXY)'),
        tool('elliott-triple-combo', 'Elliott Triple Combo Wave (WXYXZ)'),
      ] },
      { title: 'Cycles', tools: [tool('cyclic-lines', 'Cyclic Lines'), tool('time-cycles', 'Time Cycles'), tool('sine-line', 'Sine Line')] },
    ],
  },
  {
    id: 'forecasting',
    label: 'Forecasting and measurement tools',
    sections: [
      { title: 'Forecasting', tools: [
        tool('long-position', 'Long Position'), tool('short-position', 'Short Position'), tool('forecast', 'Forecast'), tool('bars-pattern', 'Bars Pattern'),
        tool('ghost-feed', 'Ghost Feed'), tool('projection', 'Projection'),
      ] },
      { title: 'Volume-based', tools: [tool('anchored-vwap', 'Anchored VWAP'), tool('fixed-range-volume-profile', 'Fixed Range Volume Profile')] },
      { title: 'Measurer', tools: [tool('price-range', 'Price Range'), tool('date-range', 'Date Range'), tool('date-price-range', 'Date and Price Range')] },
    ],
  },
  {
    id: 'shapes',
    label: 'Geometric shapes',
    sections: [
      { title: 'Brushes', tools: [tool('brush', 'Brush'), tool('highlighter', 'Highlighter')] },
      { title: 'Arrows', tools: [tool('arrow-marker', 'Arrow Marker'), tool('arrow', 'Arrow'), tool('arrow-mark-up', 'Arrow Mark Up'), tool('arrow-mark-down', 'Arrow Mark Down')] },
      { title: 'Shapes', tools: [
        tool('rectangle', 'Rectangle'), tool('rotated-rectangle', 'Rotated Rectangle'), tool('path', 'Path'), tool('circle', 'Circle'),
        tool('ellipse', 'Ellipse'), tool('polyline', 'Polyline'), tool('triangle', 'Triangle'), tool('arc', 'Arc'), tool('curve', 'Curve'),
        tool('double-curve', 'Double Curve'),
      ] },
    ],
  },
  {
    id: 'annotation',
    label: 'Annotation tools',
    sections: [
      { title: 'Text and notes', tools: [
        tool('text', 'Text'), tool('anchored-text', 'Anchored Text'), tool('note', 'Note'), tool('price-note', 'Price Note'), tool('pin', 'Pin'),
        tool('callout', 'Callout'), tool('comment', 'Comment'), tool('price-label', 'Price Label'), tool('signpost', 'Signpost'), tool('flag-mark', 'Flag Mark'),
      ] },
    ],
  },
];

export const drawingToolInfo: ReadonlyMap<string, ToolInfo & { groupId: string }> = new Map(
  toolGroups.flatMap((group) => group.sections.flatMap((section) => section.tools.map((info) => [info.type, { ...info, groupId: group.id }] as const))),
);

// Toolbar controls that are not drawing tools; each needs an icon too.
export const utilityIcons = [
  'measure', 'zoom-in', 'magnet-weak', 'magnet-strong', 'stay-in-drawing-mode', 'lock-all', 'hide-all', 'remove-all', 'favorite', 'favorite-filled',
  'chevron-right', 'chevron-left', 'eye', 'eye-off', 'settings', 'close', 'more', 'lock', 'unlock', 'trash', 'clone', 'text-color', 'line-width',
  'undo', 'redo', 'object-tree', 'replay', 'play', 'pause', 'step-forward', 'stop', 'alert', 'chart-settings', 'copy', 'paste', 'bring-front',
  'send-back', 'visibility', 'text-edit',
] as const;
