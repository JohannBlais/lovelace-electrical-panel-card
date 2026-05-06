import type { LovelaceCardConfig } from 'custom-card-helpers';

export type CircuitType = 'socket' | 'light' | 'power';

export interface FloorStyle {
  bg: string;
  fg: string;
}

export interface MainSensor {
  entity: string;
  label?: string;
  max_w?: number;
}

export interface Zone {
  floor?: string;
  room?: string;
  sensor?: string;
  switch?: string;
  critical?: boolean;
}

export interface Circuit {
  id: string;
  amp?: number;
  poles?: 2 | 4;
  mm2?: string;
  cond?: number;
  type: CircuitType;
  pts?: string;
  n_pts?: number;
  sensor?: string;
  switch?: string;
  zones?: Zone[];
}

export interface Group {
  id: string;
  label?: string;
  spec?: string;
  phase: 'L1' | 'L2' | 'L3' | '3P';
  color: string;
  fill: string;
  stroke: string;
  sensor?: string;
  switch?: string;
  circuits: Circuit[];
}

export interface PvBlockConfig {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
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
  sensors?: Record<string, MainSensor>;
  floors?: Record<string, FloorStyle>;
  groups: Group[];
  pv?: PvBlockConfig;
}
