import type { LovelaceCardConfig } from 'custom-card-helpers';

export type CircuitType = 'socket' | 'light' | 'power';

/**
 * Visual style for a group on the diagram.
 *  - distribution: standard sub-distribution box (RCD-like) with circuits
 *    underneath. The default.
 *  - grid_coupling: generic wide horizontal block with phase taps and an
 *    arrow indicator. Used for things like a bidirectional grid meter or a
 *    decoupling protection that isn't a PV system. Carries free-form `rows`.
 *  - pv_system: specialised for solar systems. Same wide-block visual, but
 *    `rows` is replaced by structured `panels` and `inverters` arrays so
 *    each entry can carry its hardware spec (brand, model, count, power)
 *    and an inverter can declare its own live-power sensor.
 */
export type GroupKind = 'distribution' | 'grid_coupling' | 'pv_system';

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

/** Decorative info row inside a `grid_coupling` group. */
export interface DetailRow {
  icon?: string;
  label: string;
}

/** PV panel description (one entry per identical group of panels). */
export interface PvPanel {
  brand?: string;
  model?: string;
  /** Number of identical panels in this entry. Defaults to 1 if omitted. */
  count?: number;
  /** Peak power per panel, in watt-crête. */
  power_wc?: number;
}

/** PV inverter description (one entry per identical group of inverters). */
export interface PvInverter {
  brand?: string;
  model?: string;
  /** Number of identical inverters in this entry. Defaults to 1 if omitted. */
  count?: number;
  /** Nominal AC power per inverter, in watts. */
  power_w?: number;
  /** Optional entity ID for instantaneous power. Renders a bubble on the row. */
  sensor?: string;
}

export interface Group {
  id: string;
  /** Defaults to `'distribution'` when omitted. */
  kind?: GroupKind;
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
   *  - `fill`           → 20% accent mixed with the card background
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
  /** Required for `kind: 'distribution'`; ignored for `'grid_coupling'`. */
  circuits?: Circuit[];
  /**
   * `kind: 'distribution'`: optional metadata (reserved for tooltips).
   * `kind: 'grid_coupling'`: header title (falls back to a localised default).
   */
  label?: string;
  /** `grid_coupling` and `pv_system` — second-line text under the title. */
  subtitle?: string;
  /** `grid_coupling` only — additional info rows under the header. */
  rows?: DetailRow[];
  /** `pv_system` only — one entry per identical group of inverters. */
  inverters?: PvInverter[];
  /** `pv_system` only — one entry per identical group of panels. */
  panels?: PvPanel[];
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
