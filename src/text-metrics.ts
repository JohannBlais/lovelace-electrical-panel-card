// Synchronous text measurement, used by the layout pass to size the boxes that
// hold a group or breaker id.
//
// Why not `getBBox()`, which the bubble backgrounds already use: getBBox only
// answers once the element is in the document and laid out, and
// `_computeLayout()` runs before render. A box's width feeds the x of
// everything to its right — the bus, the nesting indent, the zone content — so
// measuring after render would mean laying out twice per frame and showing the
// wrong geometry in between. The bubbles get away with getBBox because their
// background is positioned around already-placed text and influences nothing.
//
// Why not a baked Roboto metrics table: the card renders with
// `font-family: var(--ha-font-family-body, …)`, so the face is whatever the
// active Home Assistant theme resolves — Roboto by default, but not reliably.
// A frozen table would mis-measure precisely the custom-theme users most likely
// to notice and report it.
//
// A 2d canvas context measures whatever font the string names, is synchronous,
// and adds nothing to the bundle.

// `undefined` until first use, `null` once we know the context is unavailable
// (canvas-less environment), so we stop retrying it on every measurement.
let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d') ?? null;
  }
  return ctx;
}

// Keyed by font + text. Bounded in practice by the number of distinct ids in a
// panel, which is small and stable; cleared outright when the font changes
// under us (see resetTextMetrics).
const cache = new Map<string, number>();

/**
 * Advance width of `text` in CSS pixels, or `undefined` when it cannot be
 * measured — no canvas available, or a width that came back non-positive
 * because the webfont had not loaded yet.
 *
 * Callers must read `undefined` as "keep the fixed fallback size", never as
 * zero: a zero-width box is far worse than a slightly-too-small one, and it is
 * the state the card is in for the first frames after a cold load.
 */
export function measureText(
  text: string,
  fontSize: number,
  fontWeight: string | number,
  fontFamily: string,
): number | undefined {
  if (!text) return 0;
  const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  // NUL separator: a font shorthand cannot contain one, so no (font, text)
  // pair can collide with another across the boundary.
  const key = `${font}\0${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const c = context();
  if (!c) return undefined;
  c.font = font;
  let w: number;
  try {
    w = c.measureText(text).width;
  } catch {
    return undefined;
  }
  // Guards both a genuinely unavailable font and the NaN some engines hand
  // back for a font shorthand they failed to parse.
  if (!Number.isFinite(w) || w <= 0) return undefined;

  cache.set(key, w);
  return w;
}

/**
 * Drops every cached measurement. Called once the document's webfonts finish
 * loading: anything measured before that point was measured against the
 * fallback face and is now wrong — usually narrower than the real thing.
 */
export function resetTextMetrics(): void {
  cache.clear();
}
