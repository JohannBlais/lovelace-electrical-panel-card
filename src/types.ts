import type { LovelaceCardConfig } from 'custom-card-helpers';

export type CircuitType = 'socket' | 'light' | 'power';

/**
 * What the group represents — load (default) or one of several production
 * sources. The renderer is identical across all types; the discriminator is
 * informational, drives default styling (e.g. solar accent), and lets
 * documentation and future tooling reason about the panel topology.
 */
export type GroupType =
  | 'distribution' // load — sub-distribution board / RCD / breaker group (default)
  | 'solar' // production: photovoltaic
  | 'wind' // production: wind turbine
  | 'geothermal' // production: geothermal
  | 'hydro'; // production: hydro

export type Phase = 'L1' | 'L2' | 'L3';

/**
 * Pole count of a breaker or RCD. 1 (single pole), 2 (P+N), 3 (three-phase,
 * no neutral) and 4 (three-phase + N) all occur in the wild — control and
 * lighting circuits on a sub-board are routinely single-pole, and motor
 * loads are often 3P without a neutral.
 */
export type Poles = 1 | 2 | 3 | 4;

export interface FloorStyle {
  bg: string;
  fg: string;
}

export interface Sensor {
  entity: string;
  /** Optional override of the rendered label (where applicable). */
  label?: string;
  /**
   * Rated power in watts. Set alongside `entity` and the bubble gains a
   * saturation bar showing `current / max_w`, clamped at 100 % and repainted
   * in `--error-color` beyond it. Applies to `sensors.total`, `sensors.grid`
   * and each of `sensors.phases`.
   */
  max_w?: number;
}

export interface PhaseSensors {
  l1?: Sensor;
  l2?: Sensor;
  l3?: Sensor;
}

export interface MainSensors {
  total?: Sensor;
  grid?: Sensor;
  phases?: PhaseSensors;
}

export interface Zone {
  floor?: string;
  room?: string;
  sensor?: string;
  switch?: string;
  /** When true and `switch` is set, toggling shows a confirm dialog. */
  critical?: boolean;
  /**
   * Optional MDI icon override (e.g. `'mdi:solar-power'`). Takes precedence
   * over `Circuit.icon` and the type default. Any string accepted by
   * Home Assistant's `<ha-icon>` element works.
   */
  icon?: string;
}

export interface Circuit {
  /**
   * Short designator, drawn inside the breaker box — the marking on the
   * physical panel (`Q1`, `F12`, `D3`). Doubles as this circuit's identity:
   * it keys the layout within its group and, combined with the group path,
   * the power bubble. Keep it to a few characters; the box grows to fit but
   * stops at a ceiling and elides past it. The human-readable description
   * belongs in `label`.
   */
  id: string;
  /**
   * Human-readable name, drawn to the right of the breaker box (`Kitchen
   * sockets`, `Garage door`). Free-form and safe to change at any time,
   * unlike `id`.
   */
  label?: string;
  type: CircuitType;
  sensor?: string;
  switch?: string;
  zones?: Zone[];
  /**
   * Optional MDI icon override applied to all zones of this circuit
   * (e.g. `'mdi:solar-power'` on a PV inverter circuit). Overridden per zone
   * by `Zone.icon`. Falls back to the type default.
   */
  icon?: string;
  // ── Metadata. Not drawn on the diagram itself, but surfaced on hover
  //    (circuitTooltip) and in the click-to-open metadata dialog.
  amp?: number;
  poles?: Poles;
  /** Wire cross-section in mm². Numeric (e.g. `2.5`, `1.5`, `6`) or omitted. */
  mm2?: number;
  cond?: number;
  pts?: string;
  n_pts?: number;
}

export interface Group {
  /**
   * Short designator, drawn inside the group box (`D1`, `HVAC`, `PV`). Also
   * this group's identity: it forms the path (`D1`, `P/R1`) that keys the
   * layout and the power bubbles, so nested ids only need to be unique among
   * their siblings. Keep it short — the box grows to fit but elides past a
   * ceiling. Descriptive text belongs in `label`.
   */
  id: string;
  /** Defaults to `'distribution'` when omitted. */
  type?: GroupType;
  /**
   * Phases the group runs on.
   * - `[L1]` (or `[L2]`, `[L3]`): single-phase
   * - `[L1, L2, L3]`: three-phase
   * - `[]`: no phase tap (rare)
   *
   * Top-level groups tap the phase trunks here — one tap dot per entry.
   * Nested groups (see `groups`) are fed by their parent's bus, not by the
   * trunks, so their phases are informational: they surface in the tooltip
   * and the metadata dialog but draw no tap.
   */
  phases: Phase[];
  /**
   * Single colour. The renderer derives:
   *  - `color` (text)   → accent
   *  - `stroke`         → accent
   *  - `fill`           → 18% accent mixed with the card background
   * Override any of those individually below if you want exact control.
   * When omitted, a colour is picked from a fallback palette by group index.
   */
  accent?: string;
  color?: string;
  fill?: string;
  stroke?: string;
  /** Group-level live power. Renders a bubble next to the box. */
  sensor?: string;
  /**
   * Optional peak / rated power in watts. When set together with `sensor`,
   * the bubble gets a thin saturation bar showing `current / max_w` as
   * a percentage (clamped to 100 %). Useful for production groups
   * (e.g. PV peak Wc) or for showing how close a group is to its
   * subscribed grid limit.
   */
  max_w?: number;
  /** Group-level toggle. Adds an inline switch to the bubble. */
  switch?: string;
  /**
   * Lists this group in the summary table above the diagram, with its accent,
   * its `label` (or `id`) and its live reading. Opt-in rather than inferred
   * from `type`, so a board can summarise a main breaker or a heavy load
   * alongside its sources — and so adding a type never silently rewrites an
   * existing card's header.
   *
   * Nested groups qualify too: what matters is where power comes from, not
   * how deep in the tree it was declared.
   */
  summary?: boolean;
  /**
   * Circuits / branches under this group. Optional — a group may render
   * with just its box and group-level bubble if it has no internal
   * structure. For load groups (`type: 'distribution'`), the convention is
   * still one circuit per breaker. For production groups, each circuit can
   * group similar production units (e.g. a single circuit holding 19
   * inverter zones).
   */
  circuits?: Circuit[];
  /**
   * Nested groups fed by this one — a sub-distribution board, an RCD sitting
   * behind a main breaker, a contactor feeding its own set of circuits.
   * Rendered as an indented group box hanging off this group's bus, above
   * this group's own `circuits`. Nesting is unbounded, but each level costs
   * horizontal room, so two or three deep is the practical limit.
   */
  groups?: Group[];
  /**
   * Human-readable name, drawn to the right of the group box (`Main board`,
   * `Pool house`). Free-form and safe to change at any time, unlike `id`.
   *
   * Was tooltip-only until #30; existing configs that set it will now see it
   * on the board as well.
   */
  label?: string;
  // ── RCD / main breaker metadata. Not drawn on the diagram itself, but
  //    surfaced on hover (groupTooltip) and in the click-to-open metadata
  //    dialog. Replaces the previous free-form `spec` string with structured
  //    fields.
  /** RCD rating in amperes (e.g. 40 for a 40 A breaker). */
  amp?: number;
  /** RCD sensitivity in milliamperes (e.g. 30 for "30 mA"). */
  mA?: number;
  /** Pole count — 1, 2 (P+N), 3 (3P) or 4 (3P+N). */
  poles?: Poles;
  /** RCD class per IEC 60755 (typically `'A'`, `'AC'`, `'B'`, `'F'`). */
  class?: string;
  /**
   * Cross-section of the cable feeding this group, in mm². Numeric
   * (e.g. `10`, `6`). Meaningful on any group, and especially on a nested
   * one: a sub-board is fed by a run of its own, often heavier than
   * anything downstream of it.
   */
  mm2?: number;
  /** Conductor count of that feed (e.g. 3 for L+N+PE, 5 for 3P+N+PE). */
  cond?: number;
}

export interface ElectricalPanelCardConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  /**
   * Optional language override. BCP 47 primary subtag (e.g. 'en', 'fr').
   * When omitted, the card auto-detects from `hass.locale.language` and
   * falls back to English.
   */
  language?: string;
  sensors?: MainSensors;
  floors?: Record<string, FloorStyle>;
  groups: Group[];
}
