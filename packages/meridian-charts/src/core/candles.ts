// Candle body and wick widths in device pixels, after TradingView's. Zoomed out, bodies fill the
// whole bar spacing, so neighbouring candles touch: at 3px per bar a 75% body left one column in
// three as background, which diluted every colour. Zoomed in, the body narrows towards 80% of the
// spacing. A narrower body is the wick's parity, so the wick sits exactly in its middle; a body
// that fills the spacing keeps every column, since a column given up there is a gap of background.
// Wicks thicken with the spacing (1, 3, then 5 CSS pixels) so wide candles keep their proportions.
export function candleWidths(spacing: number, ratio: number): { wick: number; body: number } {
  const thin = Math.max(1, Math.floor(ratio));
  const room = Math.floor(spacing * ratio);
  const width = spacing >= 2.5 && spacing <= 4
    ? Math.floor(3 * ratio)
    : Math.floor(spacing * (1 - 0.2 * Math.atan(Math.max(4, spacing) - 4) / (Math.PI / 2)) * ratio);
  const fitted = Math.max(thin, Math.min(width, room));
  const body = fitted < room && (fitted - thin) % 2 ? fitted - 1 : fitted;
  const wide = Math.floor((spacing <= 50 ? 1 : spacing <= 180 ? 3 : 5) * ratio);
  const wick = (wide - thin) % 2 ? wide - 1 : wide;
  return { wick: Math.max(thin, Math.min(wick, body)), body };
}
