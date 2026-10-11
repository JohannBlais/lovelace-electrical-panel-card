import {
  LitElement,
  html,
  svg,
  css,
  nothing,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  fireEvent,
  type HomeAssistant,
  type LovelaceCard,
  type LovelaceCardConfig,
} from 'custom-card-helpers';

import { CARD_NAME, CARD_TAG, CARD_VERSION, EDITOR_TAG } from './const.js';
import { measureText, resetTextMetrics } from './text-metrics.js';
// Side-effect import — registers the <electrical-panel-card-editor> element
// so HA's card picker can use it via getConfigElement() without a separate
// dynamic import / chunk split.
import './editor.js';
import {
  format as formatI18n,
  getDict,
  pickLanguage,
  type Translations,
} from './translations/index.js';
import type {
  Circuit,
  ElectricalPanelCardConfig,
  FloorStyle,
  Group,
  Phase,
  Sensor,
  Zone,
} from './types.js';

/* eslint-disable no-console */
console.info(
  `%c ELECTRICAL-PANEL-CARD %c v${CARD_VERSION} `,
  'color: white; background: #2c5282; font-weight: 700;',
  'color: #2c5282; background: white; font-weight: 700;',
);
/* eslint-enable no-console */

(window as unknown as { customCards?: unknown[] }).customCards =
  (window as unknown as { customCards?: unknown[] }).customCards ?? [];
((window as unknown as { customCards: unknown[] }).customCards as unknown[]).push({
  type: CARD_TAG,
  name: CARD_NAME,
  description:
    'Interactive one-line electrical panel diagram with live power readings and smart-plug toggles.',
  preview: false,
  documentationURL: 'https://github.com/JohannBlais/lovelace-electrical-panel-card',
});

// ─── Visual constants ─────────────────────────────────────────────────────────
// Board width in user units — the whole board unless `max_width` lets it grow,
// and the floor when it does. See boardWidth().
const SVG_W = 440;
// The card's on-screen cap in CSS px when `max_width` is not set: the 700 px it
// has always had. It also fixes the scale a wider board is drawn at.
const DEFAULT_MAX_WIDTH = 700;
const ML = 70;
const GPAD = 12;
const GHDR = 36;
const ZH = 22;
const HEADER_H = 20;
const SQ = 24;
// The power bubbles are anchored this far in from the board's right edge —
// x = 350 at SVG_W. Kept as a margin rather than an x because the board can
// widen, and the bubbles, and everything that stops short of them, move with
// its right edge.
const PWR_MARGIN = 90;
const CB_SQ = 20;
// Clear space between a group box and whatever hangs off its bus — its own
// breakers, or a nested group's box. The horizontal step per nesting level is
// `group box width + INDENT_GAP`; it used to be the constant SQ + 10, which is
// what this still comes to for a group whose id fits the default square.
const INDENT_GAP = 10;
// Vertical breathing room above a nested group block, so it reads as a
// separate board rather than another breaker row.
const SUBGROUP_GAP = 6;
// The three phase readings hang off the trunks as a staircase, each one PH_STEP
// lower and PH_STAGGER further right than the last. A bubble is 13.5 tall, so
// at this step two neighbours overlap by 3.5 vertically; the sideways stagger
// is what keeps them apart, and at 40 a reading as wide as "−1.2 kW" (37 with
// its padding) clears the next one. Each connector runs 2.25 above its
// reading, which keeps it below the bubble on the row above.
const PH_STEP = 10;
const PH_STAGGER = 40;
const PH_BUBBLE_X = 150; // L1's reading; L2 and L3 follow PH_STAGGER apart
// Where the board starts, below the staircase (taps at 6, 16, 26). The first
// group's box sits GPAD + 6 further down, at 44: 7 clear of the lowest thing
// the header can draw — the Grid reading, level with L3 at 29, whose
// saturation bar ends 8 below that — and 10.5 clear of its bubble alone.
const PH_TAP_ZONE = 26;
// Id boxes (group square, breaker square, floor pill) grow with their text.
// SQ / CB_SQ / BW stay the *minimum* width, so every panel whose ids are short
// — which was the only kind that rendered correctly before — is untouched.
const BOX_PAD = 4; // clear space each side of an id once the box has to grow
// Minimum clearance tolerated before a box grows at all. Deliberately smaller
// than BOX_PAD: a two-character id measures ~12 against CB_SQ's 20, so asking
// for BOX_PAD on both sides would nudge it to 20.15 and shift every x to its
// right by a fraction of a pixel — churn in the committed previews, invisible
// on screen. Growth should mean the text was actually crowded.
const BOX_MIN_GAP = 2;
const ID_FONT = 9; // group and breaker ids
const FLOOR_FONT = 7; // floor pill
// Past this the box stops growing and the text is elided instead. The board is
// as little as SVG_W (440) wide with the power bubbles at x = 350, and every
// box pushes everything to its right; without a ceiling a single long id would
// walk the zone text under the bubbles. Long names belong beside the box, not
// inside it — see the `label` fields.
const MAX_BOX_W = 64;
const ELLIPSIS = '…';
// Board labels — `label` on a group or circuit — sit on the element's own row,
// between its box and its power bubble. That row is free: a group's children
// and a breaker's zones both hang *below* it.
const LABEL_FONT = 8;
const LABEL_GAP = 6; // between the box and the label
// Where a label has to stop, measured left from the bubbles' x. The bubbles are
// right-anchored there and grow leftward — value text, then the saturation bar
// 30 short of it, then the background's own padding — so this keeps a label
// clear of the widest of them.
const LABEL_CLEARANCE = 46;

// ─── Supply tree (#41) ────────────────────────────────────────────────────────
// Groups with `feeds` leave the board and are drawn above the phase trunks, as
// the board's own nesting turned upside down: a node's inputs sit above it,
// one indent to the right, and join a collector that drops into the top of its
// box. The root is `board` — a box with no group behind it, which the trunks
// start from.
const BOARD_TARGET = 'board';
const BOARD_ICON = 'mdi:home-lightning-bolt-outline';
// A supply row is a box, whatever the group carries: its circuits are drawn
// on the board instead (see _computeLayout). Between two boxes it leaves
// SUBGROUP_GAP, the room a nested board gets above its own box.
const SUPPLY_ROW = SQ + SUBGROUP_GAP;
// Above the first box. The phase captions no longer sit at the top of the
// board, so this only keeps that box off the card's edge.
const SUPPLY_TOP = 6;
// The trunks start on the main board's row, where its tap dot (r = 3.5) sits on
// their top end. The captions go this far above it: at the 4 they are given
// above HEADER_H, they would touch the dot.
const SUPPLY_CAPTION_GAP = 8;
// And the staggered phase taps start this far below it. The box is on that row
// now, and its label runs out to the right, where the phase readings sit: the
// L1 reading is drawn 6 into the tap zone and its bubble reaches 9 above that,
// so starting the zone 5 past the box's bottom edge leaves 2 between them.
const SUPPLY_TAP_GAP = SQ / 2 + 5;
// What a path reads, in absolute watts, before it is drawn live. `idle_below_w`
// overrides it.
const DEFAULT_IDLE_BELOW_W = 10;
// An idle supply row recedes rather than disappearing: its box and reading
// stay legible, they just stop competing with the path carrying the house.
const IDLE_OPACITY = 0.42;
// Lines and boxes that belong to no group — the main board, and every path
// that is idle or unknown — take the theme's secondary text colour.
const NEUTRAL = 'var(--secondary-text-color, #718096)';
const CARD_BG = 'var(--ha-card-background, var(--card-background-color, white))';

/**
 * Width of the board, in user units, for a container `px` CSS pixels wide.
 *
 * Up to DEFAULT_MAX_WIDTH this is SVG_W, scaled to fit — the board as it has
 * always been drawn. Past it the scale stays where DEFAULT_MAX_WIDTH left it
 * and the board gains units instead, so the text keeps its size and the extra
 * width goes to the labels (#53). Whole units, so a sub-pixel resize does not
 * lay the board out again.
 */
function boardWidth(px: number): number {
  return Math.max(SVG_W, Math.round((px * SVG_W) / DEFAULT_MAX_WIDTH));
}

const PHASE_X: Record<Phase, number> = { L3: 24, L2: 36, L1: 48 };
// Phase wire colours — IEC 60446. Exposed as CSS custom properties so themes
// can override if a user really wants to (rare).
const PHASE_COLOR: Record<Phase, string> = {
  L1: 'var(--electrical-panel-phase-l1-color, #8B4513)',
  L2: 'var(--electrical-panel-phase-l2-color, #1A202C)',
  L3: 'var(--electrical-panel-phase-l3-color, #5A6474)',
};

// Default MDI icons by circuit type. Overridable per circuit (`Circuit.icon`)
// or per zone (`Zone.icon`) — both take any `<ha-icon>` string.
const TYPE_DEFAULT_ICON: Record<string, string> = {
  socket: 'mdi:power-socket-eu',
  light: 'mdi:lightbulb-outline',
  power: 'mdi:lightning-bolt',
};

// WebKit (Safari, and every browser on iOS) paints a positioned element inside
// a <foreignObject> as though the SVG were unscaled: it skips the viewBox
// transform and draws at one user unit per CSS pixel. HA's <ha-svg-icon> is
// `position: relative` on its :host, so wherever the board is not drawn at
// exactly one user unit per pixel the zone icons drift off their rows —
// further the lower they sit on the board (#52). Chromium draws them where
// they belong.
//
// That rule lives inside <ha-icon>'s shadow root, beyond the reach of this
// card's styles, so this sheet is adopted into each icon's root, where a rule
// on the element wins over its own :host rule. Nothing in the icon relies on
// the relative positioning.
const STATIC_ICON = css`
  ha-svg-icon {
    position: static;
  }
`;

// No built-in floor presets — defining "some but not others" is confusing,
// and the right identifier scheme depends on the user's installation. Sample
// floor maps live in the README and docs/data-model.md. Zones referencing a
// floor key not in `config.floors` fall back to a neutral grey pill.

// Fallback palette used when a group has no explicit `accent`. Cycled by
// group index so adjacent groups get distinct colours by default.
const FALLBACK_PALETTE = [
  '#3182ce',
  '#38a169',
  '#d69e2e',
  '#e53e3e',
  '#805ad5',
  '#319795',
  '#dd6b20',
  '#5a67d8',
];

interface ResolvedColors {
  accent: string;
  color: string;
  fill: string;
  stroke: string;
}

// `parentAccent` is passed for nested groups: a sub-board inherits the colour
// of the group feeding it unless it sets its own `accent`, so one branch of
// the diagram reads as one branch.
function resolveColors(g: Group, idx: number, parentAccent?: string): ResolvedColors {
  const accent = g.accent ?? parentAccent ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  return {
    accent,
    color: g.color ?? accent,
    stroke: g.stroke ?? accent,
    fill:
      g.fill ??
      `color-mix(in srgb, ${accent} 18%, ${CARD_BG})`,
  };
}

// ─── Tooltip helpers ──────────────────────────────────────────────────────────
// Compact technical-spec strings rendered inside SVG <title> elements. Browsers
// show them as native tooltips on hover (and on long-press on touch devices).
function groupTooltip(g: Group): string {
  const parts: string[] = [];
  if (g.label) parts.push(g.label);
  if (g.amp !== undefined) parts.push(`${g.amp} A`);
  if (g.mA !== undefined) parts.push(`${g.mA} mA`);
  if (g.poles !== undefined) parts.push(`${g.poles}P`);
  if (g.class) parts.push(`Cl. ${g.class}`);
  if (g.mm2 !== undefined) parts.push(`${g.mm2} mm²`);
  if (g.cond !== undefined) parts.push(`${g.cond} cond.`);
  if (g.phases?.length) parts.push(g.phases.join('+'));
  return parts.join(' · ');
}

function circuitTooltip(c: Circuit): string {
  const parts: string[] = [];
  // Leads, mirroring groupTooltip — and it is how an elided label stays
  // readable, since the drawn one may have been cut to fit the row.
  if (c.label) parts.push(c.label);
  if (c.amp !== undefined) parts.push(`${c.amp} A`);
  if (c.poles !== undefined) parts.push(`${c.poles}P`);
  if (c.mm2 !== undefined) parts.push(`${c.mm2} mm²`);
  if (c.cond !== undefined) parts.push(`${c.cond} cond.`);
  if (c.pts) parts.push(c.pts);
  else if (c.n_pts !== undefined) parts.push(`${c.n_pts} pts`);
  return parts.join(' · ');
}

/**
 * Prefixes `tooltip` with the full id when the box had to elide it, so the
 * complete value stays reachable on hover. A no-op when the id is drawn whole.
 */
function withFullId(id: string, drawn: string, tooltip: string): string {
  if (drawn === id) return tooltip;
  return tooltip ? `${id} · ${tooltip}` : id;
}

function zoneTooltip(z: Zone): string {
  const parts: string[] = [];
  if (z.room) parts.push(z.room);
  if (z.floor) parts.push(z.floor);
  if (z.critical) parts.push('✓ critical');
  return parts.join(' · ');
}

interface CircuitLayout {
  startY: number;
  height: number;
  zones: number;
  /** Left edge of the breaker box — depends on the owning group's depth. */
  x: number;
  /** Box width: CB_SQ unless the id needed more. See boxWidth(). */
  w: number;
  /** Id as drawn — the raw id, or an elided form when it overran MAX_BOX_W. */
  text: string;
}
interface GroupLayout {
  yOff: number;
  height: number;
  /** Nesting level: 0 for a top-level group, +1 per `groups` step. */
  depth: number;
  /** Left edge of the group box. */
  x: number;
  /** Box width: SQ unless the id needed more. See boxWidth(). */
  w: number;
  /** Id as drawn — the raw id, or an elided form when it overran MAX_BOX_W. */
  text: string;
  /** Vertical bus feeding this group's circuits and nested groups. */
  busX: number;
  circuits: Map<string, CircuitLayout>;
  /**
   * Mid-height of the last thing hanging off the bus (breaker or nested
   * group box). Undefined when the group has no children — no bus is drawn.
   */
  lastChildMidY?: number;
}
/** One row of the supply tree drawn above the trunks. */
interface SupplyRow {
  /** The group on this row; undefined for the main board box. */
  g?: Group;
  /** Index in `config.groups`, which picks the fallback accent; -1 for the board. */
  idx: number;
  /** Left edge of the box. */
  x: number;
  w: number;
  /** Id as drawn. Empty for the board, which shows an icon instead. */
  text: string;
  midY: number;
  /** The groups feeding this row, in declaration order. */
  inputs: SupplyRow[];
  /** The row this one feeds; undefined for the board. */
  consumer?: SupplyRow;
}

type FlowKind = 'live' | 'idle' | 'unknown';
interface FlowState {
  kind: FlowKind;
  /** 1 while power runs along `feeds`, toward the board; -1 against it. */
  dir: 1 | -1;
  /** The reason, for the tooltip — a reading against the threshold, or an entity's state. */
  why: string;
}

interface Layout {
  svgW: number;
  svgH: number;
  /** x the power bubbles are right-anchored at: PWR_MARGIN in from svgW. */
  pwrX: number;
  /** Where a label or a room name has to stop. */
  labelRight: number;
  /** Top end of the phase trunks: HEADER_H, or the main board's row under a supply tree. */
  trunkTop: number;
  /** Baseline of the L1 / L2 / L3 captions. */
  phaseLabelY: number;
  /** Where the staggered phase taps start; they sit at +6, +26 and +46. */
  tapTop: number;
  /** Supply tree rows, top to bottom — the main board last. Empty without `feeds`. */
  supply: SupplyRow[];
  phLineEnd: number;
  groupWidth: number;
  /** Keyed by group path — `D1`, `X/D7`, … — so nested ids can repeat. */
  byGroup: Map<string, GroupLayout>;
}

/**
 * Checks `feeds` and `active` across the groups, throwing on the first problem
 * with a path to the offending entry, as the rest of setConfig does. A supply
 * tree that draws half of what was declared would be harder to debug than an
 * error saying which line to fix.
 */
function validateSupply(groups: Group[]): void {
  // A nested group is fed by its parent, so neither key means anything there.
  const nested = (list: Group[], prefix: string): void => {
    list.forEach((g, i) => {
      const where = `${prefix}[${i}]`;
      for (const key of ['feeds', 'active'] as const) {
        if (g[key] !== undefined) {
          throw new Error(
            `${where} "${g.id}": \`${key}\` only applies to a top-level group — a nested group is fed by its parent`,
          );
        }
      }
      nested(g.groups ?? [], `${where}.groups`);
    });
  };
  groups.forEach((g, i) => nested(g.groups ?? [], `groups[${i}].groups`));

  const where = (g: Group): string => `groups[${groups.indexOf(g)}] "${g.id}"`;
  for (const g of groups) {
    if (g.active !== undefined && g.feeds === undefined) {
      throw new Error(`${where(g)}: \`active\` only applies to a group with \`feeds\``);
    }
  }
  const fed = groups.filter((g) => g.feeds !== undefined);
  if (fed.length === 0) return;

  const reserved = groups.find((g) => g.id === BOARD_TARGET);
  if (reserved) {
    throw new Error(
      `${where(reserved)}: the id \`${BOARD_TARGET}\` is reserved by \`feeds\` for the main board — rename this group`,
    );
  }
  const byId = new Map<string, Group>();
  const duplicated = new Set<string>();
  for (const g of groups) {
    if (byId.has(g.id)) duplicated.add(g.id);
    else byId.set(g.id, g);
  }

  for (const g of fed) {
    const target = g.feeds;
    if (typeof target !== 'string' || target === '') {
      throw new Error(`${where(g)}: \`feeds\` must be the id of a top-level group, or \`${BOARD_TARGET}\``);
    }
    if (target === g.id) throw new Error(`${where(g)}: a group cannot feed itself`);
    if (target !== BOARD_TARGET && !byId.has(target)) {
      throw new Error(
        `${where(g)}: \`feeds: ${target}\` names no top-level group — use \`feeds: ${BOARD_TARGET}\` for the main board`,
      );
    }
    if (duplicated.has(target)) {
      throw new Error(`${where(g)}: \`feeds: ${target}\` is ambiguous — two top-level groups are called "${target}"`);
    }
    if (g.summary) {
      throw new Error(
        `${where(g)}: \`summary\` and \`feeds\` would show its reading twice — the supply tree already draws it, so drop \`summary\``,
      );
    }
  }
  // Whatever a group feeds into has to lead on to the board in turn.
  for (const g of fed) {
    const target = byId.get(g.feeds!);
    if (target && target.feeds === undefined) {
      throw new Error(
        `${where(target)}: fed by "${g.id}" but has no \`feeds\` of its own — set \`feeds: ${BOARD_TARGET}\` if it connects to the main board`,
      );
    }
  }
  for (const g of fed) {
    const seen = [g.id];
    let cur = g;
    while (cur.feeds !== BOARD_TARGET) {
      cur = byId.get(cur.feeds!)!;
      if (seen.includes(cur.id)) {
        throw new Error(`${where(g)}: \`feeds\` loops back on itself (${[...seen, cur.id].join(' → ')})`);
      }
      seen.push(cur.id);
    }
  }
}

// Live paths are drawn in the colour of the group they belong to, at full
// weight. Idle ones recede to a thin dashed line, and unknown ones are dotted:
// a sensor that is not reporting says nothing either way, and neither does the
// drawing.
function flowLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: FlowKind,
  stroke: string,
  width: number,
): unknown {
  if (kind === 'live') {
    return svg`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke=${stroke} stroke-width=${width}/>`;
  }
  if (kind === 'idle') {
    return svg`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke=${NEUTRAL}
                     stroke-opacity="0.55" stroke-width="1" stroke-dasharray="3 2.5"/>`;
  }
  return svg`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke=${NEUTRAL}
                   stroke-width="1.5" stroke-dasharray="0.01 3" stroke-linecap="round"/>`;
}

/** A filled triangle, 5 long and 6 wide, centred on (x, y) and pointing `to`. */
function flowArrow(x: number, y: number, to: 'left' | 'right' | 'up' | 'down', fill: string): unknown {
  const r = (n: number): number => Math.round(n * 100) / 100;
  const tip = 2.5;
  const half = 3;
  const pts: Array<[number, number]> =
    to === 'left'
      ? [[x - tip, y], [x + tip, y - half], [x + tip, y + half]]
      : to === 'right'
        ? [[x + tip, y], [x - tip, y - half], [x - tip, y + half]]
        : to === 'down'
          ? [[x, y + tip], [x - half, y - tip], [x + half, y - tip]]
          : [[x, y - tip], [x - half, y + tip], [x + half, y + tip]];
  const d = `M${pts.map(([px, py]) => `${r(px)} ${r(py)}`).join(' L')} Z`;
  return svg`<path d=${d} fill=${fill}/>`;
}

/** Path of a nested group, used as its layout key and bubble id prefix. */
function groupPath(parentPath: string | undefined, g: Group): string {
  return parentPath ? `${parentPath}/${g.id}` : g.id;
}

/**
 * Width of the box that holds `text`, and the text as it should actually be
 * drawn.
 *
 * Three outcomes, in order:
 *   - shorter than `minW`  → `minW`, text unchanged (the pre-existing look)
 *   - fits under MAX_BOX_W → grown to the text, text unchanged
 *   - longer than that     → MAX_BOX_W, text elided to fit
 *
 * When the text cannot be measured at all — no canvas, or a webfont that has
 * not loaded — this returns `minW` with the text untouched, i.e. exactly the
 * old behaviour. The card re-renders once `document.fonts.ready` settles, so
 * that state is transient rather than a wrong final answer.
 */
function fitBox(
  text: string,
  fontSize: number,
  family: string,
  minW: number,
): { w: number; text: string } {
  const measured = measureText(text, fontSize, 'bold', family);
  if (measured === undefined) return { w: minW, text };
  if (measured + 2 * BOX_MIN_GAP <= minW) return { w: minW, text };

  // Whole pixels: the width feeds every x to the right of this box, and
  // fractional geometry there shows up as blurred strokes and as noise in the
  // generated preview SVGs.
  const wanted = Math.ceil(measured + 2 * BOX_PAD);
  if (wanted <= minW) return { w: minW, text };
  if (wanted <= MAX_BOX_W) return { w: wanted, text };

  return {
    w: MAX_BOX_W,
    text: elideText(text, fontSize, 'bold', family, MAX_BOX_W - 2 * BOX_PAD),
  };
}

/**
 * `text` shortened with a trailing ellipsis until it fits `maxW`, or returned
 * untouched when it already fits — or when it cannot be measured, since
 * drawing it in full is a better failure than dropping characters blindly.
 */
function elideText(
  text: string,
  fontSize: number,
  weight: string,
  family: string,
  maxW: number,
): string {
  const measured = measureText(text, fontSize, weight, family);
  if (measured === undefined || measured <= maxW) return text;
  // Linear from the end rather than a binary search: these are short strings
  // and every candidate is cached per (font, string) anyway.
  for (let n = text.length - 1; n > 0; n--) {
    const candidate = text.slice(0, n) + ELLIPSIS;
    const w = measureText(candidate, fontSize, weight, family);
    if (w === undefined) return text;
    if (w <= maxW) return candidate;
  }
  // Even one character plus the ellipsis overflows. Only reachable at absurd
  // font sizes; drawing something beats drawing nothing.
  return text.slice(0, 1) + ELLIPSIS;
}

/**
 * A board label — the human-readable `label` on a group or circuit, or a
 * zone's `room` — sized to the space between `fromX` and `toX`, where the
 * power bubbles begin, elided if it does not fit.
 * `null` when there is no label, or when nesting has left no room at all.
 */
function fitLabel(
  text: string | undefined,
  family: string,
  fromX: number,
  toX: number,
): { text: string; w: number } | null {
  if (!text) return null;
  const maxW = toX - fromX;
  if (maxW <= 0) return null;
  const drawn = elideText(text, LABEL_FONT, 'normal', family, maxW);
  return { text: drawn, w: measureText(drawn, LABEL_FONT, 'normal', family) ?? 0 };
}

@customElement(CARD_TAG)
export class ElectricalPanelCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public dark = false;

  @state() private _config?: ElectricalPanelCardConfig;

  @state()
  private _dialog: {
    title: string;
    rows: Array<[string, string]>;
    /** When set, the dialog shows a "More info" button opening HA's
        native more-info dialog for this entity. */
    entity?: string;
  } | null = null;

  // Caches keyed on the current `_config` reference. Cleared in setConfig().
  private _layoutCache?: Layout;
  private _entityCache?: string[];
  // Per-bubble bbox memo keyed by data-id; skips getBBox + setAttribute calls
  // when the displayed text hasn't changed since the last render.
  private _bubbleTextCache: Map<string, string> = new Map();
  // Pending until HA defines <ha-icon>; see _staticIcons().
  private _iconsDefined?: Promise<void>;

  // Board width in user units: SVG_W unless `max_width` lets the board grow
  // past DEFAULT_MAX_WIDTH, in which case it follows the container. See
  // _observeWidth().
  @state() private _boardW = SVG_W;
  private _resizeObserver?: ResizeObserver;
  private _observedWrap?: Element;

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass')) {
      const darkMode = !!(this.hass?.themes as { darkMode?: boolean } | undefined)?.darkMode;
      if (this.dark !== darkMode) this.dark = darkMode;
    }
  }

  // Skip work when nothing the card cares about has changed. Lit triggers an
  // update on every `hass` property change (which fires for every state in
  // the system), but most of those are unrelated to this card's entities.
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (
      changed.has('_config') ||
      changed.has('_dialog') ||
      changed.has('dark') ||
      changed.has('_boardW')
    ) {
      return true;
    }
    if (changed.has('hass')) {
      const oldHass = changed.get('hass') as HomeAssistant | undefined;
      // First hass set — always render.
      if (!oldHass || !this.hass) return true;
      const entities = this._getEntityList();
      for (const e of entities) {
        if (oldHass.states[e]?.state !== this.hass.states[e]?.state) return true;
        if (
          oldHass.states[e]?.attributes?.unit_of_measurement !==
          this.hass.states[e]?.attributes?.unit_of_measurement
        ) {
          return true;
        }
      }
      // Theme mode flip is handled in willUpdate; if hass changed but no
      // tracked entity moved and `dark` didn't flip, nothing to render.
      return false;
    }
    return false;
  }

  /** Memoised layout computation. */
  private _getLayout(): Layout {
    if (!this._layoutCache) {
      this._layoutCache = this._computeLayout();
    }
    return this._layoutCache;
  }

  /** Memoised list of every entity_id this card watches. */
  private _getEntityList(): string[] {
    if (this._entityCache) return this._entityCache;
    const set = new Set<string>();
    const cfg = this._config;
    if (!cfg) {
      this._entityCache = [];
      return this._entityCache;
    }
    const s = cfg.sensors;
    [s?.total?.entity, s?.grid?.entity, s?.phases?.l1?.entity, s?.phases?.l2?.entity, s?.phases?.l3?.entity]
      .forEach((e) => e && set.add(e));
    const walk = (g: Group): void => {
      if (g.sensor) set.add(g.sensor);
      if (g.switch) set.add(g.switch);
      if (g.active) set.add(g.active);
      for (const c of g.circuits ?? []) {
        if (c.sensor) set.add(c.sensor);
        if (c.switch) set.add(c.switch);
        for (const z of c.zones ?? []) {
          if (z.sensor) set.add(z.sensor);
          if (z.switch) set.add(z.switch);
        }
      }
      (g.groups ?? []).forEach(walk);
    };
    cfg.groups.forEach(walk);
    this._entityCache = [...set];
    return this._entityCache;
  }

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    const cfg = config as ElectricalPanelCardConfig;
    if (!Array.isArray(cfg.groups) || cfg.groups.length === 0) {
      throw new Error('`groups` is required and must contain at least one group');
    }
    // Nested groups get the same checks, reported with a path that points at
    // the offending entry (`groups[2].groups[0]`).
    const validate = (list: Group[], prefix: string): void => {
      list.forEach((g, i) => {
        const where = `${prefix}[${i}]`;
        if (!g.id) throw new Error(`${where}: \`id\` is required`);
        if (!Array.isArray(g.phases)) {
          throw new Error(
            `${where} "${g.id}": \`phases\` must be an array (use [] for none)`,
          );
        }
        if (g.groups !== undefined) {
          if (!Array.isArray(g.groups)) {
            throw new Error(`${where} "${g.id}": \`groups\` must be an array`);
          }
          validate(g.groups, `${where}.groups`);
        }
      });
    };
    validate(cfg.groups, 'groups');
    validateSupply(cfg.groups);
    if (
      cfg.idle_below_w !== undefined &&
      (typeof cfg.idle_below_w !== 'number' || !Number.isFinite(cfg.idle_below_w) || cfg.idle_below_w < 0)
    ) {
      throw new Error('`idle_below_w` must be a number of watts, e.g. `idle_below_w: 10`');
    }
    // A number of CSS pixels. A string like `1300px` is refused rather than
    // parsed: accepting it would invite `80%` or `50em`, which a pixel cap
    // cannot honour.
    if (
      cfg.max_width !== undefined &&
      (typeof cfg.max_width !== 'number' || !Number.isFinite(cfg.max_width) || cfg.max_width <= 0)
    ) {
      throw new Error('`max_width` must be a number of pixels, e.g. `max_width: 1300`');
    }
    this._config = cfg;
    // Invalidate config-derived caches.
    this._layoutCache = undefined;
    this._entityCache = undefined;
    this._bubbleTextCache.clear();
    // A board that can no longer grow goes back to SVG_W at once; one that
    // can is measured again after the next render.
    if (!this._fluid()) this._boardW = SVG_W;
    this._observedWrap = undefined;
    this._resizeObserver?.disconnect();
  }

  /** The card's on-screen cap in CSS px. */
  private _maxWidth(): number {
    return this._config?.max_width ?? DEFAULT_MAX_WIDTH;
  }

  // Inline override of the stylesheet's 700px cap, shared by the diagram and
  // the summary table so the two keep one column. No attribute at all when
  // the key is unset.
  private _maxWidthStyle(): string | typeof nothing {
    const w = this._config?.max_width;
    return w === undefined ? nothing : `max-width: ${w}px`;
  }

  /**
   * Whether the board widens with its container. Only past DEFAULT_MAX_WIDTH:
   * up to it the board is SVG_W at any size, so a card without `max_width`
   * measures nothing and draws exactly as it always has.
   */
  private _fluid(): boolean {
    return this._maxWidth() > DEFAULT_MAX_WIDTH && typeof ResizeObserver !== 'undefined';
  }

  // Watches the diagram's container while the board is fluid. Called after
  // every render and on reconnection — HA detaches and re-attaches cards when
  // it rebuilds a view, and the container element may be a new one.
  private _observeWidth(): void {
    const wrap = this._fluid()
      ? (this.shadowRoot?.querySelector('.diagram-wrap') ?? undefined)
      : undefined;
    if (wrap === this._observedWrap) return;
    this._resizeObserver?.disconnect();
    this._observedWrap = wrap;
    if (!wrap) return;
    this._resizeObserver ??= new ResizeObserver(([entry]) => {
      // Zero while the card sits in a hidden tab; keep the last real width
      // rather than collapse the board and widen it again on return.
      const px = entry?.contentRect.width ?? 0;
      if (px > 0) this._setBoardWidth(boardWidth(px));
    });
    this._resizeObserver.observe(wrap);
  }

  private _setBoardWidth(w: number): void {
    if (w === this._boardW) return;
    this._boardW = w;
    // Everything anchored to the bubbles moves, so the layout and the bubble
    // sizes measured at the old positions are both stale.
    this._layoutCache = undefined;
    this._bubbleTextCache.clear();
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this._observeWidth();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._observedWrap = undefined;
  }

  public getCardSize(): number {
    if (!this._config) return 1;
    const countRows = (g: Group): number =>
      1 +
      (g.circuits ?? []).reduce((n, c) => n + Math.max(1, c.zones?.length ?? 0), 0) +
      (g.groups ?? []).reduce((n, sub) => n + countRows(sub), 0);
    // Plus one for the main board box when a supply tree is drawn.
    const board = this._config.groups.some((g) => g.feeds !== undefined) ? 1 : 0;
    const rows = this._config.groups.reduce((acc, g) => acc + countRows(g), board);
    return Math.max(3, Math.ceil(rows / 4));
  }

  public static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_TAG);
  }

  public static getStubConfig(): Partial<ElectricalPanelCardConfig> {
    return {
      type: `custom:${CARD_TAG}`,
      groups: [
        {
          id: 'D1',
          phases: ['L1'],
          accent: '#3182ce',
          circuits: [
            {
              id: 'A',
              type: 'socket',
              zones: [{ floor: 'E0', room: 'example' }],
            },
          ],
        },
      ],
    };
  }

  // ── Helpers: state read ───────────────────────────────────────────────────
  private _power(entity?: string): number | null {
    if (!entity || !this.hass) return null;
    const s = this.hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    if (Number.isNaN(v)) return null;
    return s.attributes?.unit_of_measurement === 'kW' ? v * 1000 : v;
  }

  private _switch(entity?: string): boolean | null {
    if (!entity || !this.hass) return null;
    const s = this.hass.states[entity];
    if (!s) return null;
    if (s.state === 'on') return true;
    if (s.state === 'off') return false;
    return null;
  }

  // ── Helpers: i18n ─────────────────────────────────────────────────────────
  private _t(): Translations {
    const haLang =
      (this.hass?.locale as { language?: string } | undefined)?.language ??
      (this.hass as { language?: string } | undefined)?.language;
    const lang = pickLanguage(this._config?.language ?? haLang);
    return getDict(lang);
  }

  private static _fmt(w: number | null): string {
    if (w === null) return '';
    const sign = w < 0 ? '−' : '';
    const abs = Math.abs(w);
    return sign + (abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${Math.round(abs)} W`);
  }

  // ── Metadata dialog (HA-native) ───────────────────────────────────────────
  private _openGroupDialog(ev: Event, g: Group): void {
    ev.stopPropagation();
    const t = this._t();
    const f = t.dialog.fields;
    const rows: Array<[string, string]> = [];
    if (g.label) rows.push([f.label, g.label]);
    if (g.type) rows.push([f.type, g.type]);
    if (g.phases?.length) rows.push([f.phases, g.phases.join(' / ')]);
    if (g.amp !== undefined) rows.push([f.rating, `${g.amp} A`]);
    if (g.mA !== undefined) rows.push([f.sensitivity, `${g.mA} mA`]);
    if (g.poles !== undefined) rows.push([f.poles, `${g.poles}P`]);
    if (g.class) rows.push([f.class, `Cl. ${g.class}`]);
    if (g.mm2 !== undefined) rows.push([f.cross_section, `${g.mm2} mm²`]);
    if (g.cond !== undefined) rows.push([f.conductors, `${g.cond}`]);
    if (g.sensor) {
      const v = ElectricalPanelCard._fmt(this._power(g.sensor));
      rows.push([f.power, v || '—']);
    }
    this._dialog = {
      title: formatI18n(t.dialog.group_title, { id: g.id }),
      rows,
      entity: g.sensor ?? g.switch,
    };
  }

  private _openZoneDialog(ev: Event, zone: Zone, c: Circuit): void {
    ev.stopPropagation();
    const t = this._t();
    const f = t.dialog.fields;
    const rows: Array<[string, string]> = [];
    if (zone.floor) rows.push([f.floor, zone.floor]);
    rows.push([f.type, c.type]);
    if (zone.sensor) {
      const v = ElectricalPanelCard._fmt(this._power(zone.sensor));
      rows.push([f.power, v || '—']);
    }
    if (zone.critical) rows.push([f.critical, '✓']);
    this._dialog = {
      title: zone.room ?? '—',
      rows,
      entity: zone.sensor ?? zone.switch,
    };
  }

  private _openCircuitDialog(ev: Event, c: Circuit): void {
    ev.stopPropagation();
    const t = this._t();
    const f = t.dialog.fields;
    const rows: Array<[string, string]> = [];
    if (c.label) rows.push([f.label, c.label]);
    rows.push([f.type, c.type]);
    if (c.amp !== undefined) rows.push([f.rating, `${c.amp} A`]);
    if (c.poles !== undefined) rows.push([f.poles, `${c.poles}P`]);
    if (c.mm2 !== undefined) rows.push([f.cross_section, `${c.mm2} mm²`]);
    if (c.cond !== undefined) rows.push([f.conductors, `${c.cond}`]);
    if (c.pts) rows.push([f.points, c.pts]);
    else if (c.n_pts !== undefined) rows.push([f.points, `${c.n_pts}`]);
    if (c.sensor) {
      const v = ElectricalPanelCard._fmt(this._power(c.sensor));
      rows.push([f.power, v || '—']);
    }
    this._dialog = {
      title: formatI18n(t.dialog.circuit_title, { id: c.id }),
      rows,
      entity: c.sensor ?? c.switch,
    };
  }

  private _closeDialog(): void {
    this._dialog = null;
  }

  private _openMoreInfo(): void {
    const entity = this._dialog?.entity;
    if (!entity) return;
    this._closeDialog();
    fireEvent(this, 'hass-more-info', { entityId: entity });
  }

  private _toggle(ev: Event, entity: string, criticalLabel?: string): void {
    ev.stopPropagation();
    if (!this.hass) return;
    if (
      criticalLabel &&
      !confirm(formatI18n(this._t().confirm.toggle, { name: criticalLabel }))
    ) {
      return;
    }
    // `homeassistant.toggle`, not `switch.toggle`. The read side (`_switch`)
    // only looks at 'on' / 'off' and never at the domain, so any togglable
    // entity already renders a toggle showing the correct state. Hardcoding
    // the write domain made every one of them outside `switch.*` a no-op, and
    // silently: a service call matching no entity reports nothing the card can
    // see (#43). Easy to hit through the Switch as X helper, which replaces a
    // relay's `switch.*` with a `light.*` and hides the original.
    //
    // HA's generic action dispatches across any domain, so `light`, `fan`,
    // `input_boolean`, `cover`, `script` and the rest work with no allow-list
    // here to fall behind core.
    this.hass.callService('homeassistant', 'toggle', { entity_id: entity });
  }

  /**
   * The family the SVG will actually render with.
   *
   * Read off the custom properties rather than the `<svg>` element, because
   * `_computeLayout()` runs before that element exists on the first pass.
   * Custom properties inherit down to the host, so they are readable from
   * here on frame one. Must mirror the `font-family` chain in `styles`.
   */
  /** Resolved once per layout pass, then reused by the renderers. */
  private _family = 'Arial, sans-serif';

  private _fontFamily(): string {
    const cs = getComputedStyle(this);
    const body = cs.getPropertyValue('--ha-font-family-body').trim();
    if (body) return body;
    const paper = cs.getPropertyValue('--paper-font-body1_-_font-family').trim();
    if (paper) return paper;
    return 'Arial, sans-serif';
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  private _computeLayout(): Layout {
    const groups = this._config!.groups;
    const family = this._fontFamily();
    this._family = family;
    const byGroup = new Map<string, GroupLayout>();

    // Lays out one group and everything below it, returns the total height
    // consumed. A group occupies GHDR for its own box row, then stacks its
    // nested groups, then its own breakers (each CB_SQ + one ZH per zone).
    //
    // Sub-boards come first because that is how panels read: the feed to a
    // remote board is a departure like any other, and in practice it sits
    // above the breakers the parent keeps for itself. YAML mappings carry no
    // ordering between `groups:` and `circuits:`, so this has to be a rule
    // rather than something the config expresses.
    // `x` is passed down rather than derived from `depth`, because a group's
    // children start clear of its box and that box is now only as wide as its
    // id needs. With every id short the arithmetic collapses back to the old
    // `ML + depth × INDENT`, since INDENT is exactly SQ + INDENT_GAP.
    const layoutGroup = (
      g: Group,
      path: string,
      depth: number,
      x: number,
      yOff: number,
    ): number => {
      const box = fitBox(g.id, ID_FONT, family, SQ);
      const cbX = x + box.w + INDENT_GAP;
      const circuits = new Map<string, CircuitLayout>();
      let localY = yOff + GHDR;
      let lastChildMidY: number | undefined;

      for (const sub of g.groups ?? []) {
        localY += SUBGROUP_GAP;
        // The nested box sits GHDR/2 into its own block, same as any group.
        lastChildMidY = localY + GHDR / 2;
        localY += layoutGroup(sub, groupPath(path, sub), depth + 1, cbX, localY);
      }

      for (const c of g.circuits ?? []) {
        const zonesCount = Math.max(1, c.zones?.length ?? 0);
        const height = CB_SQ + zonesCount * ZH;
        const cb = fitBox(c.id, ID_FONT, family, CB_SQ);
        circuits.set(c.id, {
          startY: localY,
          height,
          zones: zonesCount,
          x: cbX,
          w: cb.w,
          text: cb.text,
        });
        lastChildMidY = localY + CB_SQ / 2;
        localY += height;
      }

      const height = localY - yOff;
      byGroup.set(path, {
        yOff,
        height,
        depth,
        x,
        w: box.w,
        text: box.text,
        busX: x + box.w / 2,
        circuits,
        lastChildMidY,
      });
      return height;
    };

    // Without a supply tree the trunks start at HEADER_H, captioned at 16, as
    // they always have. With one they start at the main board's row, the last
    // of the tree, and everything the header carried moves down with them.
    const supply = this._layoutSupply(family);
    const board = supply.length > 0 ? supply[supply.length - 1] : undefined;
    const trunkTop = board ? board.midY : HEADER_H;
    const phaseLabelY = board ? trunkTop - SUPPLY_CAPTION_GAP : 16;
    const tapTop = board ? trunkTop + SUPPLY_TAP_GAP : HEADER_H;
    let yCur = tapTop + PH_TAP_ZONE;
    let phLineEnd = tapTop + PH_TAP_ZONE;

    // A group with `feeds` is a single row in the supply tree. If it has
    // circuits or sub-boards — a PV array's micro-inverters, an inverter's
    // backup circuits — they come down here as a block of their own, at the
    // group's place in `groups`, so the tree stays one row per path and the
    // readings people open the card for stay at the top. The block taps the
    // trunks, and stretches them, only when the group feeds the board
    // directly; see _renderGroup.
    for (const g of groups) {
      const detail = g.feeds !== undefined;
      if (detail && !g.circuits?.length && !g.groups?.length) continue;
      yCur += GPAD;
      if (!detail || g.feeds === BOARD_TARGET) phLineEnd = Math.max(phLineEnd, yCur + GHDR / 2);
      yCur += layoutGroup(g, g.id, 0, ML, yCur);
    }

    const svgW = this._boardW;
    const pwrX = svgW - PWR_MARGIN;
    return {
      svgW,
      svgH: yCur + 24,
      pwrX,
      labelRight: pwrX - LABEL_CLEARANCE,
      trunkTop,
      phaseLabelY,
      tapTop,
      supply,
      phLineEnd,
      groupWidth: svgW - ML - 4,
      byGroup,
    };
  }

  // Rows of the supply tree, top to bottom. The walk is post-order from the
  // main board: a node's inputs first, each with its own inputs above it, then
  // the node — the board's pre-order turned upside down, which is what puts
  // every input above the thing it feeds and its last input right on top of
  // it. Inputs sit one step right of what they feed, the step a nested group
  // takes from its parent, so that collector never crosses a box.
  private _layoutSupply(family: string): SupplyRow[] {
    const groups = this._config!.groups;
    if (!groups.some((g) => g.feeds !== undefined)) return [];
    const rows: SupplyRow[] = [];
    const place = (target: string, g: Group | undefined, idx: number, x: number): SupplyRow => {
      const box = g ? fitBox(g.id, ID_FONT, family, SQ) : { w: SQ, text: '' };
      const row: SupplyRow = { g, idx, x, w: box.w, text: box.text, midY: 0, inputs: [] };
      groups.forEach((input, i) => {
        if (input.feeds !== target) return;
        const child = place(input.id, input, i, x + box.w + INDENT_GAP);
        child.consumer = row;
        row.inputs.push(child);
      });
      rows.push(row);
      return row;
    };
    place(BOARD_TARGET, undefined, -1, ML);
    rows.forEach((r, i) => {
      r.midY = SUPPLY_TOP + i * SUPPLY_ROW + SUPPLY_ROW / 2;
    });
    return rows;
  }

  // ── Bubble: power text + optional toggle + optional connector line ────────
  // Drawn for an element with a `sensor`, a `switch`, or both. With a switch
  // alone the text stays empty and the toggle stands on its own: its position
  // never depended on the text, so it lines up with every other toggle (#45).
  private _bubble(args: {
    id: string;
    x: number;
    y: number;
    anchor?: 'start' | 'middle' | 'end';
    fill?: string;
    connX?: number;
    switchEntity?: string;
    criticalLabel?: string;
    powerEntity?: string;
    /** When set together with a power reading, renders a saturation bar
        beneath the bubble (current / maxW, clamped to 100 %). */
    maxW?: number;
  }): unknown {
    const {
      id,
      x,
      y,
      anchor = 'end',
      fill = 'var(--secondary-text-color)',
      connX,
      switchEntity,
      criticalLabel,
      powerEntity,
      maxW,
    } = args;
    const value = this._power(powerEntity);
    const text = ElectricalPanelCard._fmt(value);
    const isOn = this._switch(switchEntity);
    const tw = 14;
    const th = 8;
    const tr = 3;
    // Width reserved on the right of the value text for the toggle widget.
    // We shift the text (and saturation gauge) right by this amount on
    // bubbles without a toggle so every bubble's pill ends at the same
    // visual x — `x + TOGGLE_RESERVED` — regardless of whether a toggle
    // is rendered. Otherwise no-toggle bubbles would float ~20 px to the
    // left of toggle ones, looking misaligned in dense panels.
    const TOGGLE_RESERVED = 20;
    const textX = switchEntity ? x : x + TOGGLE_RESERVED;
    const sx = x + 4;
    const sy = y - th / 2 - 3;
    const knobX = isOn === true ? sx + tw - tr - 1.5 : sx + tr + 1.5;
    const togFill = isOn === true ? '#38a169' : '#a0aec0';
    // Saturation bar: rendered when both maxW and a current reading exist.
    const SAT_W = 30;
    const SAT_H = 2;
    const satX = textX - SAT_W;
    const satY = y + 6;
    const satRatio =
      maxW !== undefined && value !== null && maxW > 0
        ? Math.abs(value) / maxW
        : null;
    const satFillW = satRatio !== null ? Math.min(1, satRatio) * SAT_W : 0;
    const satOver = satRatio !== null && satRatio > 1;

    return svg`
      ${
        connX !== undefined
          ? svg`<line class="bubble-conn" data-ln-for=${id} x1=${connX} y1=${y - 4}
                       x2=${x} y2=${y - 4} visibility="hidden"></line>`
          : nothing
      }
      <rect class="bubble-bg" data-bg-for=${id} x=${textX - 40} y=${y - 12} width="42"
            height="15" rx="3" visibility="hidden"></rect>
      <text class="pwr-value" data-id=${id} x=${textX} y=${y} text-anchor=${anchor}
            font-size="7.5" font-weight="bold" fill=${fill}>${text}</text>
      ${
        satRatio !== null
          ? svg`
              <title>${(satRatio * 100).toFixed(0)} % of ${maxW} W</title>
              <rect class="sat-track" x=${satX} y=${satY} width=${SAT_W} height=${SAT_H} rx="1"/>
              <rect class="sat-fill" x=${satX} y=${satY}
                    width=${satFillW.toFixed(1)} height=${SAT_H} rx="1"
                    fill=${satOver ? 'var(--error-color, #c53030)' : fill}/>
            `
          : nothing
      }
      ${
        switchEntity
          ? svg`
              <rect data-toggle-for=${id} x=${sx} y=${sy} width=${tw} height=${th}
                    fill=${togFill} rx=${th / 2} style="cursor:pointer"></rect>
              <circle cx=${knobX} cy=${sy + th / 2} r=${tr} fill="white"
                      style="pointer-events:none"></circle>
              <rect data-toggle-hit-for=${id} x=${sx - 3} y=${sy - 4}
                    width=${tw + 6} height=${th + 8}
                    fill="transparent" style="cursor:pointer"
                    @click=${(ev: Event) => this._toggle(ev, switchEntity, criticalLabel)}></rect>
            `
          : nothing
      }
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  protected override render(): TemplateResult {
    if (!this._config || !this.hass) return html``;
    const layout = this._getLayout();
    const sensors = this._config.sensors ?? {};
    const phases = sensors.phases ?? {};
    const floors = this._config.floors ?? {};
    const t = this._t();
    // "Total" and "Grid" share the right-hand column, so they sit on the first
    // and third phase rows: 20 apart, which keeps the two bubbles from butting
    // up against each other. The phase readings need no such gap — they are
    // staggered sideways — so their rows are only PH_STEP apart.
    //
    // Each of the five card-level readings below is skipped when it set
    // `summary: true`, having moved into the summary table above. A phase
    // reading takes its anchor dot with it — the dot exists to tie the bubble
    // to its trunk and anchors nothing once the bubble is gone. The trunks
    // themselves are the diagram and are drawn unconditionally.
    //
    // Kept as a JS comment rather than one in the markup: lit renders HTML
    // comments into the DOM, so anything written there ships in the bundle and
    // is baked into every preview SVG under assets/.
    //
    // "Total" and "Grid" are additionally skipped when no entity is configured
    // at all. Their captions used to be drawn unconditionally, so a card that
    // declared neither still carried two labels naming readings it did not
    // have, each beside an empty bubble. The phase bubbles have no caption and
    // their tap dots read as part of the trunk, so they are left alone.
    //
    // Under a supply tree (#41) the trunks, their captions and these taps all
    // start lower, on the main board's row; see _computeLayout. The tree is
    // interpolated flush against the L1 caption for the reason given in
    // _renderGroup: on its own line it would add whitespace to every preview.
    const phTapY1 = layout.tapTop + 6;
    const phTapY2 = phTapY1 + PH_STEP;
    const phTapY3 = phTapY2 + PH_STEP;

    return html`
      <ha-card .header=${this._config.title ?? ''}>
        ${this._renderSummary()}
        <div class="diagram-wrap" style=${this._maxWidthStyle()}>
          <svg
            viewBox="0 0 ${layout.svgW} ${layout.svgH}"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
          >
            <!-- Phase trunks -->
            <line x1=${PHASE_X.L3} y1=${layout.trunkTop} x2=${PHASE_X.L3} y2=${layout.phLineEnd}
                  stroke=${PHASE_COLOR.L3} stroke-width="3"/>
            <line x1=${PHASE_X.L2} y1=${layout.trunkTop} x2=${PHASE_X.L2} y2=${layout.phLineEnd}
                  stroke=${PHASE_COLOR.L2} stroke-width="3"/>
            <line x1=${PHASE_X.L1} y1=${layout.trunkTop} x2=${PHASE_X.L1} y2=${layout.phLineEnd}
                  stroke=${PHASE_COLOR.L1} stroke-width="3"/>

            <!-- Phase labels -->
            <text class="phase-label" x=${PHASE_X.L3} y=${layout.phaseLabelY} text-anchor="middle"
                  font-size="7.5" font-weight="bold">L3</text>
            <text class="phase-label" x=${PHASE_X.L2} y=${layout.phaseLabelY} text-anchor="middle"
                  font-size="7.5" font-weight="bold">L2</text>
            <text class="phase-label" x=${PHASE_X.L1} y=${layout.phaseLabelY} text-anchor="middle"
                  font-size="7.5" font-weight="bold">L1</text>${this._renderSupply(layout)}

            <!-- Staggered phase taps + bubbles -->
            ${
              phases.l1?.summary
                ? nothing
                : svg`
                    <circle cx=${PHASE_X.L1} cy=${phTapY1} r="2" fill=${PHASE_COLOR.L1}/>
                    ${this._bubble({
                      id: 'phase_l1',
                      x: PH_BUBBLE_X,
                      y: phTapY1,
                      fill: 'var(--primary-text-color)',
                      connX: PHASE_X.L1,
                      powerEntity: phases.l1?.entity,
                      maxW: phases.l1?.max_w,
                    })}
                  `
            }
            ${
              phases.l2?.summary
                ? nothing
                : svg`
                    <circle cx=${PHASE_X.L2} cy=${phTapY2} r="2" fill=${PHASE_COLOR.L2}/>
                    ${this._bubble({
                      id: 'phase_l2',
                      x: PH_BUBBLE_X + PH_STAGGER,
                      y: phTapY2,
                      fill: 'var(--primary-text-color)',
                      connX: PHASE_X.L2,
                      powerEntity: phases.l2?.entity,
                      maxW: phases.l2?.max_w,
                    })}
                  `
            }
            ${
              phases.l3?.summary
                ? nothing
                : svg`
                    <circle cx=${PHASE_X.L3} cy=${phTapY3} r="2" fill=${PHASE_COLOR.L3}/>
                    ${this._bubble({
                      id: 'phase_l3',
                      x: PH_BUBBLE_X + 2 * PH_STAGGER,
                      y: phTapY3,
                      fill: 'var(--primary-text-color)',
                      connX: PHASE_X.L3,
                      powerEntity: phases.l3?.entity,
                      maxW: phases.l3?.max_w,
                    })}
                  `
            }

            <!-- Main totals (right column) -->
            ${
              // Under a supply tree the total is the main board's reading,
              // drawn on its row by _renderSupply rather than here.
              !sensors.total?.entity || sensors.total.summary || layout.supply.length > 0
                ? nothing
                : svg`
                    <text class="label-secondary" x=${layout.pwrX - 55} y=${phTapY1 + 3}
                          text-anchor="end" font-size="7.5">${sensors.total?.label ?? t.card.total}</text>
                    ${this._bubble({
                      id: 'total',
                      x: layout.pwrX,
                      y: phTapY1 + 3,
                      fill: '#c53030',
                      powerEntity: sensors.total?.entity,
                      maxW: sensors.total?.max_w,
                    })}
                  `
            }
            ${
              !sensors.grid?.entity || sensors.grid.summary
                ? nothing
                : svg`
                    <text class="label-secondary" x=${layout.pwrX - 55} y=${phTapY3 + 3}
                          text-anchor="end" font-size="7.5">${sensors.grid?.label ?? t.card.grid}</text>
                    ${this._bubble({
                      id: 'grid',
                      x: layout.pwrX,
                      y: phTapY3 + 3,
                      powerEntity: sensors.grid?.entity,
                      maxW: sensors.grid?.max_w,
                    })}
                  `
            }

            ${this._config.groups.map((g, idx) => {
              // A group with `feeds` is drawn in the supply tree; only its
              // circuits, if it has any, come down here — see _renderGroup.
              const detail = g.feeds !== undefined;
              if (detail && !g.circuits?.length && !g.groups?.length) return nothing;
              const colors = resolveColors(g, idx);
              return this._renderGroup(g, g.id, colors, layout, floors, undefined, detail);
            })}
          </svg>
        </div>
      </ha-card>
      ${this._dialog ? this._renderDialog() : nothing}
    `;
  }

  // ── Supply tree (#41) ─────────────────────────────────────────────────────
  // Whether a path is live, idle or unknown, and which way it runs. In order:
  //  - `active`, when set, decides — the installation knows better than a
  //    reading near zero. The reading's sign still gives the direction.
  //  - otherwise the reading: live at `idle_below_w` (10 W) and above, in
  //    absolute value, and running against `feeds` when negative — a battery
  //    charging, mains taking an export. Unavailable is unknown, not idle.
  //  - a group with neither, like the main board, follows its inputs: live
  //    when one of them is, unknown when one of them is and none is live.
  private _flowState(r: SupplyRow, flow: (r: SupplyRow) => FlowState): FlowState {
    const g = r.g;
    const fmt = ElectricalPanelCard._fmt;
    if (g?.active) {
      const v = this._power(g.sensor);
      const dir = v !== null && v < 0 ? -1 : 1;
      const state = this.hass?.states[g.active]?.state ?? '—';
      const on = this._switch(g.active);
      const kind: FlowKind = on === true ? 'live' : on === false ? 'idle' : 'unknown';
      return { kind, dir, why: `${g.active}: ${state}` };
    }
    if (g?.sensor) {
      const v = this._power(g.sensor);
      if (v === null) {
        return { kind: 'unknown', dir: 1, why: `${g.sensor}: ${this.hass?.states[g.sensor]?.state ?? '—'}` };
      }
      const below = this._config?.idle_below_w ?? DEFAULT_IDLE_BELOW_W;
      return Math.abs(v) >= below
        ? { kind: 'live', dir: v < 0 ? -1 : 1, why: `${fmt(Math.abs(v))} ≥ ${below} W` }
        : { kind: 'idle', dir: 1, why: `${fmt(Math.abs(v))} < ${below} W` };
    }
    const ins = r.inputs.map(flow);
    const ids = (kind?: FlowKind): string =>
      `← ${r.inputs.filter((_, i) => !kind || ins[i].kind === kind).map((i) => i.g!.id).join(', ')}`;
    if (ins.some((s) => s.kind === 'live')) {
      const feeding = ins.some((s) => s.kind === 'live' && s.dir > 0);
      return { kind: 'live', dir: feeding ? 1 : -1, why: ids('live') };
    }
    if (ins.length === 0) return { kind: 'unknown', dir: 1, why: '—' };
    if (ins.some((s) => s.kind === 'unknown')) return { kind: 'unknown', dir: 1, why: ids('unknown') };
    return { kind: 'idle', dir: 1, why: ids() };
  }

  // Drawn in three passes so nothing is painted over a box: the collectors and
  // the stubs into them, then the main board's tap into the trunks, then the
  // rows themselves. Every line carries its state in `data-flow`.
  private _renderSupply(layout: Layout): unknown {
    const rows = layout.supply;
    if (rows.length === 0) return nothing;
    const t = this._t();
    const states = new Map<SupplyRow, FlowState>();
    const flow = (r: SupplyRow): FlowState => {
      let s = states.get(r);
      if (!s) {
        s = this._flowState(r, flow);
        states.set(r, s);
      }
      return s;
    };
    const stroke = (r: SupplyRow): string => (r.g ? resolveColors(r.g, r.idx).stroke : NEUTRAL);
    const cx = (r: SupplyRow): number => r.x + r.w / 2;
    const name = (r: SupplyRow): string => r.g?.id ?? t.card.main_board;
    const board = rows[rows.length - 1];

    // A collector rises from the top of a box to its first input, one segment
    // per input joining it. Each segment is live when something at or above it
    // is, so a collector reads as carrying exactly what has joined it so far.
    // The arrow sits on the last segment, the one entering the box: down while
    // an input feeds, up when the only live ones draw — a battery charging
    // from the AC side, say.
    const collectors = rows.flatMap((r) =>
      r.inputs.map((input, i) => {
        const last = i === r.inputs.length - 1;
        const y1 = input.midY;
        const y2 = last ? r.midY - SQ / 2 : r.inputs[i + 1].midY;
        const joined = r.inputs.slice(0, i + 1).map(flow);
        const kind: FlowKind = joined.some((s) => s.kind === 'live')
          ? 'live'
          : joined.some((s) => s.kind === 'unknown')
            ? 'unknown'
            : 'idle';
        const down = r.inputs.map(flow).some((s) => s.kind === 'live' && s.dir > 0);
        return svg`
          <g data-collector=${r.g?.id ?? BOARD_TARGET} data-flow=${kind}>
            ${flowLine(cx(r), y1, cx(r), y2, kind, stroke(r), 3)}
            ${last && kind === 'live' ? flowArrow(cx(r), (y1 + y2) / 2, down ? 'down' : 'up', stroke(r)) : nothing}
          </g>
        `;
      }),
    );

    // Each group's own stub: out of the left edge of its box and into the
    // collector of what it feeds, with an arrow toward it while it feeds and
    // back toward the box while it draws. The tooltip says why it is drawn
    // the way it is; the wide transparent line gives that tooltip something
    // to hover.
    const stubs = rows
      .filter((r) => r.consumer)
      .map((r) => {
        const s = flow(r);
        const to = cx(r.consumer!);
        return svg`
          <g data-feed=${r.g!.id} data-flow=${s.kind}
             data-dir=${s.kind === 'live' ? (s.dir > 0 ? 'feed' : 'draw') : nothing}>
            <title>${r.g!.id} → ${name(r.consumer!)} · ${s.why}</title>
            ${flowLine(r.x, r.midY, to, r.midY, s.kind, stroke(r), 2)}
            ${s.kind === 'live' ? flowArrow((r.x + to) / 2, r.midY, s.dir > 0 ? 'left' : 'right', stroke(r)) : nothing}
            <line x1=${r.x} y1=${r.midY} x2=${to} y2=${r.midY} stroke="transparent" stroke-width="8"/>
          </g>
        `;
      });

    // The main board taps the trunks the way a top-level group does, on every
    // phase one of its inputs runs on. Where its arrow goes, a group's feed
    // line would carry no arrow at all: between the box and the first trunk.
    const boardState = flow(board);
    const phases = (['L1', 'L2', 'L3'] as Phase[]).filter((p) =>
      board.inputs.some((i) => i.g!.phases.includes(p)),
    );
    const tap =
      phases.length === 0
        ? nothing
        : svg`
          <g data-feed=${BOARD_TARGET} data-flow=${boardState.kind}>
            <title>${t.card.main_board} · ${boardState.why}</title>
            ${flowLine(
              Math.min(...phases.map((p) => PHASE_X[p])),
              board.midY,
              board.x,
              board.midY,
              boardState.kind,
              NEUTRAL,
              2,
            )}
            ${phases.map((p) => svg`<circle cx=${PHASE_X[p]} cy=${board.midY} r="3.5" fill=${NEUTRAL}/>`)}
            ${
              boardState.kind === 'live'
                ? flowArrow((board.x + PHASE_X.L1) / 2, board.midY, boardState.dir > 0 ? 'left' : 'right', NEUTRAL)
                : nothing
            }
          </g>
        `;

    // What enters the main board is the house load, so `sensors.total` is drawn
    // on this row rather than in the top-right corner — still in one place
    // only, and not at all when `summary` has moved it into the table. The row
    // already has a label, so the total's own caption leads the tooltip.
    const boardLabelX = board.x + board.w + LABEL_GAP;
    const boardLabel = fitLabel(t.card.main_board, this._family, boardLabelX, layout.labelRight);
    const total = this._config?.sensors?.total;
    const showTotal = !!total?.entity && !total.summary;
    const boardRow = svg`
      <g>
        <title>${showTotal ? `${t.card.main_board} · ${total!.label ?? t.card.total}` : t.card.main_board}</title>
        <rect x=${board.x} y=${board.midY - SQ / 2} width=${board.w} height=${SQ}
              fill=${CARD_BG} stroke=${NEUTRAL} stroke-width="1.8" rx="2"/>
        <foreignObject x=${cx(board) - 6} y=${board.midY - 6} width="12" height="12"
                       style="overflow: visible">
          <div xmlns="http://www.w3.org/1999/xhtml" class="zone-icon-wrap">
            <ha-icon icon=${BOARD_ICON} class="zone-icon"></ha-icon>
          </div>
        </foreignObject>
        ${
          boardLabel
            ? svg`<text class="board-label" x=${boardLabelX} y=${board.midY + 4}
                        text-anchor="start" font-size=${LABEL_FONT}>${boardLabel.text}</text>`
            : nothing
        }
        ${
          showTotal
            ? this._bubble({
                id: 'total',
                x: layout.pwrX,
                y: board.midY + 3,
                fill: '#c53030',
                connX: boardLabel ? boardLabelX + boardLabel.w + LABEL_GAP : board.x + board.w,
                powerEntity: total!.entity,
                maxW: total!.max_w,
              })
            : nothing
        }
      </g>
    `;

    // Group rows: the same box, label and bubble as on the board, and the same
    // dialog on click. An idle row recedes; an unknown one keeps full strength
    // but a dotted outline, like its line.
    const groupRows = rows
      .filter((r) => r.g)
      .map((r) => {
        const g = r.g!;
        const s = flow(r);
        const colors = resolveColors(g, r.idx);
        const labelX = r.x + r.w + LABEL_GAP;
        const label = fitLabel(g.label, this._family, labelX, layout.labelRight);
        const connX = label ? labelX + label.w + LABEL_GAP : r.x + r.w;
        const tt = withFullId(g.id, r.text, groupTooltip(g));
        return svg`
          <g opacity=${s.kind === 'idle' ? IDLE_OPACITY : nothing}>
            <g class="meta-target" @click=${(ev: Event) => this._openGroupDialog(ev, g)}>
              ${tt ? svg`<title>${tt}</title>` : nothing}
              <rect x=${r.x} y=${r.midY - SQ / 2} width=${r.w} height=${SQ}
                    fill=${colors.fill} stroke=${colors.stroke} stroke-width="1.8" rx="2"
                    stroke-dasharray=${s.kind === 'unknown' ? '2 1.6' : nothing}/>
              <text x=${r.x + r.w / 2} y=${r.midY + 4} text-anchor="middle"
                    font-size=${ID_FONT} font-weight="bold" fill=${colors.color}>${r.text}</text>
              ${
                label
                  ? svg`<text class="board-label" x=${labelX} y=${r.midY + 4}
                              text-anchor="start" font-size=${LABEL_FONT}>${label.text}</text>`
                  : nothing
              }
            </g>
            ${
              g.sensor || g.switch
                ? this._bubble({
                    id: `g-${g.id}`,
                    x: layout.pwrX,
                    y: r.midY + 3,
                    fill: colors.color,
                    connX,
                    switchEntity: g.switch,
                    powerEntity: g.sensor,
                    maxW: g.max_w,
                  })
                : nothing
            }
          </g>
        `;
      });

    return svg`${collectors}${stubs}${tap}${boardRow}${groupRows}`;
  }

  // ── Source summary ────────────────────────────────────────────────────────
  // Groups that opted in with `summary: true`, in declaration order, each with
  // the accent it is drawn with below. Nested groups are included: a PV array
  // behind a sub-board is still where the power comes from. Colour resolution
  // repeats the diagram's own walk — index within the sibling list, parent
  // accent inherited — so a row's dot matches its box rather than drifting to
  // a different palette entry.
  private _summaryRows(): Array<{ path: string; label: string; accent: string; sensor?: string }> {
    const rows: Array<{ path: string; label: string; accent: string; sensor?: string }> = [];
    const walk = (list: Group[], parentPath?: string, parentAccent?: string): void => {
      list.forEach((g, idx) => {
        const { accent } = resolveColors(g, idx, parentAccent);
        const path = groupPath(parentPath, g);
        if (g.summary) rows.push({ path, label: g.label ?? g.id, accent, sensor: g.sensor });
        walk(g.groups ?? [], path, accent);
      });
    };
    walk(this._config?.groups ?? []);
    return rows;
  }

  // Card-level readings that asked to be relocated here. Fixed order rather
  // than config order: `sensors` is a map, so there is nothing to preserve,
  // and total-then-grid-then-phases is the order they already read in on the
  // board's right-hand column.
  private _summaryTotals(): Array<{ key: string; label: string; sensor?: string }> {
    const s = this._config?.sensors ?? {};
    const t = this._t();
    const out: Array<{ key: string; label: string; sensor?: string }> = [];
    const take = (key: string, sensor: Sensor | undefined, fallback: string): void => {
      if (sensor?.summary) out.push({ key, label: sensor.label ?? fallback, sensor: sensor.entity });
    };
    take('total', s.total, t.card.total);
    take('grid', s.grid, t.card.grid);
    // L1/L2/L3 are IEC designators, not words — the board draws them
    // untranslated too.
    take('phase_l1', s.phases?.l1, 'L1');
    take('phase_l2', s.phases?.l2, 'L2');
    take('phase_l3', s.phases?.l3, 'L3');
    return out;
  }

  // Rendered as HTML rather than inside the SVG: the table is text in a
  // one-column-per-value grid, which the browser lays out for free and the
  // SVG would need measured by hand (see text-metrics.ts) at a fixed viewBox
  // width. Nothing here scales with the diagram, and it wraps on a narrow
  // dashboard instead of shrinking with it.
  private _renderSummary(): TemplateResult | typeof nothing {
    const rows = this._summaryRows();
    const totals = this._summaryTotals();
    if (rows.length === 0 && totals.length === 0) return nothing;
    const t = this._t();
    return html`
      <table class="source-summary" style=${this._maxWidthStyle()}>
        <caption>${t.card.sources}</caption>
        <tbody>
          ${rows.map(
            (r) => html`
              <tr>
                <th scope="row">
                  <span class="source-dot" style="background:${r.accent}"></span>${r.label}
                </th>
                <td>
                  ${ElectricalPanelCard._fmt(this._power(r.sensor)) || '—'}
                </td>
              </tr>
            `,
          )}
        </tbody>
        ${
          totals.length === 0
            ? nothing
            : html`
                <tfoot>
                  ${totals.map(
                    (r) => html`
                      <tr>
                        <th scope="row">${r.label}</th>
                        <td>${ElectricalPanelCard._fmt(this._power(r.sensor)) || '—'}</td>
                      </tr>
                    `,
                  )}
                </tfoot>
              `
        }
      </table>
    `;
  }

  // Targets the webawesome-based `ha-dialog` that landed in Home Assistant
  // 2026.3. The previous mwc-dialog API took `heading` and hung its buttons off
  // `primaryAction` / `secondaryAction` slots on the dialog itself; those slot
  // names still exist but moved down a level onto `ha-dialog-footer`. Content
  // addressed to a slot that no longer exists is silently dropped, so the old
  // markup rendered a dialog with no title and no buttons at all rather than
  // failing loudly.
  private _renderDialog(): TemplateResult {
    const d = this._dialog!;
    const t = this._t();
    return html`
      <ha-dialog
        open
        .headerTitle=${d.title}
        @closed=${() => this._closeDialog()}
      >
        <table class="meta-table">
          ${d.rows.map(
            ([k, v]) => html`<tr><th>${k}</th><td>${v}</td></tr>`,
          )}
        </table>
        <ha-dialog-footer slot="footer">
          ${
            d.entity
              ? html`
                  <ha-button
                    slot="secondaryAction"
                    variant="plain"
                    @click=${() => this._openMoreInfo()}
                  >
                    ${t.dialog.more_info}
                  </ha-button>
                `
              : nothing
          }
          <ha-button
            slot="primaryAction"
            variant="accent"
            @click=${() => this._closeDialog()}
          >
            ${t.dialog.close}
          </ha-button>
        </ha-dialog-footer>
      </ha-dialog>
    `;
  }

  // ── Group rendering ───────────────────────────────────────────────────────
  // Same renderer for all group types (distribution, solar, wind, geothermal,
  // hydro, …). The discriminator on `Group.type` is informational; the visual
  // is identical so production groups appear with the same RCD-like box +
  // circuits + zones structure as load groups. For PV systems, each inverter
  // is naturally expressed as a zone (zones already carry their own sensor).
  // `path` identifies the group in the layout map and prefixes its bubble ids
  // — nested boards may legitimately reuse a breaker letter, so ids are scoped
  // by their position in the tree rather than assumed globally unique.
  // `feedX` is the bus x of the parent group; omitted at the top level, where
  // the group is fed by the phase trunks instead.
  private _renderGroup(
    g: Group,
    path: string,
    colors: ResolvedColors,
    layout: Layout,
    floors: Record<string, FloorStyle>,
    feedX?: number,
    /**
     * The circuits of a group drawn in the supply tree. Its row up there
     * carries the reading, so this block has no bubble: it would show the
     * reading a second time. It taps the trunks only when the group feeds
     * `board` directly, which means it is wired into the board like any
     * departure. A group that reaches the board through another — a battery
     * behind its inverter — is not, and a tap would draw a departure that
     * does not exist.
     */
    detail = false,
  ): unknown {
    const gl = layout.byGroup.get(path)!;
    const midY = gl.yOff + GHDR / 2;
    const circuits = g.circuits ?? [];
    const subGroups = g.groups ?? [];

    // Top level: one tap dot per phase, plus a feed line from the leftmost
    // tapped trunk. Nested: a single feed line from the parent's bus — the
    // phases are inherited, so drawing taps there would be a lie.
    const nested = feedX !== undefined;
    const phases = g.phases;
    const onTrunks = !detail || g.feeds === BOARD_TARGET;
    const taps = nested || !onTrunks
      ? nothing
      : phases.map(
          (p) => svg`<circle cx=${PHASE_X[p]} cy=${midY} r="3.5" fill=${colors.stroke}/>`,
        );
    const leftmostX =
      phases.length > 0 ? Math.min(...phases.map((p) => PHASE_X[p])) : ML;
    const feedFrom = nested ? feedX : leftmostX;
    const feedLine =
      onTrunks && (nested || phases.length > 0)
        ? svg`<line x1=${feedFrom} y1=${midY} x2=${gl.x} y2=${midY}
                    stroke=${colors.stroke} stroke-width="2"/>`
        : nothing;

    // Bus only when something hangs off it — a breaker or a nested group.
    const bus =
      gl.lastChildMidY !== undefined
        ? svg`<line x1=${gl.busX} y1=${midY + SQ / 2} x2=${gl.busX} y2=${gl.lastChildMidY}
                    stroke=${colors.stroke} stroke-width="3"/>`
        : nothing;

    // The label shares its row with the connector line running out to the
    // power bubble, so the connector starts after the label rather than at the
    // box — otherwise the line would strike straight through the text.
    const labelX = gl.x + gl.w + LABEL_GAP;
    const groupLabel = fitLabel(g.label, this._family, labelX, layout.labelRight);
    const groupConnX = groupLabel ? labelX + groupLabel.w + LABEL_GAP : gl.x + gl.w;
    // Interpolated tight against the id's </text> below rather than placed on
    // its own line: `nothing` still emits the surrounding whitespace, which
    // would rewrite every committed preview with blank lines and no visual
    // change. Keeping it flush means a preview diff always means a real one.
    const groupLabelMarkup = groupLabel
      ? svg`<text class="board-label" x=${labelX} y=${midY + 4}
                  text-anchor="start"
                  font-size=${LABEL_FONT}>${groupLabel.text}</text>`
      : nothing;

    return svg`
      ${taps}
      ${feedLine}

      <g class="meta-target" @click=${(ev: Event) => this._openGroupDialog(ev, g)}>
        ${(() => {
          // An elided id would otherwise be unrecoverable, so it leads the
          // tooltip whenever the box could not show it in full.
          const tt = withFullId(g.id, gl.text, groupTooltip(g));
          return tt ? svg`<title>${tt}</title>` : nothing;
        })()}
        <rect x=${gl.x} y=${midY - SQ / 2} width=${gl.w} height=${SQ}
              fill=${colors.fill} stroke=${colors.stroke} stroke-width="1.8" rx="2"/>
        <text x=${gl.x + gl.w / 2} y=${midY + 4} text-anchor="middle"
              font-size=${ID_FONT} font-weight="bold" fill=${colors.color}>${gl.text}</text>${groupLabelMarkup}
      </g>

      ${
        !detail && (g.sensor || g.switch)
          ? this._bubble({
              id: `g-${path}`,
              x: layout.pwrX,
              y: midY + 3,
              fill: colors.color,
              connX: groupConnX,
              switchEntity: g.switch,
              powerEntity: g.sensor,
              maxW: g.max_w,
            })
          : nothing
      }

      ${bus}

      ${subGroups.map((sub, idx) =>
        this._renderGroup(
          sub,
          groupPath(path, sub),
          resolveColors(sub, idx, colors.accent),
          layout,
          floors,
          gl.busX,
        ),
      )}
      ${circuits.map((c) => this._renderCircuit(colors, c, path, gl, layout, floors))}
    `;
  }

  private _renderCircuit(
    colors: ResolvedColors,
    c: Circuit,
    groupKey: string,
    gl: GroupLayout,
    layout: Layout,
    floors: Record<string, FloorStyle>,
  ): unknown {
    const cl = gl.circuits.get(c.id)!;
    const cbMidY = cl.startY + CB_SQ / 2;
    const cbCenterX = cl.x + cl.w / 2;
    const cbRight = cl.x + cl.w;
    // Same arrangement as a group: the label occupies the breaker's own row
    // (its zones hang below), and the bubble connector resumes past it.
    const labelX = cbRight + LABEL_GAP;
    const circuitLabel = fitLabel(c.label, this._family, labelX, layout.labelRight);
    const circuitConnX = circuitLabel ? labelX + circuitLabel.w + LABEL_GAP : cbRight;
    const circuitLabelMarkup = circuitLabel
      ? svg`<text class="board-label" x=${labelX} y=${cbMidY + 4}
                  text-anchor="start"
                  font-size=${LABEL_FONT}>${circuitLabel.text}</text>`
      : nothing;
    const subX = gl.busX;
    const zones = c.zones ?? [];
    const hasZones = zones.length > 0;
    const lastZoneY = hasZones
      ? cl.startY + CB_SQ + (zones.length - 1) * ZH + ZH / 2
      : 0;

    return svg`
      <line x1=${subX} y1=${cbMidY} x2=${cl.x} y2=${cbMidY}
            stroke=${colors.stroke} stroke-width="3"/>
      ${
        hasZones
          ? svg`<line x1=${cbCenterX} y1=${cl.startY + CB_SQ} x2=${cbCenterX} y2=${lastZoneY}
                      stroke=${colors.stroke} stroke-width="1.5"/>`
          : nothing
      }
      <g class="meta-target" @click=${(ev: Event) => this._openCircuitDialog(ev, c)}>
        ${(() => {
          const tt = withFullId(c.id, cl.text, circuitTooltip(c));
          return tt ? svg`<title>${tt}</title>` : nothing;
        })()}
        <rect x=${cl.x} y=${cl.startY} width=${cl.w} height=${CB_SQ}
              fill=${colors.fill} stroke=${colors.stroke} stroke-width="1.8" rx="2"/>
        <text x=${cbCenterX} y=${cl.startY + CB_SQ / 2 + 4} text-anchor="middle"
              font-size=${ID_FONT} font-weight="bold" fill=${colors.color}>${cl.text}</text>${circuitLabelMarkup}
      </g>
      ${
        c.sensor || c.switch
          ? this._bubble({
              id: `c-${groupKey}-${c.id}`,
              x: layout.pwrX,
              y: cbMidY + 3,
              fill: colors.color,
              connX: circuitConnX,
              switchEntity: c.switch,
              powerEntity: c.sensor,
            })
          : nothing
      }

      ${zones.map((zone, j) => {
        const zoneY = cl.startY + CB_SQ + j * ZH + ZH / 2;
        // Layout from left to right (zone content):
        //   [connector line] → [floor pill (optional)] → [type icon] → [room]
        // The connector stops at the start of the zone content so the line
        // never crosses the icon or room text.
        const ix0 = cbRight + 8;
        const BW_MIN = 20;
        const BH = 12;
        const BR = 3;
        const ICON_SIZE = 12;
        const ICON_GAP = 4;
        const fc = zone.floor
          ? floors[zone.floor] ?? { bg: '#a0aec0', fg: 'white' }
          : null;
        // Same treatment as the id boxes: BW_MIN is a floor, not a fixed size.
        const pill = zone.floor
          ? fitBox(zone.floor, FLOOR_FONT, this._family, BW_MIN)
          : { w: BW_MIN, text: '' };
        const pillX = ix0;
        const iconX = fc ? ix0 + pill.w + 4 : ix0;
        const roomX = iconX + ICON_SIZE + ICON_GAP;
        // Bounded like a board label, and for the same reason: the row's
        // bubble sits at the end of it. zoneTooltip leads with the full name.
        const room = fitLabel(zone.room, this._family, roomX, layout.labelRight);
        // And wired like one: the connector resumes just past whatever the row
        // draws — the name, or the icon when there is none — so it neither
        // strikes through the name nor leaves a gap before it.
        const contentEnd = room ? roomX + room.w : iconX + ICON_SIZE;
        const zoneConnX = contentEnd + LABEL_GAP;
        const lineEnd = ix0;
        const iconName =
          zone.icon ?? c.icon ?? TYPE_DEFAULT_ICON[c.type] ?? 'mdi:help';

        const zTooltip = zoneTooltip(zone);
        return svg`
          <g class="meta-target" @click=${(ev: Event) => this._openZoneDialog(ev, zone, c)}>
            ${zTooltip ? svg`<title>${zTooltip}</title>` : nothing}
            <line x1=${cbCenterX} y1=${zoneY} x2=${lineEnd} y2=${zoneY}
                  stroke=${colors.stroke} stroke-width="0.8"/>
            ${
              fc
                ? svg`
                    <rect x=${pillX} y=${zoneY - BH / 2 - 1} width=${pill.w} height=${BH}
                          fill=${fc.bg} rx=${BR}/>
                    <text x=${pillX + pill.w / 2} y=${zoneY - 1} text-anchor="middle"
                          dominant-baseline="central" font-size=${FLOOR_FONT}
                          font-weight="bold" fill=${fc.fg}>${pill.text}</text>
                  `
                : nothing
            }
            <foreignObject x=${iconX} y=${zoneY - ICON_SIZE / 2}
                           width=${ICON_SIZE} height=${ICON_SIZE}
                           style="overflow: visible">
              <div xmlns="http://www.w3.org/1999/xhtml" class="zone-icon-wrap">
                <ha-icon icon=${iconName} class="zone-icon"></ha-icon>
              </div>
            </foreignObject>
            ${
              room
                ? svg`
                    <text class="zone-room" x=${roomX} y=${zoneY - 1}
                          text-anchor="start" dominant-baseline="central"
                          font-size=${LABEL_FONT}>${room.text}</text>
                  `
                : nothing
            }
            ${
              zone.sensor || zone.switch
                ? this._bubble({
                    id: `z-${groupKey}-${c.id}-${j}`,
                    x: layout.pwrX,
                    y: zoneY + 3,
                    fill: 'var(--primary-text-color)',
                    connX: zoneConnX,
                    switchEntity: zone.switch,
                    criticalLabel: zone.critical ? zone.room : undefined,
                    powerEntity: zone.sensor,
                  })
                : nothing
            }
          </g>
        `;
      })}
    `;
  }

  // After each render, size each power-bubble background to match its text
  // bbox. Bubbles whose text hasn't changed since the last pass are skipped
  // — saves a pile of synchronous getBBox() / setAttribute calls when only
  // the live values are updating (the common case).
  protected override updated(): void {
    if (!this.shadowRoot) return;
    const texts = this.shadowRoot.querySelectorAll<SVGTextElement>('text.pwr-value');
    texts.forEach((t) => this._sizeBubble(t));
    this._staticIcons();
    this._observeWidth();
  }

  // Adopt STATIC_ICON into every zone icon's shadow root. An icon rendered
  // before HA has defined <ha-icon> has no root yet; it gets one when the
  // definition upgrades it, so wait for that and pass over them all again.
  private _staticIcons(): void {
    const sheet = STATIC_ICON.styleSheet; // undefined without adoptedStyleSheets
    if (!sheet || !this.shadowRoot) return;
    for (const icon of this.shadowRoot.querySelectorAll('ha-icon.zone-icon')) {
      const root = icon.shadowRoot;
      if (!root) {
        this._iconsDefined ??= customElements
          .whenDefined('ha-icon')
          .then(() => this._staticIcons());
        continue;
      }
      if (!root.adoptedStyleSheets.includes(sheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      }
    }
  }

  // The id boxes are sized from canvas measurements taken during layout, which
  // on a cold load can happen before the theme's webfont has arrived. Those
  // measurements are of the fallback face and generally come out narrow, so
  // once the real fonts settle we drop the cache and lay out again.
  //
  // Runs once. `document.fonts.ready` resolves anew after each additional font
  // load, but chasing every one of those would re-render on unrelated fonts
  // elsewhere in the dashboard; the first settle is what covers the case that
  // actually misdraws.
  protected override firstUpdated(): void {
    void document.fonts?.ready.then(() => {
      resetTextMetrics();
      this.requestUpdate();
    });
  }

  // Size one bubble's background + connector line to fit its text. Pulled
  // out of `updated()` so we can re-invoke it from a rAF retry when the
  // initial getBBox() comes up empty (card painted while in a hidden tab,
  // foreignObject hydration race, …).
  //
  // Critical: the text-cache is only written *after* a successful sizing.
  // If the bbox came up zero we leave the cache untouched so the next
  // updated() — or our own rAF retry — gets another shot. Caching too
  // early here is what previously left bubbles whose entity stayed at the
  // same value (e.g. "0 W") permanently `visibility: hidden`, because
  // shouldUpdate() then skipped every subsequent render.
  private _sizeBubble(t: SVGTextElement, retries = 5): void {
    const id = t.dataset.id;
    if (!id || !this.shadowRoot || !t.isConnected) return;
    const txt = (t.textContent ?? '').trim();
    if (this._bubbleTextCache.get(id) === txt) return; // unchanged

    const bg = this.shadowRoot.querySelector<SVGRectElement>(`rect[data-bg-for="${id}"]`);
    const ln = this.shadowRoot.querySelector<SVGLineElement>(`line[data-ln-for="${id}"]`);
    const tog = this.shadowRoot.querySelector<SVGRectElement>(`rect[data-toggle-for="${id}"]`);
    if (!txt) {
      bg?.setAttribute('visibility', 'hidden');
      // A toggle with no reading beside it — a `switch` with no `sensor`, or
      // one whose sensor is unavailable — keeps its connector, run into the
      // toggle itself. Hidden, the toggle floats in the bubble column tied to
      // no row, which on a dense board is a guess (#45).
      if (ln && tog) {
        const cy = Number(tog.getAttribute('y')) + Number(tog.getAttribute('height')) / 2;
        ln.setAttribute('x2', tog.getAttribute('x') ?? '');
        ln.setAttribute('y1', String(cy));
        ln.setAttribute('y2', String(cy));
        ln.setAttribute('visibility', 'visible');
      } else {
        ln?.setAttribute('visibility', 'hidden');
      }
      this._bubbleTextCache.set(id, txt);
      return;
    }
    let bbox: DOMRect;
    try {
      bbox = t.getBBox();
    } catch {
      return; // transient DOM state; retry on next render
    }
    if (bbox.width === 0) {
      // Text exists but layout isn't computed yet. Schedule rAF retries —
      // covers the case where the card paints inside a hidden HA tab, and
      // the entity then never updates so updated() wouldn't fire again.
      // Capped to 5 attempts (~5 frames ≈ 80 ms) so a permanently zero
      // bbox — orphaned element, font that never loaded — can't drive an
      // infinite loop.
      if (retries > 0) {
        requestAnimationFrame(() => this._sizeBubble(t, retries - 1));
      }
      return;
    }
    const px = 5;
    const py = 3;
    const extraW = tog ? 20 : 0;
    if (bg) {
      bg.setAttribute('x', String(bbox.x - px));
      bg.setAttribute('y', String(bbox.y - py));
      bg.setAttribute('width', String(bbox.width + 2 * px + extraW));
      bg.setAttribute('height', String(bbox.height + 2 * py));
      bg.setAttribute('visibility', 'visible');
    }
    if (ln) {
      const cy = bbox.y + bbox.height / 2;
      ln.setAttribute('x2', String(bbox.x - px));
      ln.setAttribute('y1', String(cy));
      ln.setAttribute('y2', String(cy));
      ln.setAttribute('visibility', 'visible');
    }
    // Only cache after a successful sizing — failed attempts retry above.
    this._bubbleTextCache.set(id, txt);
  }

  public static override get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
        --electrical-panel-phase-l1-color: #8b4513;
        --electrical-panel-phase-l2-color: #1a202c;
        --electrical-panel-phase-l3-color: #5a6474;
      }
      :host([dark]) text.pwr-value[data-id^='g-'],
      :host([dark]) text.pwr-value[data-id^='c-'] {
        filter: brightness(1.55) saturate(0.85);
      }
      @media (prefers-color-scheme: dark) {
        text.pwr-value[data-id^='g-'],
        text.pwr-value[data-id^='c-'] {
          filter: brightness(1.55) saturate(0.85);
        }
      }
      ha-card {
        padding: 8px;
      }
      /* DEFAULT_MAX_WIDTH. \`max_width\` overrides it inline. */
      .diagram-wrap {
        max-width: 700px;
        margin: 0 auto;
      }
      /* Same column as the diagram — 700px, or \`max_width\` — so the rows
         line up with the board underneath rather than floating at their own
         width. */
      .source-summary {
        width: 100%;
        max-width: 700px;
        margin: 0 auto 12px;
        border-collapse: collapse;
      }
      .source-summary caption {
        text-align: left;
        padding-bottom: 4px;
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }
      .source-summary tr + tr th,
      .source-summary tr + tr td {
        border-top: 1px solid var(--divider-color);
      }
      .source-summary th,
      .source-summary td {
        padding: 6px 0;
        font-size: 14px;
        font-weight: 400;
      }
      .source-summary th {
        text-align: left;
        color: var(--primary-text-color);
      }
      /* Tabular figures so the readings form a column that can be compared
         down the page — the whole point is spotting which source is at zero. */
      .source-summary td {
        text-align: right;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      /* Totals are aggregates over the board, not sources feeding it. A rule
         of their own says so; the left padding matches the dot + gap of a
         source row so both label columns start on the same line. */
      .source-summary tfoot th,
      .source-summary tfoot td {
        border-top: 2px solid var(--divider-color);
      }
      .source-summary tfoot th {
        padding-left: 16px;
        color: var(--secondary-text-color);
      }
      .source-summary tfoot td {
        color: var(--primary-text-color);
      }
      .source-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 8px;
        vertical-align: middle;
      }
      svg {
        display: block;
        width: 100%;
        height: auto;
        font-family: var(
          --ha-font-family-body,
          var(--paper-font-body1_-_font-family, Arial, sans-serif)
        );
      }
      .bubble-bg {
        fill: var(--ha-card-background, var(--card-background-color, #fff));
        stroke: var(--divider-color, #e2e8f0);
        stroke-width: 0.7;
      }
      .bubble-conn {
        stroke: var(--divider-color, #cbd5e0);
        stroke-width: 0.5;
      }
      .label-secondary,
      .zone-room,
      .board-label {
        fill: var(--secondary-text-color, #718096);
      }
      .phase-label {
        fill: var(--primary-text-color);
      }
      /* Flex wrapper centres the ha-icon precisely inside its <foreignObject>
         host. Without it, ha-icon's default inline-flex + vertical-align:middle
         puts the icon below the geometric centre and the foreignObject's clip
         rect chops the bottom half. */
      .zone-icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
        line-height: 0;
      }
      .zone-icon {
        --mdc-icon-size: 12px;
        color: var(--secondary-text-color, #718096);
      }
      .meta-target {
        cursor: pointer;
      }
      .meta-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 280px;
      }
      .meta-table tr + tr th,
      .meta-table tr + tr td {
        border-top: 1px solid var(--divider-color);
      }
      .meta-table th,
      .meta-table td {
        text-align: left;
        padding: 8px 16px 8px 0;
        font-size: 14px;
        font-weight: 400;
      }
      .meta-table th {
        color: var(--secondary-text-color);
        white-space: nowrap;
        width: 1%;
      }
      .meta-table td {
        color: var(--primary-text-color);
      }
      .sat-track {
        fill: var(--divider-color, #e2e8f0);
        opacity: 0.5;
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'electrical-panel-card': ElectricalPanelCard;
  }
}
