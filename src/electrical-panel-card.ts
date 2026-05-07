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
import type { HomeAssistant, LovelaceCard, LovelaceCardConfig } from 'custom-card-helpers';

import { CARD_TAG, CARD_VERSION } from './const.js';
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
  name: 'Electrical Panel Card',
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
const CB_X = ML + SQ + 10;
const CB_RIGHT = CB_X + CB_SQ;
const PH_TAP_ZONE = 54; // staggered phase taps fit in here (offsets 6/26/46)

const PHASE_X: Record<Phase, number> = { L3: 24, L2: 36, L1: 48 };
// Phase wire colours — IEC 60446. Exposed as CSS custom properties so themes
// can override if a user really wants to (rare).
const PHASE_COLOR: Record<Phase, string> = {
  L1: 'var(--electrical-panel-phase-l1-color, #8B4513)',
  L2: 'var(--electrical-panel-phase-l2-color, #1A202C)',
  L3: 'var(--electrical-panel-phase-l3-color, #5A6474)',
};

const TYPE_ICON: Record<string, string> = {
  socket: '🔌',
  light: '💡',
  power: '⚙️',
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

function resolveColors(g: Group, idx: number): ResolvedColors {
  const accent = g.accent ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  return {
    accent,
    color: g.color ?? accent,
    stroke: g.stroke ?? accent,
    fill:
      g.fill ??
      `color-mix(in srgb, ${accent} 18%, var(--ha-card-background, var(--card-background-color, white)))`,
  };
}

interface CircuitLayout {
  startY: number;
  height: number;
  zones: number;
}
interface GroupLayout {
  yOff: number;
  height: number;
  circuits: Map<string, CircuitLayout>;
}
interface Layout {
  svgW: number;
  svgH: number;
  phLineEnd: number;
  groupWidth: number;
  byGroup: Map<string, GroupLayout>;
}

@customElement(CARD_TAG)
export class ElectricalPanelCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ type: Boolean, reflect: true }) public dark = false;

  @state() private _config?: ElectricalPanelCardConfig;

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass')) {
      const darkMode = !!(this.hass?.themes as { darkMode?: boolean } | undefined)?.darkMode;
      if (this.dark !== darkMode) this.dark = darkMode;
    }
  }

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    const cfg = config as ElectricalPanelCardConfig;
    if (!Array.isArray(cfg.groups) || cfg.groups.length === 0) {
      throw new Error('`groups` is required and must contain at least one group');
    }
    cfg.groups.forEach((g, i) => {
      if (!g.id) throw new Error(`groups[${i}]: \`id\` is required`);
      if (!Array.isArray(g.phases)) {
        throw new Error(
          `groups[${i}] "${g.id}": \`phases\` must be an array (use [] for none)`,
        );
      }
    });
    this._config = cfg;
  }

  public getCardSize(): number {
    if (!this._config) return 1;
    const rows = this._config.groups.reduce(
      (acc, g) =>
        acc +
        1 +
        (g.circuits ?? []).reduce(
          (n, c) => n + Math.max(1, c.zones?.length ?? 0),
          0,
        ),
      0,
    );
    return Math.max(3, Math.ceil(rows / 4));
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

  // ── Layout ────────────────────────────────────────────────────────────────
  private _computeLayout(): Layout {
    const groups = this._config!.groups;
    const byGroup = new Map<string, GroupLayout>();
    let yCur = HEADER_H + PH_TAP_ZONE;
    let phLineEnd = HEADER_H + PH_TAP_ZONE;

    for (const g of groups) {
      yCur += GPAD;
      const yOff = yCur;
      const circuits = new Map<string, CircuitLayout>();
      let localY = yOff + GHDR;
      for (const c of g.circuits ?? []) {
        const zonesCount = Math.max(1, c.zones?.length ?? 0);
        const height = CB_SQ + zonesCount * ZH;
        circuits.set(c.id, { startY: localY, height, zones: zonesCount });
        localY += height;
      }
      const groupHeight =
        GHDR +
        (g.circuits ?? []).reduce((s, c) => {
          const z = Math.max(1, c.zones?.length ?? 0);
          return s + CB_SQ + z * ZH;
        }, 0);
      byGroup.set(g.id, { yOff, height: groupHeight, circuits });
      phLineEnd = Math.max(phLineEnd, yOff + GHDR / 2);
      yCur += groupHeight;
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
    } = args;
    const text = ElectricalPanelCard._fmt(this._power(powerEntity));
    const isOn = this._switch(switchEntity);
    const tw = 14;
    const th = 8;
    const tr = 3;
    const sx = x + 4;
    const sy = y - th / 2 - 3;
    const knobX = isOn === true ? sx + tw - tr - 1.5 : sx + tr + 1.5;
    const togFill = isOn === true ? '#38a169' : '#a0aec0';

    return svg`
      ${
        connX !== undefined
          ? svg`<line class="bubble-conn" data-ln-for=${id} x1=${connX} y1=${y - 4}
                       x2=${x} y2=${y - 4} visibility="hidden"></line>`
          : nothing
      }
      <rect class="bubble-bg" data-bg-for=${id} x=${x - 40} y=${y - 12} width="42"
            height="15" rx="3" visibility="hidden"></rect>
      <text class="pwr-value" data-id=${id} x=${x} y=${y} text-anchor=${anchor}
            font-size="7.5" font-weight="bold" fill=${fill}>${text}</text>
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
    const layout = this._computeLayout();
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
            })}
            <circle cx=${PHASE_X.L2} cy=${phTapY2} r="2" fill=${PHASE_COLOR.L2}/>
            ${this._bubble({
              id: 'phase_l2',
              x: 185,
              y: phTapY2,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L2,
              powerEntity: phases.l2?.entity,
            })}
            <circle cx=${PHASE_X.L3} cy=${phTapY3} r="2" fill=${PHASE_COLOR.L3}/>
            ${this._bubble({
              id: 'phase_l3',
              x: 220,
              y: phTapY3,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L3,
              powerEntity: phases.l3?.entity,
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
            })}
            <text class="label-secondary" x=${PWR_X - 55} y=${phTapY2 + 3}
                  text-anchor="end" font-size="7.5">${sensors.grid?.label ?? t.card.grid}</text>
            ${this._bubble({
              id: 'grid',
              x: PWR_X,
              y: phTapY2 + 3,
              powerEntity: sensors.grid?.entity,
            })}

            ${this._config.groups.map((g, idx) => {
              const colors = resolveColors(g, idx);
              return this._renderGroup(g, colors, layout, floors);
            })}
          </svg>
        </div>
      </ha-card>
    `;
  }

  // ── Group rendering ───────────────────────────────────────────────────────
  // Same renderer for all group types (distribution, solar, wind, geothermal,
  // hydro, …). The discriminator on `Group.type` is informational; the visual
  // is identical so production groups appear with the same RCD-like box +
  // circuits + zones structure as load groups. For PV systems, each inverter
  // is naturally expressed as a zone (zones already carry their own sensor).
  private _renderGroup(
    g: Group,
    colors: ResolvedColors,
    layout: Layout,
    floors: Record<string, FloorStyle>,
  ): unknown {
    const gl = layout.byGroup.get(g.id)!;
    const midY = gl.yOff + GHDR / 2;
    const subX = ML + SQ / 2;
    const circuits = g.circuits ?? [];

    const phases = g.phases;
    const taps = phases.map(
      (p) => svg`<circle cx=${PHASE_X[p]} cy=${midY} r="3.5" fill=${colors.stroke}/>`,
    );
    const leftmostX =
      phases.length > 0 ? Math.min(...phases.map((p) => PHASE_X[p])) : ML;
    const tapLine =
      phases.length > 0
        ? svg`<line x1=${leftmostX} y1=${midY} x2=${ML} y2=${midY}
                    stroke=${colors.stroke} stroke-width="2"/>`
        : nothing;

    // Sub-bus only when there is at least one circuit.
    let subBus: unknown = nothing;
    if (circuits.length > 0) {
      const lastC = circuits[circuits.length - 1];
      const lastCl = gl.circuits.get(lastC.id)!;
      const lastCircMid = lastCl.startY + CB_SQ / 2;
      subBus = svg`<line x1=${subX} y1=${midY + SQ / 2} x2=${subX} y2=${lastCircMid}
                          stroke=${colors.stroke} stroke-width="3"/>`;
    }

    return svg`
      ${taps}
      ${tapLine}

      <rect x=${ML} y=${midY - SQ / 2} width=${SQ} height=${SQ}
            fill=${colors.fill} stroke=${colors.stroke} stroke-width="1.8" rx="2"/>
      <text x=${ML + SQ / 2} y=${midY + 4} text-anchor="middle"
            font-size="9" font-weight="bold" fill=${colors.color}>${g.id}</text>

      ${
        g.sensor
          ? this._bubble({
              id: `g-${g.id}`,
              x: PWR_X,
              y: midY + 3,
              fill: colors.color,
              connX: ML + SQ,
              switchEntity: g.switch,
              powerEntity: g.sensor,
            })
          : nothing
      }

      ${subBus}

      ${circuits.map((c) => this._renderCircuit(colors, c, gl, floors))}
    `;
  }

  private _renderCircuit(
    colors: ResolvedColors,
    c: Circuit,
    gl: GroupLayout,
    floors: Record<string, FloorStyle>,
  ): unknown {
    const cl = gl.circuits.get(c.id)!;
    const cbMidY = cl.startY + CB_SQ / 2;
    const cbCenterX = CB_X + CB_SQ / 2;
    const subX = ML + SQ / 2;
    const zones = c.zones ?? [];
    const hasZones = zones.length > 0;
    const lastZoneY = hasZones
      ? cl.startY + CB_SQ + (zones.length - 1) * ZH + ZH / 2
      : 0;

    return svg`
      <line x1=${subX} y1=${cbMidY} x2=${CB_X} y2=${cbMidY}
            stroke=${colors.stroke} stroke-width="3"/>
      ${
        hasZones
          ? svg`<line x1=${cbCenterX} y1=${cl.startY + CB_SQ} x2=${cbCenterX} y2=${lastZoneY}
                      stroke=${colors.stroke} stroke-width="1.5"/>`
          : nothing
      }
      <rect x=${CB_X} y=${cl.startY} width=${CB_SQ} height=${CB_SQ}
            fill=${colors.fill} stroke=${colors.stroke} stroke-width="1.8" rx="2"/>
      <text x=${CB_X + CB_SQ / 2} y=${cl.startY + CB_SQ / 2 + 4} text-anchor="middle"
            font-size="9" font-weight="bold" fill=${colors.color}>${c.id}</text>
      ${
        c.sensor
          ? this._bubble({
              id: `c-${c.id}`,
              x: PWR_X,
              y: cbMidY + 3,
              fill: colors.color,
              connX: CB_RIGHT,
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
        const ix0 = CB_RIGHT + 8;
        const BW = 20;
        const BH = 12;
        const BR = 3;
        const ICON_W = 14;
        const fc = zone.floor
          ? floors[zone.floor] ?? { bg: '#a0aec0', fg: 'white' }
          : null;
        const pillX = ix0;
        const iconX = fc ? ix0 + BW + 4 : ix0;
        const roomX = iconX + ICON_W;
        const lineEnd = ix0;

        return svg`
          <line x1=${cbCenterX} y1=${zoneY} x2=${lineEnd} y2=${zoneY}
                stroke=${colors.stroke} stroke-width="0.8"/>
          ${
            fc
              ? svg`
                  <rect x=${pillX} y=${zoneY - BH / 2 - 1} width=${BW} height=${BH}
                        fill=${fc.bg} rx=${BR}/>
                  <text x=${pillX + BW / 2} y=${zoneY - 1} text-anchor="middle"
                        dominant-baseline="central" font-size="7" font-weight="bold"
                        fill=${fc.fg}>${zone.floor}</text>
                `
              : nothing
          }
          <text x=${iconX} y=${zoneY + 4} text-anchor="start" font-size="10">
            ${TYPE_ICON[c.type] ?? ''}
          </text>
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
                  id: `z-${c.id}-${j}`,
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
        `;
      })}
    `;
  }

  // After each render, size each power-bubble background to match its text bbox.
  protected override updated(): void {
    if (!this.shadowRoot) return;
    const texts = this.shadowRoot.querySelectorAll<SVGTextElement>('text.pwr-value');
    texts.forEach((t) => {
      const id = t.dataset.id;
      if (!id) return;
      const bg = this.shadowRoot!.querySelector<SVGRectElement>(`rect[data-bg-for="${id}"]`);
      const ln = this.shadowRoot!.querySelector<SVGLineElement>(`line[data-ln-for="${id}"]`);
      const txt = (t.textContent ?? '').trim();
      if (!txt) {
        bg?.setAttribute('visibility', 'hidden');
        ln?.setAttribute('visibility', 'hidden');
        return;
      }
      let bbox: DOMRect;
      try {
        bbox = t.getBBox();
      } catch {
        return;
      }
      if (bbox.width === 0) return;
      const px = 5;
      const py = 3;
      const hasToggle = !!this.shadowRoot!.querySelector(`rect[data-toggle-for="${id}"]`);
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
    });
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
      .phase-label {
        fill: var(--primary-text-color);
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'electrical-panel-card': ElectricalPanelCard;
  }
}
