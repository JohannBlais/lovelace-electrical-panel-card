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
const SVG_W = 440;
const ML = 70;
const GPAD = 12;
const GHDR = 36;
const ZH = 22;
const HEADER_H = 20;
const SQ = 24;
const PWR_X = 350;
const CB_SQ = 20;
// Clear space between a group box and whatever hangs off its bus — its own
// breakers, or a nested group's box. The horizontal step per nesting level is
// `group box width + INDENT_GAP`; it used to be the constant SQ + 10, which is
// what this still comes to for a group whose id fits the default square.
const INDENT_GAP = 10;
// Vertical breathing room above a nested group block, so it reads as a
// separate board rather than another breaker row.
const SUBGROUP_GAP = 6;
const PH_TAP_ZONE = 54; // staggered phase taps fit in here (offsets 6/26/46)
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
// SVG_W (440) wide with the power bubbles anchored at PWR_X (350), and every
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
// Where a label has to stop. The bubbles are right-anchored at PWR_X and grow
// leftward — value text, then the saturation bar at PWR_X − 30, then the
// background's own padding — so this keeps a label clear of the widest of them.
const LABEL_RIGHT = PWR_X - 46;

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
      `color-mix(in srgb, ${accent} 18%, var(--ha-card-background, var(--card-background-color, white)))`,
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
interface Layout {
  svgW: number;
  svgH: number;
  phLineEnd: number;
  groupWidth: number;
  /** Keyed by group path — `D1`, `X/D7`, … — so nested ids can repeat. */
  byGroup: Map<string, GroupLayout>;
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
 * A board label — the human-readable `label` on a group or circuit — sized to
 * the room between `fromX` and the power bubbles, elided if it does not fit.
 * `null` when there is no label, or when nesting has left no room at all.
 */
function fitLabel(
  text: string | undefined,
  family: string,
  fromX: number,
): { text: string; w: number } | null {
  if (!text) return null;
  const maxW = LABEL_RIGHT - fromX;
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
    if (changed.has('_config') || changed.has('_dialog') || changed.has('dark')) {
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
    this._config = cfg;
    // Invalidate config-derived caches.
    this._layoutCache = undefined;
    this._entityCache = undefined;
    this._bubbleTextCache.clear();
  }

  public getCardSize(): number {
    if (!this._config) return 1;
    const countRows = (g: Group): number =>
      1 +
      (g.circuits ?? []).reduce((n, c) => n + Math.max(1, c.zones?.length ?? 0), 0) +
      (g.groups ?? []).reduce((n, sub) => n + countRows(sub), 0);
    const rows = this._config.groups.reduce((acc, g) => acc + countRows(g), 0);
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
      entity: g.sensor,
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
      entity: c.sensor,
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
    this.hass.callService('switch', 'toggle', { entity_id: entity });
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
    let yCur = HEADER_H + PH_TAP_ZONE;
    let phLineEnd = HEADER_H + PH_TAP_ZONE;

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

    for (const g of groups) {
      yCur += GPAD;
      phLineEnd = Math.max(phLineEnd, yCur + GHDR / 2);
      yCur += layoutGroup(g, g.id, 0, ML, yCur);
    }

    return {
      svgW: SVG_W,
      svgH: yCur + 24,
      phLineEnd,
      groupWidth: SVG_W - ML - 4,
      byGroup,
    };
  }

  // ── Bubble: power text + optional toggle + optional connector line ────────
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
              <rect x=${sx - 3} y=${sy - 4} width=${tw + 6} height=${th + 8}
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
    // 20 px between staggered taps so the right-column "Total" / "Grid"
    // bubbles don't visually butt up against each other.
    const phTapY1 = HEADER_H + 6;
    const phTapY2 = HEADER_H + 26;
    const phTapY3 = HEADER_H + 46;

    return html`
      <ha-card .header=${this._config.title ?? ''}>
        <div class="diagram-wrap">
          <svg
            viewBox="0 0 ${layout.svgW} ${layout.svgH}"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
          >
            <!-- Phase trunks -->
            <line x1=${PHASE_X.L3} y1=${HEADER_H} x2=${PHASE_X.L3} y2=${layout.phLineEnd}
                  stroke=${PHASE_COLOR.L3} stroke-width="3"/>
            <line x1=${PHASE_X.L2} y1=${HEADER_H} x2=${PHASE_X.L2} y2=${layout.phLineEnd}
                  stroke=${PHASE_COLOR.L2} stroke-width="3"/>
            <line x1=${PHASE_X.L1} y1=${HEADER_H} x2=${PHASE_X.L1} y2=${layout.phLineEnd}
                  stroke=${PHASE_COLOR.L1} stroke-width="3"/>

            <!-- Phase labels -->
            <text class="phase-label" x=${PHASE_X.L3} y="16" text-anchor="middle"
                  font-size="7.5" font-weight="bold">L3</text>
            <text class="phase-label" x=${PHASE_X.L2} y="16" text-anchor="middle"
                  font-size="7.5" font-weight="bold">L2</text>
            <text class="phase-label" x=${PHASE_X.L1} y="16" text-anchor="middle"
                  font-size="7.5" font-weight="bold">L1</text>

            <!-- Staggered phase taps + bubbles -->
            <circle cx=${PHASE_X.L1} cy=${phTapY1} r="2" fill=${PHASE_COLOR.L1}/>
            ${this._bubble({
              id: 'phase_l1',
              x: 150,
              y: phTapY1,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L1,
              powerEntity: phases.l1?.entity,
              maxW: phases.l1?.max_w,
            })}
            <circle cx=${PHASE_X.L2} cy=${phTapY2} r="2" fill=${PHASE_COLOR.L2}/>
            ${this._bubble({
              id: 'phase_l2',
              x: 185,
              y: phTapY2,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L2,
              powerEntity: phases.l2?.entity,
              maxW: phases.l2?.max_w,
            })}
            <circle cx=${PHASE_X.L3} cy=${phTapY3} r="2" fill=${PHASE_COLOR.L3}/>
            ${this._bubble({
              id: 'phase_l3',
              x: 220,
              y: phTapY3,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L3,
              powerEntity: phases.l3?.entity,
              maxW: phases.l3?.max_w,
            })}

            <!-- Main totals (right column) -->
            <text class="label-secondary" x=${PWR_X - 55} y=${phTapY1 + 3}
                  text-anchor="end" font-size="7.5">${sensors.total?.label ?? t.card.total}</text>
            ${this._bubble({
              id: 'total',
              x: PWR_X,
              y: phTapY1 + 3,
              fill: '#c53030',
              powerEntity: sensors.total?.entity,
              maxW: sensors.total?.max_w,
            })}
            <text class="label-secondary" x=${PWR_X - 55} y=${phTapY2 + 3}
                  text-anchor="end" font-size="7.5">${sensors.grid?.label ?? t.card.grid}</text>
            ${this._bubble({
              id: 'grid',
              x: PWR_X,
              y: phTapY2 + 3,
              powerEntity: sensors.grid?.entity,
              maxW: sensors.grid?.max_w,
            })}

            ${this._config.groups.map((g, idx) => {
              const colors = resolveColors(g, idx);
              return this._renderGroup(g, g.id, colors, layout, floors);
            })}
          </svg>
        </div>
      </ha-card>
      ${this._dialog ? this._renderDialog() : nothing}
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
    const taps = nested
      ? nothing
      : phases.map(
          (p) => svg`<circle cx=${PHASE_X[p]} cy=${midY} r="3.5" fill=${colors.stroke}/>`,
        );
    const leftmostX =
      phases.length > 0 ? Math.min(...phases.map((p) => PHASE_X[p])) : ML;
    const feedFrom = nested ? feedX : leftmostX;
    const feedLine =
      nested || phases.length > 0
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
    const groupLabel = fitLabel(g.label, this._family, labelX);
    const groupConnX = groupLabel ? labelX + groupLabel.w + LABEL_GAP : gl.x + gl.w;
    // Interpolated tight against the id's </text> below rather than placed on
    // its own line: `nothing` still emits the surrounding whitespace, which
    // would rewrite every committed preview with blank lines and no visual
    // change. Keeping it flush means a preview diff always means a real one.
    const groupLabelMarkup = groupLabel
      ? svg`<text class="board-label" x=${labelX} y=${midY + 3}
                  text-anchor="start" dominant-baseline="central"
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
        g.sensor
          ? this._bubble({
              id: `g-${path}`,
              x: PWR_X,
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
      ${circuits.map((c) => this._renderCircuit(colors, c, path, gl, floors))}
    `;
  }

  private _renderCircuit(
    colors: ResolvedColors,
    c: Circuit,
    groupKey: string,
    gl: GroupLayout,
    floors: Record<string, FloorStyle>,
  ): unknown {
    const cl = gl.circuits.get(c.id)!;
    const cbMidY = cl.startY + CB_SQ / 2;
    const cbCenterX = cl.x + cl.w / 2;
    const cbRight = cl.x + cl.w;
    // Same arrangement as a group: the label occupies the breaker's own row
    // (its zones hang below), and the bubble connector resumes past it.
    const labelX = cbRight + LABEL_GAP;
    const circuitLabel = fitLabel(c.label, this._family, labelX);
    const circuitConnX = circuitLabel ? labelX + circuitLabel.w + LABEL_GAP : cbRight;
    const circuitLabelMarkup = circuitLabel
      ? svg`<text class="board-label" x=${labelX} y=${cbMidY}
                  text-anchor="start" dominant-baseline="central"
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
        c.sensor
          ? this._bubble({
              id: `c-${groupKey}-${c.id}`,
              x: PWR_X,
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
              zone.room
                ? svg`
                    <text class="zone-room" x=${roomX} y=${zoneY - 1}
                          text-anchor="start" dominant-baseline="central"
                          font-size="8">${zone.room}</text>
                  `
                : nothing
            }
            ${
              zone.sensor
                ? this._bubble({
                    id: `z-${groupKey}-${c.id}-${j}`,
                    x: PWR_X,
                    y: zoneY + 3,
                    fill: 'var(--primary-text-color)',
                    connX: 270,
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
    if (!txt) {
      bg?.setAttribute('visibility', 'hidden');
      ln?.setAttribute('visibility', 'hidden');
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
    const hasToggle = !!this.shadowRoot.querySelector(`rect[data-toggle-for="${id}"]`);
    const extraW = hasToggle ? 20 : 0;
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
      .diagram-wrap {
        max-width: 700px;
        margin: 0 auto;
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
      .zone-room {
        fill: var(--secondary-text-color, #718096);
      }
      /* Names the group or breaker it sits beside, so it reads a step stronger
         than the zone rooms listed underneath it. */
      .board-label {
        fill: var(--primary-text-color, #2d3748);
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
