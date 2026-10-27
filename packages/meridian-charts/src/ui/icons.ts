// The toolbar icon set: thin 1px outline drawings on a 28×28 grid, in the manner of a trading
// terminal's drawing toolbar. Each entry is the inner markup of an <svg viewBox="0 0 28 28">; the
// caller renders it with stroke="currentColor", fill="none", stroke-width 1 and round caps/joins
// (see `iconSvg`). Straight horizontal and vertical strokes sit on half pixels so they stay crisp.
//
// Drawing tools share TradingView's vocabulary: lines run edge to edge between anchor points, and
// anchors are hollow rings that the lines meet at the outer edge rather than run through.

type Point = readonly [number, number];

// TradingView's anchor: a 1px ring of radius 2 (1.5 to 2.5), which lines meet at its outer edge.
const ANCHOR_RADIUS = 2;
const ANCHOR_GAP = 2.5;
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
  const start = anchorA ? toward(a, b, ANCHOR_GAP) : a;
  const end = anchorB ? toward(b, a, ANCHOR_GAP) : b;
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
    const start = anchored.has(index) ? toward(a, b, ANCHOR_GAP) : a;
    const end = anchored.has(nextIndex) ? toward(b, a, ANCHOR_GAP) : b;
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
      if (distance(origin, p) < ANCHOR_GAP) lo = mid;
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

// Lines run edge to edge of the 3 to 25 drawing area; anchors sit inside it on half pixels.
const EDGE_MIN = 3;
const EDGE_MAX = 25;

function horizontal(y: number, from: number, to: number, gapsAt: readonly number[] = []): string {
  let d = '';
  let x = from;
  for (const gap of [...gapsAt].sort((a, b) => a - b)) {
    if (gap - ANCHOR_GAP > x) d += `M${num(x)} ${num(y)}H${num(gap - ANCHOR_GAP)}`;
    x = gap + ANCHOR_GAP;
  }
  if (to > x) d += `M${num(x)} ${num(y)}H${num(to)}`;
  return path(d);
}

function vertical(x: number, from: number, to: number, gapsAt: readonly number[] = []): string {
  let d = '';
  let y = from;
  for (const gap of [...gapsAt].sort((a, b) => a - b)) {
    if (gap - ANCHOR_GAP > y) d += `M${num(x)} ${num(y)}V${num(gap - ANCHOR_GAP)}`;
    y = gap + ANCHOR_GAP;
  }
  if (to > y) d += `M${num(x)} ${num(y)}V${num(to)}`;
  return path(d);
}

// Small stroked capitals for the labels some tools carry (Elliott waves, position sides), 4px wide
// and 4px tall from the half-pixel row `y`, so their bars stay crisp.
function glyph(letter: string, x: number, y: number): string {
  const r = (dx: number) => num(x + dx);
  const c = (dy: number) => num(y + dy);
  switch (letter) {
    case '1': return path(`M${r(0.8)} ${c(1)}L${r(2)} ${c(0)}V${c(4.5)}`);
    case '5': return path(`M${r(3.5)} ${c(0)}H${r(0.5)}V${c(2)}H${r(2.2)}Q${r(3.6)} ${c(2)} ${r(3.6)} ${c(3.25)}Q${r(3.6)} ${c(4.5)} ${r(2.2)} ${c(4.5)}H${r(0.4)}`);
    case 'A': return path(`M${r(0)} ${c(4.5)}L${r(2)} ${c(0)}L${r(4)} ${c(4.5)}M${r(0.9)} ${c(3)}H${r(3.1)}`);
    case 'C': return path(`M${r(3.6)} ${c(0.8)}A1.9 2.25 0 1 0 ${r(3.6)} ${c(3.7)}`);
    case 'E': return path(`M${r(3.5)} ${c(0)}H${r(0.5)}V${c(4)}H${r(3.5)}M${r(0.5)} ${c(2)}H${r(3)}`);
    case 'W': return path(`M${r(0)} ${c(0)}L${r(1.2)} ${c(4.5)}L${r(2.25)} ${c(1.5)}L${r(3.3)} ${c(4.5)}L${r(4.5)} ${c(0)}`);
    case 'Y': return path(`M${r(0)} ${c(0)}L${r(2)} ${c(2.5)}L${r(4)} ${c(0)}M${r(2)} ${c(2.5)}V${c(4.5)}`);
    case 'Z': return path(`M${r(0.2)} ${c(0)}H${r(3.8)}L${r(0.2)} ${c(4)}H${r(3.8)}`);
    case 'L': return path(`M${r(0.5)} ${c(0)}V${c(4)}H${r(3.5)}`);
    case 'S': return path(`M${r(3.4)} ${c(0.6)}Q${r(2.9)} ${c(0)} ${r(2)} ${c(0)}Q${r(0.5)} ${c(0)} ${r(0.5)} ${c(1.15)}Q${r(0.5)} ${c(2.25)} ${r(2)} ${c(2.25)}Q${r(3.5)} ${c(2.25)} ${r(3.5)} ${c(3.35)}Q${r(3.5)} ${c(4.5)} ${r(2)} ${c(4.5)}Q${r(1)} ${c(4.5)} ${r(0.5)} ${c(3.9)}`);
    default: return '';
  }
}

const trendLine = link([5.5, 22.5], [22.5, 5.5]) + anchor([5.5, 22.5]) + anchor([22.5, 5.5]);

function trendAngle(): string {
  const origin: Point = [5.5, 21.5];
  const end: Point = [21.5, 6.5];
  const degrees = (Math.atan2(origin[1] - end[1], end[0] - origin[0]) * 180) / Math.PI;
  return (
    link(origin, end) + anchor(origin) + anchor(end) +
    horizontal(21.5, origin[0] + ANCHOR_GAP, EDGE_MAX) +
    arc(origin, 9, 0, degrees)
  );
}

// A ray from `from` through `through`, stopped at the edge of the drawing area.
function rayEnd(from: Point, through: Point): Point {
  const dx = through[0] - from[0];
  const dy = through[1] - from[1];
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (EDGE_MAX - from[0]) / dx);
  if (dx < 0) t = Math.min(t, (EDGE_MIN - from[0]) / dx);
  if (dy > 0) t = Math.min(t, (EDGE_MAX - from[1]) / dy);
  if (dy < 0) t = Math.min(t, (EDGE_MIN - from[1]) / dy);
  return [from[0] + dx * t, from[1] + dy * t];
}

// A pitchfork: a handle from `origin` through the midpoint of P1-P2, and tines parallel to it.
function pitchfork(p0: Point, p1: Point, p2: Point, origin: Point = p0, inner = false): string {
  const mid: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const along = (from: Point): Point => rayEnd(from, [from[0] + mid[0] - origin[0], from[1] + mid[1] - origin[1]]);
  const originIsAnchor = origin[0] === p0[0] && origin[1] === p0[1];
  let out = link(origin, along(mid), originIsAnchor, false) + link(p1, p2) + link(p1, along(p1), true, false) + link(p2, along(p2), true, false);
  if (!originIsAnchor) out += link(p0, origin, true, false, DASH);
  if (inner) {
    const q1: Point = [(p1[0] + mid[0]) / 2, (p1[1] + mid[1]) / 2];
    const q2: Point = [(p2[0] + mid[0]) / 2, (p2[1] + mid[1]) / 2];
    out += link(q1, along(q1), false, false, DASH) + link(q2, along(q2), false, false, DASH);
  }
  return out + anchor(p0) + anchor(p1) + anchor(p2);
}

// A pitchfan: rays from the pivot through both reaction points and the middle of the reaction leg.
function pitchfan(): string {
  const a: Point = [4.5, 17.5];
  const b: Point = [13.5, 7.5];
  const c: Point = [16.5, 21.5];
  const mid: Point = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  return (
    link(a, b) + link(b, rayEnd(a, b), true, false) +
    link(a, c) + link(c, rayEnd(a, c), true, false) +
    link(a, rayEnd(a, mid), true, false) + link(b, c) +
    anchor(a) + anchor(b) + anchor(c)
  );
}

// --- Fibonacci and Gann ---------------------------------------------------------------------------

// Four levels across the area, anchored where the swing starts (bottom left) and ends (top right).
function fibRetracement(): string {
  return (
    horizontal(5.5, EDGE_MIN, EDGE_MAX, [22.5]) + horizontal(11.5, EDGE_MIN, EDGE_MAX) +
    horizontal(16.5, EDGE_MIN, EDGE_MAX) + horizontal(22.5, EDGE_MIN, EDGE_MAX, [5.5]) +
    anchor([22.5, 5.5]) + anchor([5.5, 22.5])
  );
}

function fibExtension(): string {
  const a: Point = [4.5, 22.5];
  const b: Point = [9.5, 11.5];
  const c: Point = [13.5, 17.5];
  return (
    chain([a, b, c]) +
    horizontal(4.5, 13, EDGE_MAX) + horizontal(9.5, 13, EDGE_MAX) + horizontal(13.5, 16.5, EDGE_MAX) + horizontal(17.5, c[0] + ANCHOR_GAP, EDGE_MAX)
  );
}

function fibChannel(): string {
  const slope = 0.55;
  const at = (x: number, base: number): Point => [x, base - slope * (x - EDGE_MIN)];
  const a = at(6.5, 25);
  const b = at(17.5, 25);
  const c = at(6.5, 13);
  return (
    link(at(EDGE_MIN, 25), a, false, true) + link(a, b) + link(b, at(EDGE_MAX - 2, 25), true, false) +
    link(at(EDGE_MIN, 19), at(EDGE_MAX, 19), false, false) +
    link(at(EDGE_MIN, 13), c, false, true) + link(c, at(EDGE_MAX, 13), true, false) +
    anchor(a) + anchor(b) + anchor(c)
  );
}

function fibTimeZone(): string {
  // Zones at 0, 1, 2, 3, 5 and 8 units, with the first two lines anchored.
  const xs = [4.5, 7.5, 10.5, 13.5, 17.5, 24.5];
  return xs.map((x, index) => vertical(x, EDGE_MIN, EDGE_MAX, index === 0 ? [21.5] : index === 1 ? [6.5] : [])).join('') +
    anchor([xs[0], 21.5]) + anchor([xs[1], 6.5]);
}

function fibSpeedFan(): string {
  const origin: Point = [4.5, 23.5];
  const corner: Point = [23.5, 4.5];
  const size = 19;
  const fan = [0.382, 0.618].flatMap((f) => [
    link(origin, [EDGE_MAX, 23.5 - (EDGE_MAX - 4.5) * f], true, false),
    link(origin, [4.5 + (23.5 - EDGE_MIN) * f, EDGE_MIN], true, false),
  ]);
  return (
    fan.join('') + link(origin, corner) +
    horizontal(4.5, 4.5, 23.5, [23.5]) + vertical(23.5, 4.5, 23.5, [4.5]) +
    path(`M4.5 ${num(23.5 - size / 2)}H23.5M${num(4.5 + size / 2)} 4.5V23.5`, FAINT) +
    anchor(origin) + anchor(corner)
  );
}

function fibCircles(): string {
  const center: Point = [14, 14];
  return circle(center, 4) + circle(center, 7.5) + arc(center, 10.5, 0, 360, true, true) + anchor(center) + anchor([24.5, 14]);
}

// Half circles hanging from the trend's end anchor, with its start anchor on the outermost.
function fibArcs(): string {
  const base: Point = [14, 6.5];
  return (
    arc(base, 5, 180, 360) + arc(base, 8.5, 180, 360) + arc(base, 12, 180, 270, false, true) + arc(base, 12, 270, 360, true, false) +
    horizontal(6.5, EDGE_MIN + 0.5, EDGE_MAX - 0.5, [base[0]]) + anchor(base) + anchor([14, 18.5])
  );
}

// A quarter wedge from the apex at bottom left, its outer arc between the two other anchors.
function fibWedge(): string {
  const apex: Point = [4.5, 23.5];
  const radius = 19;
  const top: Point = [4.5, 23.5 - radius];
  const right: Point = [4.5 + radius, 23.5];
  return (
    link(apex, top) + link(apex, right) +
    arc(apex, 7, 0, 90) + arc(apex, 13, 0, 90) + arc(apex, radius, 0, 90, true, true) +
    anchor(apex) + anchor(top) + anchor(right)
  );
}

// A spiral unwinding from its centre anchor out to the second anchor (one and a half turns).
function fibSpiral(): string {
  const center: Point = [13.5, 14.5];
  const r0 = 2.8;
  const r1 = 10.5;
  const sweepAngle = Math.PI * 3;
  const growth = Math.log(r1 / r0) / sweepAngle;
  const at = (t: number): Point => {
    const angle = sweepAngle * t;
    const r = r0 * Math.exp(growth * angle);
    return [center[0] + r * Math.cos(angle + 0.6), center[1] - r * Math.sin(angle + 0.6)];
  };
  return curveStroke(at, false, true, '', 96) + anchor(at(1)) + anchor(center);
}

// Gann boxes: a 20px square on a quarter grid, anchored on two opposite corners.
const gannFrame = chain([[4.5, 24.5], [4.5, 4.5], [24.5, 4.5], [24.5, 24.5]], [0, 2], true);
const gannBox = gannFrame + path('M9.5 4.5V24.5M14.5 4.5V24.5M19.5 4.5V24.5M4.5 9.5H24.5M4.5 14.5H24.5M4.5 19.5H24.5', FAINT);
const gannSquare =
  gannFrame + path('M9.5 4.5V24.5M14.5 4.5V24.5M19.5 4.5V24.5M4.5 9.5H24.5M4.5 14.5H24.5M4.5 19.5H24.5', FAINT) +
  link([4.5, 24.5], [24.5, 4.5]) + path('M4.5 4.5L24.5 24.5');

// A fixed square: quarter grid, an arc from the pivot and fan lines, sized from one anchor.
const gannSquareFixed =
  chain([[4.5, 24.5], [4.5, 4.5], [24.5, 4.5], [24.5, 24.5]], [0], true) +
  path('M14.5 4.5V24.5M4.5 14.5H24.5', FAINT) +
  arc([4.5, 24.5], 10, 0, 90, false, false, FAINT) +
  link([4.5, 24.5], [24.5, 14.5], true, false) + link([4.5, 24.5], [14.5, 4.5], true, false) + link([4.5, 24.5], [24.5, 4.5], true, false);

function gannFan(): string {
  const origin: Point = [4.5, 23.5];
  const size = 20;
  const ends = [0.25, 0.5, 2, 4].map((slope): Point => (slope <= 1 ? [origin[0] + size, origin[1] - size * slope] : [origin[0] + size / slope, origin[1] - size]));
  const corner: Point = [16.5, 11.5];
  return ends.map((end) => link(origin, end, true, false)).join('') + link(origin, corner) + link(corner, [EDGE_MAX - 0.5, 3.5], true, false) + anchor(origin) + anchor(corner);
}

// --- Patterns -------------------------------------------------------------------------------------

// Harmonic patterns are drawn as their two triangles: every leg solid, every point anchored.
const xabcd = (): string => {
  const pts: Point[] = [[3.5, 21.5], [9.5, 6.5], [13.5, 15.5], [18.5, 9.5], [24.5, 22.5]];
  return chain(pts) + link(pts[0], pts[2]) + link(pts[2], pts[4]);
};

const cypher = (): string => {
  const pts: Point[] = [[3.5, 22.5], [8.5, 11.5], [12.5, 16.5], [18.5, 5.5], [24.5, 18.5]];
  return chain(pts) + link(pts[0], pts[2]) + link(pts[2], pts[4]);
};

const headShoulders = (): string => {
  const pts: Point[] = [[3.5, 22.5], [7.5, 12.5], [10.5, 18.5], [14, 5.5], [17.5, 18.5], [20.5, 12.5], [24.5, 22.5]];
  return chain(pts) + link(pts[2], pts[4]);
};

const abcd = (): string => {
  const pts: Point[] = [[4.5, 22.5], [10.5, 7.5], [16.5, 16.5], [23.5, 5.5]];
  return chain(pts) + link(pts[0], pts[2], true, true, DASH) + link(pts[1], pts[3], true, true, DASH);
};

function trianglePattern(): string {
  // The swings touch two converging boundaries that meet at the apex on the right.
  const onUpper = (x: number): Point => [x, 4.5 + ((14 - 4.5) * (x - 3.5)) / 23];
  const onLower = (x: number): Point => [x, 23.5 - ((23.5 - 14) * (x - 3.5)) / 23];
  const pts = [onUpper(3.5), onLower(9.5), onUpper(15.5), onLower(21.5)];
  return chain(pts) + chain([pts[0], pts[2], onUpper(EDGE_MAX)], [0, 1], false, '', false) + chain([onLower(EDGE_MIN), pts[1], pts[3]], [1, 2], false, '', false);
}

const threeDrives = (): string => {
  const pts: Point[] = [[3.5, 23.5], [7, 15.5], [10.5, 19.5], [14, 11.5], [17.5, 15.5], [21, 7.5], [24.5, 11.5]];
  return chain(pts) + link(pts[1], pts[3], true, true, DASH) + link(pts[3], pts[5], true, true, DASH);
};

// Elliott waves: the wave in the lower part, its first and last labels above.
const wave = (points: readonly Point[], first: string, last: string): string =>
  chain(points) + glyph(first, points[1][0] - 2, 4.5) + glyph(last, points[points.length - 1][0] - 2, 4.5);
const elliottImpulse = (): string => wave([[3.5, 23.5], [7.5, 16.5], [11.5, 20.5], [16.5, 12.5], [20.5, 17.5], [24.5, 12.5]], '1', '5');
const elliottCorrection = (): string => wave([[4.5, 13.5], [10.5, 21.5], [16.5, 14.5], [23.5, 23.5]], 'A', 'C');
const elliottTriangle = (): string => wave([[3.5, 13.5], [7.5, 23.5], [11.5, 14.5], [15.5, 21.5], [19.5, 15.5], [24.5, 19.5]], 'A', 'E');
const elliottDoubleCombo = (): string => wave([[3.5, 12.5], [12.5, 22.5], [17, 17.5], [24.5, 23.5]], 'W', 'Y');
const elliottTripleCombo = (): string => wave([[3.5, 12.5], [10.5, 21.5], [14.5, 16.5], [19.5, 22.5], [24.5, 18.5]], 'W', 'Z');

function cyclicLines(): string {
  return [4.5, 11.5, 18.5, 24.5].map((x, index) => vertical(x, EDGE_MIN, EDGE_MAX, index < 2 ? [14.5] : [])).join('') +
    path(`M${num(4.5 + ANCHOR_GAP)} 14.5H${num(11.5 - ANCHOR_GAP)}`, DASH) + anchor([4.5, 14.5]) + anchor([11.5, 14.5]);
}

function timeCycles(): string {
  const base = 20.5;
  const xs = [3.5, 14, 24.5];
  const rx = (xs[1] - xs[0]) / 2;
  const hump = (from: number) => (t: number): Point => [from + rx - rx * Math.cos(Math.PI * t), base - 12 * Math.sin(Math.PI * t)];
  // The second cycle starts on the first one's end anchor.
  return curve(hump(xs[0]), true, true) + curveStroke(hump(xs[1]), true, false) + horizontal(base, EDGE_MIN, EDGE_MAX, xs.slice(0, 2));
}

function sineLine(): string {
  const at = (x: number): Point => [x, 14 - 7 * Math.sin((2 * Math.PI * (x - 3)) / 11)];
  const span = (from: number, to: number, a: boolean, b: boolean): string => curve((t) => at(from + (to - from) * t), a, b);
  return span(3, 5.75, false, true) + span(5.75, 11.25, true, true) + span(11.25, 25, true, false);
}

// --- Forecasting ----------------------------------------------------------------------------------

// Target, entry and stop levels; the entry anchored at its start, the side's letter in the profit zone.
const position = (long: boolean): string => {
  const [target, stop] = long ? [5.5, 22.5] : [22.5, 5.5];
  const entry = 14.5;
  return (
    horizontal(target, 5.5, EDGE_MAX, [22.5]) + anchor([22.5, target]) +
    horizontal(entry, 5.5, EDGE_MAX, [5.5]) + anchor([5.5, entry]) +
    horizontal(stop, 5.5, EDGE_MAX) +
    glyph(long ? 'L' : 'S', 12, long ? 8 : 16)
  );
};

// A projection: a quarter circle around the corner anchor, between the two others.
function projection(): string {
  const corner: Point = [5.5, 22.5];
  const radius = 17;
  const top: Point = [5.5, 22.5 - radius];
  const right: Point = [5.5 + radius, 22.5];
  return link(corner, top) + link(corner, right) + arc(corner, radius, 0, 90, true, true) + anchor(corner) + anchor(top) + anchor(right);
}

// A candle centred on a half-pixel column: wick from `high` to `low`, body between `top` and `bottom`.
function candle(x: number, high: number, top: number, bottom: number, low: number, attrs = ''): string {
  return path(`M${num(x)} ${num(high)}V${num(top)}M${num(x)} ${num(bottom)}V${num(low)}`, attrs) + rect(x - 1.5, top, 3, bottom - top, attrs);
}

const barsPattern = candle(6.5, 9.5, 12.5, 19.5, 23.5) + candle(14.5, 4.5, 7.5, 15.5, 19.5) + candle(22.5, 8.5, 11.5, 17.5, 21.5);

// Bars between the two anchors, joined by the feed's path.
const ghostFeed =
  candle(9.5, 13.5, 15.5, 20.5, 23.5) + candle(14.5, 8.5, 10.5, 15.5, 18.5) + candle(19.5, 4.5, 6.5, 11.5, 14.5) +
  link([3.5, 21.5], [9.5, 15.5], true, false) + link([19.5, 6.5], [24.5, 9.5], false, true) + anchor([3.5, 21.5]) + anchor([24.5, 9.5]);

// A price history ending at the source anchor, and the forecast to the target.
function forecast(): string {
  const source: Point = [11.5, 16.5];
  const target: Point = [23.5, 6.5];
  return chain([[3.5, 22.5], [6.5, 17.5], [8.5, 20.5], source], [3]) + link(source, target, true, true, DASH) + anchor(target) + horizontal(6.5, 15, target[0] - ANCHOR_GAP, []);
}

const anchoredVwap = (): string =>
  candle(10.5, 15.5, 17.5, 21.5, 24.5) + candle(16.5, 9.5, 11.5, 16.5, 19.5) +
  curve(cubic([4.5, 21.5], [11, 13], [15, 17], [24.5, 6.5]), true) ;

const volumeProfile = (): string =>
  vertical(22.5, EDGE_MIN, EDGE_MAX, [5.5]) + anchor([22.5, 5.5]) +
  [[6, 6.5], [10, 10.5], [14, 14.5], [9, 18.5]].map(([width, y]) => horizontal(y, 3.5, 3.5 + width) + horizontal(y + 2, 3.5, 3.5 + width) + vertical(3.5 + width, y, y + 2)).join('') +
  vertical(3.5, 6.5, 20.5, []) + anchor([5.5, 23.5]);

// Two levels anchored at opposite ends and the move between them.
const priceRange = horizontal(4.5, EDGE_MIN, EDGE_MAX, [22.5]) + horizontal(23.5, EDGE_MIN, EDGE_MAX, [5.5]) + anchor([22.5, 4.5]) + anchor([5.5, 23.5]) +
  path('M14.5 20.5V7.5') + arrowhead([14.5, 7.5], [14.5, 20.5], 3.5, 45);
const dateRange = vertical(4.5, EDGE_MIN, EDGE_MAX, [22.5]) + vertical(23.5, EDGE_MIN, EDGE_MAX, [5.5]) + anchor([4.5, 22.5]) + anchor([23.5, 5.5]) +
  path('M7.5 14.5H20.5') + arrowhead([20.5, 14.5], [7.5, 14.5], 3.5, 45);
const datePriceRange =
  chain([[4.5, 23.5], [4.5, 4.5], [23.5, 4.5], [23.5, 23.5]], [0, 2], true) +
  path('M14.5 20.5V8.5M8.5 14.5H20.5') + arrowhead([14.5, 8.5], [14.5, 20.5], 3, 45) + arrowhead([20.5, 14.5], [8.5, 14.5], 3, 45);

// --- Shapes ---------------------------------------------------------------------------------------

// A paintbrush leaning to the right, its paint stroke sweeping out under it.
const brush =
  path('M21.5 3.5L24.5 6.5L15.5 15.5L12.5 12.5Z') +
  path('M12.5 12.5L15.5 15.5C15 20 11 23.5 4.5 23.5C7.5 21.5 7.5 18 8.5 15.5C9.5 13.5 11 12.5 12.5 12.5Z');

const highlighter =
  path('M20.5 3.5L24.5 7.5L14.5 17.5L10.5 13.5Z') +
  path('M10.5 13.5L14.5 17.5L12 20H8V16Z') +
  rect(3.5, 22.5, 21, 2, SOFT);

const blockArrowUp: Point[] = [[14, 3.5], [22.5, 12.5], [17.5, 12.5], [17.5, 24.5], [10.5, 24.5], [10.5, 12.5], [5.5, 12.5]];
const blockArrow = (points: readonly Point[], attrs = ''): string => path(`M${points.map(pt).join('L')}Z`, attrs);

// A long thin arrow pointing up and right, as markers point at a bar.
function arrowMarker(): string {
  const tip: Point = [24, 4];
  const tail: Point = [4.5, 23.5];
  const length = distance(tail, tip);
  const along = (t: number, side: number): Point => {
    const ux = (tip[0] - tail[0]) / length;
    const uy = (tip[1] - tail[1]) / length;
    return [tail[0] + ux * t - uy * side, tail[1] + uy * t + ux * side];
  };
  const neck = length - 7;
  return path(`M${pt(along(0, -1))}L${pt(along(neck, -1))}L${pt(along(neck, -3.5))}L${pt(tip)}L${pt(along(neck, 3.5))}L${pt(along(neck, 1))}L${pt(along(0, 1))}Z`);
}

const arrowLine = link([5.5, 22.5], [20, 8], true, false) + path('M24 4L22.2 11.6L16.4 5.8Z', SOLID) + anchor([5.5, 22.5]);
const arrowMarkUp = blockArrow(blockArrowUp);
const arrowMarkDown = blockArrow(blockArrowUp.map(([x, y]): Point => [x, 28 - y]));

const rectangle = chain([[5.5, 5.5], [22.5, 5.5], [22.5, 22.5], [5.5, 22.5]], 'all', true);

function rotatedRectangle(): string {
  const center: Point = [14, 14];
  const angle = 35;
  const u = polar([0, 0], 1, angle);
  const v = polar([0, 0], 1, angle + 90);
  const corner = (a: number, b: number): Point => [center[0] + u[0] * a + v[0] * b, center[1] + u[1] * a + v[1] * b];
  return chain([corner(-10.5, -5), corner(10.5, -5), corner(10.5, 5), corner(-10.5, 5)], 'all', true);
}

const pathTool = chain([[4.5, 21.5], [10.5, 12.5], [16.5, 18.5], [24, 6]], [0, 1, 2]) + arrowhead([24, 6], [16.5, 18.5], 5, 35);

const circleTool = arc([14, 14], 10.5, 0, 360, true, true) + anchor([14, 14]) + anchor([24.5, 14]);

const ellipseTool =
  curve((t) => [14 - 10.5 * Math.cos((Math.PI / 2) * t), 14 - 7 * Math.sin((Math.PI / 2) * t)], true, true) +
  curve((t) => [14 + 10.5 * Math.sin((Math.PI / 2) * t), 7 + 7 * (1 - Math.cos((Math.PI / 2) * t))], true, true) +
  curve((t) => [14 + 10.5 * Math.cos((Math.PI / 2) * t), 14 + 7 * Math.sin((Math.PI / 2) * t)], true, true) +
  curve((t) => [14 - 10.5 * Math.sin((Math.PI / 2) * t), 21 - 7 * (1 - Math.cos((Math.PI / 2) * t))], true, true);

const polylineTool = chain([[4.5, 14.5], [10.5, 4.5], [23.5, 8.5], [19.5, 23.5], [8.5, 21.5], [12.5, 14.5]], 'all', true);
const triangleTool = chain([[5.5, 22.5], [6.5, 5.5], [22.5, 22.5]], 'all', true);

function arcTool(): string {
  // A circle through the two ends and the apex.
  const halfChord = 10;
  const sagitta = 12;
  const radius = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);
  const center: Point = [14, 7.5 + radius];
  const sweep = (Math.asin(halfChord / radius) * 180) / Math.PI;
  const right = (t: number): Point => polar(center, radius, 90 - sweep * t);
  return arc(center, radius, 90 + sweep, 90, true, true) + curveStroke(right, true, true) + anchor(right(1));
}

const curveTool = curve(quadratic([4.5, 22.5], [9.5, 2.5], [23.5, 17.5]), true, true);

// A cubic curve with its two inner points anchored too, as it is placed.
function doubleCurve(): string {
  const at = cubic([4.5, 20.5], [9.5, -2], [18.5, 30], [23.5, 7.5]);
  const part = (from: number, to: number) => (t: number): Point => at(from + (to - from) * t);
  return curve(part(0, 1 / 3), true, true) + curveStroke(part(1 / 3, 2 / 3), true, false) + curve(part(2 / 3, 1), true, true) + anchor(at(1 / 3));
}

// --- Annotation -----------------------------------------------------------------------------------

const textGlyph = (left: number, top: number, width: number, height: number): string => {
  const middle = left + width / 2;
  const serif = Math.min(2.5, width / 4);
  return path(
    `M${num(left)} ${num(top + 2)}V${num(top)}H${num(left + width)}V${num(top + 2)}` +
    `M${num(middle)} ${num(top)}V${num(top + height)}M${num(middle - serif)} ${num(top + height)}H${num(middle + serif)}`,
  );
};

const text = textGlyph(6.5, 4.5, 15, 19);
const anchoredText = path(`M7.5 6.5V4.5H21.5V6.5M14.5 4.5V${num(21.5 - ANCHOR_GAP)}`) + anchor([14.5, 21.5]);

// A text box on a stem down to its anchor.
const note = rect(6.5, 4.5, 15, 12) + textGlyph(10.5, 7.5, 8, 6) + vertical(14, 16.5, 21.5 - ANCHOR_GAP) + anchor([14, 21.5]);

const priceNote =
  rect(6.5, 4.5, 15, 12) + glyph('S', 12, 8) + path('M14 7V8M14 12.5V14') + vertical(14, 16.5, 21.5 - ANCHOR_GAP) + anchor([14, 21.5]);

const pin = path('M14 24.5L8.1 14.1A6.8 6.8 0 1 1 19.9 14.1Z') + circle([14, 10.5], 2.5);

const callout = path('M7.5 4.5H23.5V17.5H11.5L5.5 23.5V17.5H7.5Z');

const comment = path('M10.5 5.5H18.5A6 6 0 0 1 18.5 17.5H10.5L5.5 22.5V11.5A6 6 0 0 1 10.5 5.5Z');

const priceLabel = path(`M8.5 5.5H23.5V17.5H12.5L${num(5.5 + 1.8)} ${num(22.5 - 1.8)}`) + path('M8.5 5.5V15') + anchor([5.5, 22.5]);

function signpost(): string {
  const center: Point = [14, 9.5];
  const points = Array.from({ length: 10 }, (_, index) => polar(center, index % 2 === 0 ? 3.8 : 1.7, 90 + index * 36));
  return circle(center, 6.5) + path(`M${points.map(pt).join('L')}Z`) + vertical(14, 16, 25);
}

const flagMark = path('M7.5 3.5V24.5') + path('M7.5 5.5H22.5L18.5 10.5L22.5 15.5H7.5');

// --- Cursors --------------------------------------------------------------------------------------

// Four arms round an open centre, as TradingView's cross cursor.
const cross = path('M14.5 4.5V11.5M14.5 17.5V24.5M4.5 14.5H11.5M17.5 14.5H24.5');
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

// A stack of layers, as TradingView shows its object tree.
const objectTree = path('M14 4.5L23.5 10L14 15.5L4.5 10Z') + path('M4.5 14L14 19.5L23.5 14') + path('M4.5 18L14 23.5L23.5 18');

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
  ray: link([5.5, 22.5], [13.5, 14.5]) + link([13.5, 14.5], [24.5, 3.5], true, false) + anchor([5.5, 22.5]) + anchor([13.5, 14.5]),
  'info-line': link([4.5, 21.5], [16.5, 9.5]) + anchor([4.5, 21.5]) + anchor([16.5, 9.5]) + rect(17.5, 16.5, 7, 6, ' rx="1.5"'),
  'extended-line':
    link([EDGE_MIN, EDGE_MAX], [10.5, 17.5], false, true) + link([10.5, 17.5], [17.5, 10.5]) + link([17.5, 10.5], [EDGE_MAX, EDGE_MIN], true, false) +
    anchor([10.5, 17.5]) + anchor([17.5, 10.5]),
  'trend-angle': trendAngle(),
  'horizontal-line': horizontal(14.5, EDGE_MIN, EDGE_MAX, [14.5]) + anchor([14.5, 14.5]),
  'horizontal-ray': horizontal(14.5, 5.5, EDGE_MAX, [5.5]) + anchor([5.5, 14.5]),
  'vertical-line': vertical(14.5, EDGE_MIN, EDGE_MAX, [14.5]) + anchor([14.5, 14.5]),
  'cross-line': horizontal(14.5, EDGE_MIN, EDGE_MAX, [14.5]) + vertical(14.5, EDGE_MIN, EDGE_MAX, [14.5]) + anchor([14.5, 14.5]),
  'parallel-channel':
    link([4.5, 15.5], [23.5, 5.5]) + link([4.5, 23.5], [23.5, 13.5], true, false) +
    anchor([4.5, 15.5]) + anchor([23.5, 5.5]) + anchor([4.5, 23.5]),
  'regression-trend':
    link([4.5, 17.5], [23.5, 10.5]) + anchor([4.5, 17.5]) + anchor([23.5, 10.5]) +
    path('M4.5 11.5L23.5 4.5M4.5 23.5L23.5 16.5') + vertical(4.5, 11.5, 23.5, [17.5]) + vertical(23.5, 4.5, 16.5, [10.5]),
  'flat-top-bottom':
    link([4.5, 15.5], [23.5, 5.5]) + horizontal(22.5, 4.5, 23.5, [4.5, 23.5]) +
    anchor([4.5, 15.5]) + anchor([23.5, 5.5]) + anchor([4.5, 22.5]) + anchor([23.5, 22.5]),
  'disjoint-channel':
    link([4.5, 11.5], [23.5, 4.5]) + link([4.5, 16.5], [23.5, 23.5]) +
    anchor([4.5, 11.5]) + anchor([23.5, 4.5]) + anchor([4.5, 16.5]) + anchor([23.5, 23.5]),
  pitchfork: pitchfork([4.5, 23.5], [5.5, 13.5], [15.5, 23.5]),
  'schiff-pitchfork': pitchfork([4.5, 23.5], [5.5, 13.5], [15.5, 23.5], [5, 18.5]),
  'modified-schiff-pitchfork': pitchfork([4.5, 23.5], [5.5, 13.5], [15.5, 23.5], [7.5, 21]),
  'inside-pitchfork': pitchfork([4.5, 23.5], [5.5, 13.5], [15.5, 23.5], [7.5, 21], true),
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
  'bars-pattern': barsPattern,
  'ghost-feed': ghostFeed,
  'anchored-vwap': anchoredVwap(),
  'fixed-range-volume-profile': volumeProfile(),
  'price-range': priceRange,
  'date-range': dateRange,
  'date-price-range': datePriceRange,

  // Shapes
  brush,
  highlighter,
  'arrow-marker': arrowMarker(),
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
  'double-curve': doubleCurve(),

  // Annotation
  text,
  'anchored-text': anchoredText,
  note,
  'price-note': priceNote,
  pin,
  callout,
  comment,
  'price-label': priceLabel,
  signpost: signpost(),
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
