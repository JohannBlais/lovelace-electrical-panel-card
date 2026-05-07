import type { LovelaceCardConfig } from 'custom-card-helpers';

export type CircuitType = 'socket' | 'light' | 'power';

/**
 * Visual style for a group on the diagram.
 *  - distribution: standard sub-distribution box (RCD-like) with circuits
 *    underneath. The default.
 *  - grid_coupling: wide horizontal block with phase taps and an arrow
 *    indicator. Used for things like a PV decoupling protection or a
 *    bidirectional grid meter. Has no circuits; can carry decorative rows.
 */
export type GroupKind = 'distribution' | 'grid_coupling';

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
  /** `grid_coupling` only — second-line text under the title. */
  subtitle?: string;
  /** `grid_coupling` only — additional info rows under the header. */
  rows?: DetailRow[];
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
