// The toolbar icon set: thin 1px outline drawings on a 28×28 grid, in the manner of a trading
// terminal's drawing toolbar. Each entry is the inner markup of an <svg viewBox="0 0 28 28">; the
// caller renders it with stroke="currentColor", fill="none", stroke-width 1 and round caps/joins
// (see `iconSvg`). Straight horizontal and vertical strokes sit on half pixels so they stay crisp.
//
// Drawing tools share one vocabulary: lines run between anchor points, and anchors are small hollow
// circles that the lines stop short of rather than run through.

type Point = readonly [number, number];

const ANCHOR_RADIUS = 1.75;
const DASH = ' stroke-dasharray="1.5 2.5"';
const SOFT = ' fill="currentColor" fill-opacity="0.15"';
const SOLID = ' fill="currentColor"';
const FAINT = ' stroke-opacity="0.55"';

const num = (value: number): string => String(Math.round(value * 100) / 100);
const pt = ([x, y]: Point): string => `${num(x)} ${num(y)}`;
const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

// The point `length` along the way from `from` towards `to`.
function toward(from: Point, to: Point, length: number): Point {
  const total = distance(from, to) || 1;
  return [from[0] + ((to[0] - from[0]) * length) / total, from[1] + ((to[1] - from[1]) * length) / total];
}

const polar = (center: Point, radius: number, degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180;
  return [center[0] + radius * Math.cos(radians), center[1] - radius * Math.sin(radians)];
};

const path = (d: string, attrs = ''): string => `<path d="${d}"${attrs}/>`;
const anchor = ([x, y]: Point): string => `<circle cx="${num(x)}" cy="${num(y)}" r="${ANCHOR_RADIUS}"/>`;
const circle = ([x, y]: Point, r: number, attrs = ''): string => `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}"${attrs}/>`;
const rect = (x: number, y: number, width: number, height: number, attrs = ''): string =>
  `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"${attrs}/>`;

// A straight segment that stops short of the anchors at either end.
function link(a: Point, b: Point, anchorA = true, anchorB = true, attrs = ''): string {
  const start = anchorA ? toward(a, b, ANCHOR_RADIUS) : a;
  const end = anchorB ? toward(b, a, ANCHOR_RADIUS) : b;
  return path(`M${pt(start)}L${pt(end)}`, attrs);
}

type AnchorChoice = 'all' | 'none' | 'ends' | readonly number[];

// A polyline (or closed polygon) through `points`, with hollow anchors on the chosen vertices and the
// strokes broken around them. Runs of unanchored vertices stay one path so their joins are proper joins.
// With `drawAnchors` false the strokes are still broken but the circles are left to another element.
function chain(points: readonly Point[], anchors: AnchorChoice = 'all', closed = false, attrs = '', drawAnchors = true): string {
  const count = points.length;
  const anchored = new Set<number>(
    anchors === 'all' ? points.map((_, index) => index) : anchors === 'none' ? [] : anchors === 'ends' ? [0, count - 1] : anchors,
  );
  const edges = closed ? count : count - 1;
  let d = '';
  let open = false;
  for (let index = 0; index < edges; index += 1) {
    const a = points[index];
    const nextIndex = (index + 1) % count;
    const b = points[nextIndex];
    const start = anchored.has(index) ? toward(a, b, ANCHOR_RADIUS) : a;
    const end = anchored.has(nextIndex) ? toward(b, a, ANCHOR_RADIUS) : b;
    if (!open || anchored.has(index)) d += `M${pt(start)}`;
    d += `L${pt(end)}`;
    open = !anchored.has(nextIndex);
  }
  if (closed && anchored.size === 0) d += 'Z';
  if (!drawAnchors) return path(d, attrs);
  return path(d, attrs) + [...anchored].sort((x, y) => x - y).map((index) => anchor(points[index])).join('');
}

// A smooth curve sampled from `at(t)` for t in [0, 1], trimmed back from anchors at either end
// (`curveStroke` trims without drawing the anchors, for a curve that starts on another one's anchor).
function curve(at: (t: number) => Point, anchorStart = false, anchorEnd = false, attrs = ''): string {
  return curveStroke(at, anchorStart, anchorEnd, attrs) + (anchorStart ? anchor(at(0)) : '') + (anchorEnd ? anchor(at(1)) : '');
}

function curveStroke(at: (t: number) => Point, anchorStart: boolean, anchorEnd: boolean, attrs = '', steps = 48): string {
  const trim = (fromStart: boolean): number => {
    const origin = at(fromStart ? 0 : 1);
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      const p = at(fromStart ? mid : 1 - mid);
      if (distance(origin, p) < ANCHOR_RADIUS) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const t0 = anchorStart ? trim(true) : 0;
  const t1 = anchorEnd ? 1 - trim(false) : 1;
  let d = '';
  for (let i = 0; i <= steps; i += 1) d += `${i === 0 ? 'M' : 'L'}${pt(at(t0 + ((t1 - t0) * i) / steps))}`;
  return path(d, attrs);
}

// Circular arc from `fromDeg` to `toDeg` (maths convention: counter-clockwise, y up).
const arc = (center: Point, radius: number, fromDeg: number, toDeg: number, anchorStart = false, anchorEnd = false, attrs = ''): string =>
  curve((t) => polar(center, radius, fromDeg + (toDeg - fromDeg) * t), anchorStart, anchorEnd, attrs);

const quadratic = (a: Point, c: Point, b: Point) => (t: number): Point => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};

const cubic = (a: Point, c1: Point, c2: Point, b: Point) => (t: number): Point => {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w[0] * a[0] + w[1] * c1[0] + w[2] * c2[0] + w[3] * b[0], w[0] * a[1] + w[1] * c1[1] + w[2] * c2[1] + w[3] * b[1]];
};

// Two short strokes forming an open arrowhead at `tip`, pointing away from `from`.
function arrowhead(tip: Point, from: Point, length = 4, spreadDeg = 40, attrs = ''): string {
  const angle = Math.atan2(from[1] - tip[1], from[0] - tip[0]);
  const spread = (spreadDeg * Math.PI) / 180;
  const wing = (sign: number): Point => [tip[0] + length * Math.cos(angle + sign * spread), tip[1] + length * Math.sin(angle + sign * spread)];
  return path(`M${pt(wing(1))}L${pt(tip)}L${pt(wing(-1))}`, attrs);
}

// --- Lines ----------------------------------------------------------------------------------------

const trendLine = link([6.5, 21.5], [21.5, 6.5]) + anchor([6.5, 21.5]) + anchor([21.5, 6.5]);

function horizontal(y: number, from: number, to: number, gapsAt: readonly number[] = []): string {
  let d = '';
  let x = from;
  for (const gap of [...gapsAt].sort((a, b) => a - b)) {
    if (gap - ANCHOR_RADIUS > x) d += `M${num(x)} ${num(y)}H${num(gap - ANCHOR_RADIUS)}`;
    x = gap + ANCHOR_RADIUS;
  }
  if (to > x) d += `M${num(x)} ${num(y)}H${num(to)}`;
  return path(d);
}

function vertical(x: number, from: number, to: number, gapsAt: readonly number[] = []): string {
  let d = '';
  let y = from;
  for (const gap of [...gapsAt].sort((a, b) => a - b)) {
    if (gap - ANCHOR_RADIUS > y) d += `M${num(x)} ${num(y)}V${num(gap - ANCHOR_RADIUS)}`;
    y = gap + ANCHOR_RADIUS;
  }
  if (to > y) d += `M${num(x)} ${num(y)}V${num(to)}`;
  return path(d);
}

function trendAngle(): string {
  const origin: Point = [6.5, 20.5];
  const end: Point = [21.5, 9.5];
  const degrees = (Math.atan2(origin[1] - end[1], end[0] - origin[0]) * 180) / Math.PI;
  return (
    link(origin, end) + anchor(origin) + anchor(end) +
    path(`M${num(origin[0] + ANCHOR_RADIUS)} 20.5H22.5`, DASH) +
    arc(origin, 8, 0, degrees)
  );
}

// A pitchfork: a handle from `origin` through the midpoint of P1–P2, and tines parallel to it.
function pitchfork(p0: Point, p1: Point, p2: Point, origin: Point = p0, inner = false): string {
  const mid: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const dx = mid[0] - origin[0];
  const dy = mid[1] - origin[1];
  const reach = (from: Point): Point => {
    let t = (23.5 - from[0]) / dx;
    if (dy < 0) t = Math.min(t, (4.5 - from[1]) / dy);
    if (dy > 0) t = Math.min(t, (23.5 - from[1]) / dy);
    return [from[0] + dx * t, from[1] + dy * t];
  };
  const originIsAnchor = origin[0] === p0[0] && origin[1] === p0[1];
  let out = link(origin, reach(mid), originIsAnchor, false) + link(p1, p2) + link(p1, reach(p1), true, false) + link(p2, reach(p2), true, false);
  if (!originIsAnchor) out += link(p0, origin, true, false, DASH);
  if (inner) {
    const q1: Point = [(p1[0] + mid[0]) / 2, (p1[1] + mid[1]) / 2];
    const q2: Point = [(p2[0] + mid[0]) / 2, (p2[1] + mid[1]) / 2];
    out += link(q1, reach(q1), false, false, DASH) + link(q2, reach(q2), false, false, DASH);
  }
  return out + anchor(p0) + anchor(p1) + anchor(p2);
}

// A ray from `from` through `through`, stopped at the edge of the 4.5–23.5 drawing area.
function rayEnd(from: Point, through: Point): Point {
  const dx = through[0] - from[0];
  const dy = through[1] - from[1];
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (23.5 - from[0]) / dx);
  if (dx < 0) t = Math.min(t, (4.5 - from[0]) / dx);
  if (dy > 0) t = Math.min(t, (23.5 - from[1]) / dy);
  if (dy < 0) t = Math.min(t, (4.5 - from[1]) / dy);
  return [from[0] + dx * t, from[1] + dy * t];
}

// A pitchfan: rays from the pivot through both reaction points and the middle of the reaction leg.
function pitchfan(): string {
  const a: Point = [5.5, 15.5];
  const b: Point = [14.5, 7.5];
  const c: Point = [16.5, 20.5];
  const mid: Point = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  return (
    link(a, b) + link(b, rayEnd(a, b), true, false) +
    link(a, c) + link(c, rayEnd(a, c), true, false) +
    link(a, rayEnd(a, mid), true, false) + link(b, c, true, true, FAINT) +
    anchor(a) + anchor(b) + anchor(c)
  );
}

// --- Fibonacci and Gann ---------------------------------------------------------------------------

function fibRetracement(): string {
  const low: Point = [7.5, 21.5];
  const high: Point = [20.5, 6.5];
  return (
    horizontal(6.5, 4.5, 23.5, [high[0]]) + horizontal(11.5, 4.5, 23.5) + horizontal(16.5, 4.5, 23.5) + horizontal(21.5, 4.5, 23.5, [low[0]]) +
    link(low, high, true, true, DASH) + anchor(low) + anchor(high)
  );
}

function fibExtension(): string {
  const a: Point = [5.5, 21.5];
  const b: Point = [10.5, 8.5];
  const c: Point = [14.5, 16.5];
  return (
    chain([a, b, c], 'all', false, DASH) +
    horizontal(5.5, 14.5, 23.5) + horizontal(10.5, 17.5, 23.5) + horizontal(16.5, 14.5 + ANCHOR_RADIUS, 23.5) + horizontal(22.5, 14.5, 23.5)
  );
}

function fibChannel(): string {
  const at = (x: number, base: number): Point => [x, base - 0.42 * (x - 4.5)];
  const a = at(7.5, 23.5);
  const b = at(20.5, 23.5);
  return (
    link(at(4.5, 23.5), a, false, true) + link(a, b) + link(b, at(23.5, 23.5), true, false) +
    link(at(4.5, 18.5), at(23.5, 18.5), false, false, DASH) +
    link(at(4.5, 13.5), at(7.5, 13.5), false, true) + link(at(7.5, 13.5), at(23.5, 13.5), true, false) +
    anchor(a) + anchor(b) + anchor(at(7.5, 13.5))
  );
}

function fibTimeZone(): string {
  // Zones at 0, 1, 2, 3, 5 and 8 units, with the outer two lines anchored.
  const xs = [5.5, 7.5, 9.5, 11.5, 15.5, 21.5];
  const last = xs.length - 1;
  return (
    xs.map((x, index) => vertical(x, 4.5, 23.5, index === 0 || index === last ? [20.5] : [])).join('') +
    anchor([xs[0], 20.5]) + anchor([xs[last], 20.5])
  );
}

function fibSpeedFan(): string {
  const origin: Point = [5.5, 22.5];
  const corner: Point = [22.5, 5.5];
  const size = 17;
  const fan = [0.382, 0.618].flatMap((f) => [
    link(origin, [22.5, 22.5 - size * f], true, false),
    link(origin, [5.5 + size * f, 5.5], true, false),
  ]);
  return (
    fan.join('') + link(origin, corner) +
    path(`M5.5 5.5H${num(22.5 - ANCHOR_RADIUS)}M22.5 ${num(5.5 + ANCHOR_RADIUS)}V22.5`, DASH) +
    anchor(origin) + anchor(corner)
  );
}

function fibCircles(): string {
  const center: Point = [14, 14];
  const edge = polar(center, 9.5, 45);
  return (
    circle(center, 3.5) + circle(center, 6.5) +
    arc(center, 9.5, 45, 405, true, true) +
    link(center, edge, true, true, DASH) + anchor(center)
  );
}

function fibArcs(): string {
  const base: Point = [14, 21.5];
  const start: Point = [6.5, 6.5];
  return (
    arc(base, 4, 0, 180) + arc(base, 7, 0, 180) + arc(base, 9.5, 0, 180) +
    link(start, base, true, true, DASH) + anchor(start) + anchor(base)
  );
}

function fibWedge(): string {
  const apex: Point = [5.5, 14];
  const upper = 32;
  const lower = -32;
  const length = 17;
  const a = polar(apex, length, upper);
  const b = polar(apex, length, lower);
  return (
    link(apex, a) + link(apex, b) +
    arc(apex, 7, lower, upper, false, false, FAINT) + arc(apex, 12, lower, upper, false, false, FAINT) +
    arc(apex, length, lower, upper, true, true) +
    anchor(apex)
  );
}

// A spiral unwinding from its centre anchor out to the second anchor (one and a half turns).
function fibSpiral(): string {
  const center: Point = [13.5, 14.5];
  const r0 = 2.6;
  const r1 = 9.5;
  const sweepAngle = Math.PI * 3;
  const growth = Math.log(r1 / r0) / sweepAngle;
  const at = (t: number): Point => {
    const angle = sweepAngle * t;
    const r = r0 * Math.exp(growth * angle);
    return [center[0] + r * Math.cos(angle + 0.6), center[1] - r * Math.sin(angle + 0.6)];
  };
  return curveStroke(at, false, true, '', 96) + anchor(at(1)) + anchor(center);
}

const gannBox =
  chain([[6.5, 21.5], [6.5, 6.5], [21.5, 6.5], [21.5, 21.5]], [0, 2], true) +
  path('M11.5 6.5V21.5M16.5 6.5V21.5M6.5 11.5H21.5M6.5 16.5H21.5', FAINT);

const gannSquare =
  chain([[6.5, 21.5], [6.5, 6.5], [21.5, 6.5], [21.5, 21.5]], [0, 2], true) +
  link([6.5, 21.5], [21.5, 6.5], true, true) + path('M6.5 6.5L21.5 21.5', FAINT) +
  arc([6.5, 21.5], 15, 0, 90, false, false, FAINT);

// A fixed square: quarter grid, arcs from the pivot and fan lines, sized from one anchor.
const gannSquareFixed =
  chain([[6.5, 21.5], [6.5, 6.5], [21.5, 6.5], [21.5, 21.5]], [0], true) +
  path('M14 6.5V21.5M6.5 14H21.5', FAINT) +
  arc([6.5, 21.5], 7.5, 0, 90, false, false, FAINT) +
  link([6.5, 21.5], [21.5, 14], true, false) + link([6.5, 21.5], [14, 6.5], true, false) + link([6.5, 21.5], [21.5, 6.5], true, false);

function gannFan(): string {
  const origin: Point = [5.5, 22.5];
  const size = 18;
  const ends = [0.25, 0.5, 2, 4].map((slope): Point => (slope <= 1 ? [origin[0] + size, origin[1] - size * slope] : [origin[0] + size / slope, origin[1] - size]));
  const corner: Point = [origin[0] + size, origin[1] - size];
  return ends.map((end) => link(origin, end, true, false)).join('') + link(origin, corner) + anchor(origin) + anchor(corner);
}

// --- Patterns -------------------------------------------------------------------------------------

const xabcd = (): string => {
  const pts: Point[] = [[4.5, 20.5], [9.5, 7.5], [13.5, 15.5], [18.5, 10.5], [23.5, 21.5]];
  return chain(pts) + link(pts[0], pts[2], true, true, DASH) + link(pts[2], pts[4], true, true, DASH);
};

const cypher = (): string => {
  const pts: Point[] = [[4.5, 21.5], [9.5, 11.5], [13.5, 16.5], [18.5, 5.5], [23.5, 17.5]];
  return chain(pts) + link(pts[0], pts[2], true, true, DASH) + link(pts[1], pts[3], true, true, DASH);
};

const headShoulders = (): string =>
  chain([[4.5, 21.5], [8, 12.5], [11, 17.5], [14, 5.5], [17, 17.5], [20, 12.5], [23.5, 21.5]], [1, 3, 5]) +
  path('M5.5 17.5H23', DASH);

const abcd = (): string => {
  const pts: Point[] = [[5.5, 21.5], [11, 7.5], [16, 15.5], [22.5, 5.5]];
  return chain(pts) + link(pts[0], pts[2], true, true, DASH) + link(pts[1], pts[3], true, true, DASH);
};

function trianglePattern(): string {
  // The swings touch two converging boundaries that meet at the apex on the right.
  // The apex itself lies just beyond the right edge.
  const onUpper = (x: number): Point => [x, 4.5 + ((14 - 4.5) * (x - 4.5)) / 22];
  const onLower = (x: number): Point => [x, 23.5 - ((23.5 - 14) * (x - 4.5)) / 22];
  const pts = [onUpper(4.5), onLower(10.5), onUpper(16.5), onLower(22)];
  return (
    chain(pts) +
    chain([pts[0], pts[2], onUpper(23.5)], [0, 1], false, FAINT, false) + chain([onLower(4.5), pts[1], pts[3]], [1, 2], false, FAINT, false)
  );
}

const threeDrives = (): string =>
  chain([[4.5, 23], [8.5, 16], [11, 19.5], [15, 11], [17.5, 14.5], [22.5, 5]], [0, 1, 3, 5]);

const elliottImpulse = (): string => chain([[4.5, 22.5], [8.5, 15.5], [11.5, 19.5], [16.5, 8.5], [19.5, 12.5], [23.5, 5.5]]);
const elliottCorrection = (): string => chain([[5.5, 6.5], [11.5, 18.5], [16, 12.5], [22.5, 22.5]]);
const elliottTriangle = (): string => chain([[4.5, 5.5], [8.5, 21.5], [12.5, 9.5], [16.5, 18.5], [19.5, 12], [23.5, 15.5]]);
const elliottDoubleCombo = (): string =>
  chain([[4.5, 5], [8, 12.5], [10, 9.5], [13.5, 15.5], [16, 12.5], [19.5, 19.5], [21, 17.5], [23.5, 23]], [0, 3, 4, 7]);
const elliottTripleCombo = (): string => chain([[4.5, 5.5], [8.5, 12.5], [11.5, 9.5], [15, 16.5], [18, 13.5], [23.5, 22.5]]);

function cyclicLines(): string {
  return [5.5, 11.5, 17.5, 23.5].map((x, index) => vertical(x, 4.5, 23.5, index < 2 ? [14] : [])).join('') +
    path(`M${num(5.5 + ANCHOR_RADIUS)} 14H${num(11.5 - ANCHOR_RADIUS)}`, DASH) + anchor([5.5, 14]) + anchor([11.5, 14]);
}

function timeCycles(): string {
  const base = 20.5;
  const xs = [4.5, 14, 23.5];
  const rx = (xs[1] - xs[0]) / 2;
  const hump = (from: number) => (t: number): Point => [from + rx - rx * Math.cos(Math.PI * t), base - 11 * Math.sin(Math.PI * t)];
  // The second cycle starts on the first one's end anchor.
  return curve(hump(xs[0]), true, true) + curveStroke(hump(xs[1]), true, false);
}

function sineLine(): string {
  const at = (x: number): Point => [x, 14 - 5.5 * Math.sin((2 * Math.PI * (x - 4)) / 10)];
  const span = (from: number, to: number, a: boolean, b: boolean): string => curve((t) => at(from + (to - from) * t), a, b);
  return span(4, 6.5, false, true) + span(6.5, 11.5, true, true) + span(11.5, 24, true, false);
}

// --- Forecasting ----------------------------------------------------------------------------------

const position = (long: boolean): string => {
  const profit = long ? rect(6.5, 5.5, 15, 9, SOFT) : rect(6.5, 13.5, 15, 9, SOFT);
  const loss = long ? rect(6.5, 14.5, 15, 7) : rect(6.5, 6.5, 15, 7);
  const arrow = long ? path('M14 12V7.5M11.5 10L14 7.5L16.5 10') : path('M14 16V20.5M11.5 18L14 20.5L16.5 18');
  return profit + loss + arrow;
};

function projection(): string {
  const a: Point = [5.5, 21.5];
  const b: Point = [12.5, 7.5];
  const c: Point = [22.5, 17.5];
  return path(`M${pt(a)}L${pt(b)}L${pt(c)}Z`, `${SOFT} stroke="none"`) + chain([a, b, c]) + link(a, c, true, true, DASH);
}

// A candle centred on a half-pixel column: wick from `high` to `low`, body between `top` and `bottom`.
function candle(x: number, high: number, top: number, bottom: number, low: number, attrs = ''): string {
  return path(`M${num(x)} ${num(high)}V${num(top)}M${num(x)} ${num(bottom)}V${num(low)}`, attrs) + rect(x - 1, top, 2, bottom - top, attrs);
}

// The bars between two anchors (bracketed), copied faintly further along.
function barsPattern(): string {
  const shape: [number, number, number, number, number][] = [[7.5, 9.5, 11.5, 16.5, 19.5], [10.5, 12.5, 14.5, 18.5, 21.5]];
  return (
    rect(4.5, 7.5, 9, 16, DASH) +
    shape.map(([x, ...ys]) => candle(x, ...(ys as [number, number, number, number]))).join('') +
    shape.map(([x, high, top, bottom, low]) => candle(x + 11, high - 4, top - 4, bottom - 4, low - 4, FAINT)).join('')
  );
}

// Real bars on the left, then faint projected candles rising to a peak and falling back.
function ghostFeed(): string {
  return (
    candle(5.5, 15.5, 17.5, 21.5, 23.5) + candle(9.5, 12.5, 14.5, 18.5, 20.5) +
    [candle(15.5, 8.5, 10.5, 14.5, 16.5, FAINT), candle(18.5, 4.5, 6.5, 10.5, 12.5, FAINT), candle(22.5, 8.5, 9.5, 13.5, 15.5, FAINT)].join('') +
    path('M12.5 4.5V23.5', DASH)
  );
}

// A price history ending at the source anchor, and a dashed forecast arrow to the target.
function forecast(): string {
  const source: Point = [12.5, 16.5];
  const target: Point = [22.5, 7.5];
  return (
    chain([[4.5, 20.5], [7.5, 17.5], [9.5, 19.5], source], [3]) +
    link(source, target, true, true, DASH) + anchor(target) +
    path(`M${num(target[0] - 6)} 7.5H${num(target[0] - ANCHOR_RADIUS)}`, FAINT)
  );
}

const anchoredVwap = (): string =>
  curve(cubic([5.5, 20.5], [11, 13], [14, 18], [23.5, 7.5]), true) +
  path('M10.5 22.5V18.5M14.5 22.5V19.5M18.5 22.5V16.5', FAINT);

const volumeProfile = (): string =>
  path('M5.5 4.5V23.5M22.5 4.5V23.5', DASH) +
  [[5, 7], [9, 10.5], [13, 14], [8, 17.5], [4, 21]]
    .map(([width, y]) => rect(5.5, y - 1.25, width, 2.5, SOFT))
    .join('');

const priceRange = path('M6.5 5.5H21.5M6.5 22.5H21.5M14 20.5V8') + arrowhead([14, 8], [14, 20.5], 3.5, 45);
const dateRange = path('M5.5 6.5V21.5M22.5 6.5V21.5M7.5 14H20') + arrowhead([20, 14], [7.5, 14], 3.5, 45);
const datePriceRange =
  rect(5.5, 5.5, 17, 17, DASH) +
  path('M14 19.5V8.5M8.5 14H19.5') + arrowhead([14, 8.5], [14, 19.5], 3, 45) + arrowhead([19.5, 14], [8.5, 14], 3, 45);

// --- Shapes ---------------------------------------------------------------------------------------

// A paintbrush leaning to the right with a short stroke of paint under its tip.
const brush =
  path('M21 4L24 7L15.5 15.5L12.5 12.5Z') +
  path('M12.5 12.5L15.5 15.5C15 19 12 21.5 7.5 21.5C9.5 20 9.5 17 10 15C10.5 13.5 11.5 12.5 12.5 12.5Z') +
  path('M4.5 23.5C5.5 23 6.5 22.7 7.5 22.6');

const highlighter =
  path('M20 4.5L23.5 8L14 17.5L10.5 14Z') +
  path('M10.5 14L14 17.5L12 19.5H8.5V16Z') +
  rect(4.5, 21.5, 19, 2, SOFT);

const blockArrowUp: Point[] = [[14, 5.5], [20.5, 12.5], [16.5, 12.5], [16.5, 22.5], [11.5, 22.5], [11.5, 12.5], [7.5, 12.5]];
const blockArrow = (points: readonly Point[], attrs = ''): string => path(`M${points.map(pt).join('L')}Z`, attrs);

const arrowMarker = blockArrow(blockArrowUp, ' transform="rotate(45 14 14)"');
const arrowLine = link([6.5, 21.5], [21.5, 6.5], true, false) + path('M15.5 6.5H21.5V12.5') + anchor([6.5, 21.5]);
const arrowMarkUp = blockArrow(blockArrowUp);
const arrowMarkDown = blockArrow(blockArrowUp.map(([x, y]): Point => [x, 28 - y]));

const rectangle = chain([[5.5, 8.5], [22.5, 8.5], [22.5, 19.5], [5.5, 19.5]], [0, 2], true);

function rotatedRectangle(): string {
  const center: Point = [14, 14];
  const angle = 30;
  const u = polar([0, 0], 1, angle);
  const v = polar([0, 0], 1, angle + 90);
  const corner = (a: number, b: number): Point => [center[0] + u[0] * a + v[0] * b, center[1] + u[1] * a + v[1] * b];
  const pts = [corner(-9, -4.5), corner(9, -4.5), corner(9, 4.5), corner(-9, 4.5)];
  return chain(pts, [0, 1, 2, 3], true);
}

const pathTool = chain([[5.5, 20.5], [10.5, 9.5], [17.5, 17.5], [22.5, 6.5]], [0, 1, 2]) + arrowhead([22.5, 6.5], [17.5, 17.5], 4, 35);

const circleTool = arc([14, 14], 9, 0, 360, true, true) + anchor([14, 14]);

const ellipseTool =
  curve((t) => [14 - 9.5 * Math.cos(Math.PI * t), 14 - 6.5 * Math.sin(Math.PI * t)], true, true) +
  curve((t) => [14 + 9.5 * Math.cos(Math.PI * t), 14 + 6.5 * Math.sin(Math.PI * t)], false, false);

const polylineTool = chain([[5.5, 15.5], [11.5, 5.5], [22.5, 9.5], [18.5, 22.5], [8.5, 20.5]], 'all', true);
const triangleTool = chain([[5.5, 21.5], [12.5, 6.5], [22.5, 17.5]], 'all', true);

function arcTool(): string {
  // A circle through the two ends and the apex.
  const halfChord = 8.5;
  const sagitta = 10;
  const radius = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);
  const center: Point = [14, 7.5 + radius];
  const sweep = (Math.asin(halfChord / radius) * 180) / Math.PI;
  const right = (t: number): Point => polar(center, radius, 90 - sweep * t);
  return arc(center, radius, 90 + sweep, 90, true, true) + curveStroke(right, true, true) + anchor(right(1));
}

const curveTool = curve(quadratic([5.5, 20.5], [9.5, 2.5], [22.5, 16.5]), true, true);
const doubleCurve = curve(cubic([5.5, 18.5], [10, 1], [17, 27], [22.5, 9.5]), true, true);

// --- Annotation -----------------------------------------------------------------------------------

const textGlyph = (left: number, top: number, width: number, height: number): string => {
  const middle = left + width / 2;
  const serif = Math.min(2.5, width / 4);
  return path(
    `M${num(left)} ${num(top + 2)}V${num(top)}H${num(left + width)}V${num(top + 2)}` +
    `M${num(middle)} ${num(top)}V${num(top + height)}M${num(middle - serif)} ${num(top + height)}H${num(middle + serif)}`,
  );
};

const text = textGlyph(7.5, 6.5, 14, 15);
const anchoredText = path(`M8.5 7.5V5.5H20.5V7.5M14.5 5.5V${num(21.5 - ANCHOR_RADIUS)}`) + anchor([14.5, 21.5]);

const note =
  path('M6.5 6.5H21.5V16.5L16.5 21.5H6.5Z') + path('M21.5 16.5H16.5V21.5') +
  path('M9.5 10.5H18.5M9.5 13.5H16.5M9.5 16.5H13.5');

const priceNote =
  path('M11.5 5.5H22.5V13.5H11.5Z') + path('M14 8.5H20M14 10.5H18') +
  link([6.5, 20.5], [11.5, 13.5], true, false) + path(`M${num(6.5 + ANCHOR_RADIUS)} 20.5H22.5`, DASH) + anchor([6.5, 20.5]);

const pin = path('M14 23.5L8.74 13.88A6 6 0 1 1 19.26 13.88Z') + circle([14, 11], 2);

const callout = path('M6.5 6.5H21.5V17.5H13.5L8.5 22.5V17.5H6.5Z') + path('M9.5 10.5H18.5M9.5 13.5H15.5');

const comment =
  path('M9 6.5H19A2.5 2.5 0 0 1 21.5 9V15A2.5 2.5 0 0 1 19 17.5H12.5L8.5 21.5V17.5H9A2.5 2.5 0 0 1 6.5 15V9A2.5 2.5 0 0 1 9 6.5Z') +
  circle([10.5, 12], 0.9, SOLID) + circle([14, 12], 0.9, SOLID) + circle([17.5, 12], 0.9, SOLID);

const priceLabel = path('M5.5 14.5L10.5 8.5H22.5V20.5H10.5Z') + circle([11, 14.5], 1) + path('M14.5 12.5H19.5M14.5 16.5H18.5');

const signpost = path('M7.5 5.5H19.5L22.5 8.5L19.5 11.5H7.5Z') + path('M13.5 11.5V23.5M13.5 5.5V4.5M10.5 23.5H16.5');

const flagMark = path('M8.5 4.5V23.5') + path('M8.5 5.5H20.5L17 10L20.5 14.5H8.5');

// --- Cursors --------------------------------------------------------------------------------------

const cross = path('M14.5 5.5V23.5M5.5 14.5H23.5');
const dot = circle([14, 14], 2.5, SOLID);
const arrowCursor = path('M9.5 5.5V20.5L13.2 17L15.8 22.6L18.2 21.5L15.6 16H20.5Z');
const eraser =
  path('M5.5 17.5L15.5 7.5L21.5 13.5L11.5 23.5Z') + path('M5.5 17.5L9.5 13.5L15.5 19.5L11.5 23.5Z', SOFT) + path('M11.5 23.5H22.5');

// --- Utilities ------------------------------------------------------------------------------------

const ruler =
  rect(4, 10.5, 20, 7, ' transform="rotate(-45 14 14)"') +
  path('M7 10.5V13M10 10.5V14M13 10.5V13M16 10.5V14M19 10.5V13', ' transform="rotate(-45 14 14)"');

const zoomIn = circle([12.5, 12.5], 6.5) + path('M17.2 17.2L22.5 22.5M12.5 9.5V15.5M9.5 12.5H15.5');

const magnetBody = path('M7.5 6.5V15A6.5 6.5 0 0 0 20.5 15V6.5H16.5V15A2.5 2.5 0 0 1 11.5 15V6.5Z') + path('M7.5 10.5H11.5M16.5 10.5H20.5');
const magnetWeak = magnetBody;
const magnetStrong = magnetBody + path('M7.5 6.5H11.5V10.5H7.5ZM16.5 6.5H20.5V10.5H16.5Z', SOLID);

const padlockBody = rect(7.5, 13.5, 13, 9, ' rx="1.5"') + circle([14, 17.5], 1.25) + path('M14 18.75V20');
const lock = path('M9.5 13.5V10A4.5 4.5 0 0 1 18.5 10V13.5') + padlockBody;
const unlock = path('M9.5 11V9A4.5 4.5 0 0 1 18.5 9V13.5') + padlockBody;

const stayInDrawingMode =
  path('M14 4.5L17 7.5L8.5 16L5.5 13Z') + path('M5.5 13L8.5 16L4.5 17Z') + path('M12.5 6L15.5 9') +
  path('M17.5 18.5V16.5A2 2 0 0 1 21.5 16.5V18.5') + rect(16.5, 18.5, 6, 5, ' rx="1"');

const eyeShape = path('M4.5 14C8 8.5 20 8.5 23.5 14C20 19.5 8 19.5 4.5 14Z') + circle([14, 14], 3);
const eyeOff = eyeShape + path('M6.5 21.5L21.5 6.5');

const trash =
  path('M6.5 8.5H21.5M11.5 8.5V6.5H16.5V8.5') + path('M8.5 8.5L9.5 22.5H18.5L19.5 8.5') + path('M12.5 11.5V19.5M15.5 11.5V19.5');

function star(): string {
  const center: Point = [14, 14.5];
  const points = Array.from({ length: 10 }, (_, index) => polar(center, index % 2 === 0 ? 9.5 : 4, 90 + index * 36));
  return `M${points.map(pt).join('L')}Z`;
}

function gear(): string {
  const center: Point = [14, 14];
  const outer = 9;
  const root = 6.75;
  let d = '';
  for (let tooth = 0; tooth < 8; tooth += 1) {
    const angle = tooth * 45 + 22.5;
    const a = polar(center, root, angle - 15);
    const b = polar(center, outer, angle - 9);
    const c = polar(center, outer, angle + 9);
    const e = polar(center, root, angle + 15);
    const next = polar(center, root, angle + 30);
    d += `${tooth === 0 ? 'M' : 'L'}${pt(a)}L${pt(b)}A${outer} ${outer} 0 0 0 ${pt(c)}L${pt(e)}A${root} ${root} 0 0 0 ${pt(next)}`;
  }
  return path(`${d}Z`) + circle(center, 2.75);
}

const clone =
  path('M10.5 10.5V8A1.5 1.5 0 0 1 12 6.5H20A1.5 1.5 0 0 1 21.5 8V16A1.5 1.5 0 0 1 20 17.5H17.5') +
  rect(6.5, 10.5, 11, 11, ' rx="1.5"');

const textColor = path('M8.5 18L14 5.5L19.5 18M10.7 13.5H17.3') + rect(6.5, 20.5, 15, 2, SOLID);

const lineWidth =
  path('M6 6.5H22') + path('M6 11H22', ' stroke-width="2"') + path('M6 16.5H22', ' stroke-width="3"') + path('M6 22H22', ' stroke-width="4"');

const undo = path('M9.5 11.5H17A5 5 0 0 1 17 21.5H11.5') + path('M12.5 8.5L9.5 11.5L12.5 14.5');
const redo = path('M18.5 11.5H11A5 5 0 0 0 11 21.5H16.5') + path('M15.5 8.5L18.5 11.5L15.5 14.5');

const objectTree =
  rect(5.5, 5.5, 4, 4) + rect(12.5, 12.5, 4, 4) + rect(12.5, 19.5, 4, 4) +
  path('M7.5 9.5V21.5H12.5M7.5 14.5H12.5') + path('M12.5 7.5H22.5M18.5 14.5H22.5M18.5 21.5H22.5', FAINT);

function replay(): string {
  const center: Point = [14, 14];
  const end = polar(center, 8.5, -165);
  return arc(center, 8.5, 135, -165) + arrowhead(end, polar(center, 8.5, -150), 3.5, 40) + path('M12.5 10.5V17.5L18 14Z');
}

const play = path('M10.5 7.5V20.5L20.5 14Z');
const pause = rect(9.5, 7.5, 3, 13) + rect(15.5, 7.5, 3, 13);
const stepForward = path('M7.5 7.5V20.5L16.5 14Z') + path('M19.5 7.5V20.5');
const stop = rect(8.5, 8.5, 11, 11, ' rx="1"');

const alert =
  circle([14, 15], 7.5) + path('M14 11V15L16.5 17') + path('M6 9L9 6M22 9L19 6') + path('M9 21L7.5 23M19 21L20.5 23');

const chartSettings =
  path('M5.5 9.5H8M13 9.5H22.5M5.5 18.5H15M20 18.5H22.5') + circle([10.5, 9.5], 2.5) + circle([17.5, 18.5], 2.5);

const copy =
  path('M7.5 19.5V7A1.5 1.5 0 0 1 9 5.5H17.5') + rect(10.5, 8.5, 11, 14, ' rx="1.5"') + path('M13.5 12.5H18.5M13.5 15.5H18.5M13.5 18.5H16.5');

const paste =
  path('M11.5 6.5H9A1.5 1.5 0 0 0 7.5 8V21A1.5 1.5 0 0 0 9 22.5H19A1.5 1.5 0 0 0 20.5 21V8A1.5 1.5 0 0 0 19 6.5H16.5') +
  rect(11.5, 4.5, 5, 3.5, ' rx="1"') + path('M10.5 12.5H17.5M10.5 15.5H17.5M10.5 18.5H14.5');

const bringFront = path('M12.5 12.5H5.5V22.5H15.5V15.5') + rect(12.5, 5.5, 10, 10, SOFT);
const sendBack = rect(12.5, 5.5, 10, 10) + path('M5.5 12.5H12.5V15.5H15.5V22.5H5.5Z', SOFT);

const visibility =
  path('M5.5 11C8.5 6.5 19.5 6.5 22.5 11C19.5 15.5 8.5 15.5 5.5 11Z') + circle([14, 11], 2.5) +
  path('M5.5 21.5H22.5') + path('M8.5 19.5V23.5M14.5 19.5V23.5M20.5 19.5V23.5', FAINT);

const textEdit = textGlyph(5.5, 5.5, 11, 12) + path('M20 12.5L23 15.5L16 22.5H13V19.5Z') + path('M18.5 14L21.5 17');

// --- The set --------------------------------------------------------------------------------------

const drawingIcons: Record<string, string> = {
  // Lines
  'trend-line': trendLine,
  ray: link([7.5, 20.5], [23.5, 4.5], true, false) + anchor([7.5, 20.5]),
  'info-line':
    link([5.5, 21.5], [18.5, 8.5]) + anchor([5.5, 21.5]) + anchor([18.5, 8.5]) +
    rect(14.5, 15.5, 9, 7, ' rx="1"') + path('M16.5 18H21.5M16.5 20H19.5'),
  'extended-line':
    link([4.5, 23.5], [10.5, 17.5], false, true) + link([10.5, 17.5], [17.5, 10.5]) + link([17.5, 10.5], [23.5, 4.5], true, false) +
    anchor([10.5, 17.5]) + anchor([17.5, 10.5]),
  'trend-angle': trendAngle(),
  'horizontal-line': horizontal(14.5, 4.5, 23.5, [14]) + anchor([14, 14.5]),
  'horizontal-ray': horizontal(14.5, 7.5, 23.5, [7.5]) + anchor([7.5, 14.5]),
  'vertical-line': vertical(14.5, 4.5, 23.5, [14]) + anchor([14.5, 14]),
  'cross-line': horizontal(14.5, 4.5, 23.5, [14.5]) + vertical(14.5, 4.5, 23.5, [14.5]) + anchor([14.5, 14.5]),
  'parallel-channel':
    link([5.5, 21.5], [21.5, 13.5]) + link([5.5, 13.5], [21.5, 5.5], false, true) +
    link([5.5, 17.5], [21.5, 9.5], false, false, DASH) +
    anchor([5.5, 21.5]) + anchor([21.5, 13.5]) + anchor([21.5, 5.5]),
  'regression-trend':
    link([5.5, 18.5], [22.5, 9.5]) + anchor([5.5, 18.5]) + anchor([22.5, 9.5]) +
    path('M5.5 13.5L22.5 4.5M5.5 23.5L22.5 14.5', DASH),
  'flat-top-bottom':
    horizontal(6.5, 5.5, 22.5, [5.5]) + link([5.5, 21.5], [22.5, 13.5]) +
    anchor([5.5, 6.5]) + anchor([5.5, 21.5]) + anchor([22.5, 13.5]),
  'disjoint-channel':
    link([5.5, 10.5], [22.5, 5.5]) + link([5.5, 16.5], [22.5, 22.5], true, false) +
    anchor([5.5, 10.5]) + anchor([22.5, 5.5]) + anchor([5.5, 16.5]),
  pitchfork: pitchfork([4.5, 17.5], [13.5, 8.5], [15.5, 20.5]),
  'schiff-pitchfork': pitchfork([4.5, 22.5], [13.5, 8.5], [15.5, 20.5], [4.5, 15.5]),
  'modified-schiff-pitchfork': pitchfork([4.5, 22.5], [13.5, 8.5], [15.5, 20.5], [9, 15.5]),
  'inside-pitchfork': pitchfork([4.5, 22.5], [13.5, 8.5], [15.5, 20.5], [9, 15.5], true),
  pitchfan: pitchfan(),

  // Fibonacci and Gann
  'fib-retracement': fibRetracement(),
  'fib-extension': fibExtension(),
  'fib-channel': fibChannel(),
  'fib-time-zone': fibTimeZone(),
  'fib-speed-fan': fibSpeedFan(),
  'fib-circles': fibCircles(),
  'fib-arcs': fibArcs(),
  'fib-wedge': fibWedge(),
  'fib-spiral': fibSpiral(),
  'gann-box': gannBox,
  'gann-square': gannSquare,
  'gann-square-fixed': gannSquareFixed,
  'gann-fan': gannFan(),

  // Patterns
  'xabcd-pattern': xabcd(),
  'cypher-pattern': cypher(),
  'head-shoulders': headShoulders(),
  'abcd-pattern': abcd(),
  'triangle-pattern': trianglePattern(),
  'three-drives': threeDrives(),
  'elliott-impulse': elliottImpulse(),
  'elliott-correction': elliottCorrection(),
  'elliott-triangle': elliottTriangle(),
  'elliott-double-combo': elliottDoubleCombo(),
  'elliott-triple-combo': elliottTripleCombo(),
  'cyclic-lines': cyclicLines(),
  'time-cycles': timeCycles(),
  'sine-line': sineLine(),

  // Forecasting and measurement
  'long-position': position(true),
  'short-position': position(false),
  projection: projection(),
  forecast: forecast(),
  'bars-pattern': barsPattern(),
  'ghost-feed': ghostFeed(),
  'anchored-vwap': anchoredVwap(),
  'fixed-range-volume-profile': volumeProfile(),
  'price-range': priceRange,
  'date-range': dateRange,
  'date-price-range': datePriceRange,

  // Shapes
  brush,
  highlighter,
  'arrow-marker': arrowMarker,
  arrow: arrowLine,
  'arrow-mark-up': arrowMarkUp,
  'arrow-mark-down': arrowMarkDown,
  rectangle,
  'rotated-rectangle': rotatedRectangle(),
  path: pathTool,
  circle: circleTool,
  ellipse: ellipseTool,
  polyline: polylineTool,
  triangle: triangleTool,
  arc: arcTool(),
  curve: curveTool,
  'double-curve': doubleCurve,

  // Annotation
  text,
  'anchored-text': anchoredText,
  note,
  'price-note': priceNote,
  pin,
  callout,
  comment,
  'price-label': priceLabel,
  signpost,
  'flag-mark': flagMark,
};

const trashIcon = trash;
const lockIcon = lock;

export const icons: Readonly<Record<string, string>> = Object.freeze({
  ...drawingIcons,

  // Cursors
  cross,
  dot,
  'arrow-cursor': arrowCursor,
  eraser,

  // Toolbar groups
  'group-lines': drawingIcons['trend-line'],
  'group-fibonacci': drawingIcons['fib-retracement'],
  'group-patterns': drawingIcons['xabcd-pattern'],
  'group-forecasting': drawingIcons['long-position'],
  'group-shapes': drawingIcons.brush,
  'group-annotation': drawingIcons.text,

  // Utilities
  measure: ruler,
  'zoom-in': zoomIn,
  'magnet-weak': magnetWeak,
  'magnet-strong': magnetStrong,
  'stay-in-drawing-mode': stayInDrawingMode,
  'lock-all': lockIcon,
  'hide-all': eyeOff,
  'remove-all': trashIcon,
  favorite: path(star()),
  'favorite-filled': path(star(), SOLID),
  'chevron-right': path('M11.5 7.5L17.5 14L11.5 20.5'),
  'chevron-left': path('M16.5 7.5L10.5 14L16.5 20.5'),
  'chevron-down': path('M9.5 12L14 16.5L18.5 12'),
  'line-color': path('M7 21L8 16.5L18.5 6a2 2 0 0 1 3 3L11 19.5Z') + path('M16.5 8L19.5 11'),
  'fill-color': path('M7.5 13.5L13.5 7.5L20 14L14 20.5Z') + path('M10.5 10.5L7 7') + path('M7.5 13.5H20', FAINT) + path('M22.5 18.5a1.5 1.5 0 0 1-3 0c0-1.2 1.5-3 1.5-3s1.5 1.8 1.5 3Z'),
  'text-letter': path('M8.5 21L14 6.5L19.5 21M10.8 15.5H17.2'),
  template: rect(6.5, 6.5, 15, 15, ' rx="2"') + path('M6.5 11.5H21.5M11.5 11.5V21.5'),
  'drag-handle': [9, 14, 19].map((y) => circle([11, y], 1.25, SOLID) + circle([17, y], 1.25, SOLID)).join(''),
  eye: eyeShape,
  'eye-off': eyeOff,
  settings: gear(),
  close: path('M8 8L20 20M20 8L8 20'),
  more: circle([8, 14], 1.25, SOLID) + circle([14, 14], 1.25, SOLID) + circle([20, 14], 1.25, SOLID),
  lock: lockIcon,
  unlock,
  trash: trashIcon,
  clone,
  'text-color': textColor,
  'line-width': lineWidth,
  undo,
  redo,
  'object-tree': objectTree,
  replay: replay(),
  play,
  pause,
  'step-forward': stepForward,
  stop,
  alert,
  'chart-settings': chartSettings,
  copy,
  paste,
  'bring-front': bringFront,
  'send-back': sendBack,
  visibility,
  'text-edit': textEdit,
});

const SVG_ATTRS =
  'viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

// A complete <svg> element for `name`; an unknown name gives an empty svg of the same size.
export function iconSvg(name: string, size = 28): string {
  const body = Object.prototype.hasOwnProperty.call(icons, name) ? icons[name] : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ${SVG_ATTRS}>${body}</svg>`;
}
