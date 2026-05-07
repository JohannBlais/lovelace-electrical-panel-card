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

export interface FloorStyle {
  bg: string;
  fg: string;
}

export interface Sensor {
  entity: string;
  /** Optional override of the rendered label (where applicable). */
  label?: string;
  /** Metadata: nominal/peak rating in watts. Not rendered. */
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
}

export interface Circuit {
  id: string;
  type: CircuitType;
  sensor?: string;
  switch?: string;
  zones?: Zone[];
  // ── Metadata (not rendered yet, kept for future tooltips / info dialogs)
  amp?: number;
  poles?: 2 | 4;
  mm2?: string;
  cond?: number;
  pts?: string;
  n_pts?: number;
}

export interface Group {
  id: string;
  /** Defaults to `'distribution'` when omitted. */
  type?: GroupType;
  /**
   * Phase trunks the group taps into.
   * - `[L1]` (or `[L2]`, `[L3]`): single-phase
   * - `[L1, L2, L3]`: three-phase
   * - `[]`: no phase tap (rare)
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
  /** Group-level toggle. Adds an inline switch to the bubble. */
  switch?: string;
  /**
   * Circuits / branches under this group. Optional — a group may render
   * with just its box and group-level bubble if it has no internal
   * structure. For load groups (`type: 'distribution'`), the convention is
   * still one circuit per breaker. For production groups, each circuit can
   * group similar production units (e.g. a single circuit holding 19
   * inverter zones).
   */
  circuits?: Circuit[];
  /** Optional metadata (reserved for future tooltips). */
  label?: string;
  /** Metadata: free-form spec string (e.g. `'30mA 40A 2P Cl.A'`). */
  spec?: string;
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
