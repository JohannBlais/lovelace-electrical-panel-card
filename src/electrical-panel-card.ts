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
import type {
  Circuit,
  ElectricalPanelCardConfig,
  FloorStyle,
  Group,
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

// ─── Visual constants (preserved from the original SVG schema) ────────────────
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
const PH_TAP_ZONE = 42;
const PV_HEIGHT = GHDR + 2 * ZH;

const PHASE_X: Record<'L1' | 'L2' | 'L3', number> = { L3: 24, L2: 36, L1: 48 };
// Phase colours resolved at render time via CSS custom properties so they can
// adapt to light/dark themes (or be overridden in a HA theme YAML).
const PHASE_COLOR: Record<'L1' | 'L2' | 'L3', string> = {
  L1: 'var(--electrical-panel-phase-l1-color, #8B4513)',
  L2: 'var(--electrical-panel-phase-l2-color, #1A202C)',
  L3: 'var(--electrical-panel-phase-l3-color, #5A6474)',
};

const TYPE_ICON: Record<string, string> = {
  socket: '🔌',
  light: '💡',
  power: '⚙️',
};

const DEFAULT_FLOORS: Record<string, FloorStyle> = {
  'E-1': { bg: '#718096', fg: 'white' },
  E0: { bg: '#38a169', fg: 'white' },
  E1: { bg: '#3182ce', fg: 'white' },
  E2: { bg: '#d69e2e', fg: 'white' },
};

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
  pvYOff: number;
  phLineEnd: number;
  groupWidth: number;
  byGroup: Map<string, GroupLayout>;
}

@customElement(CARD_TAG)
export class ElectricalPanelCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  // Reflected so :host([dark]) can swap CSS variables. Driven by
  // hass.themes.darkMode (the authoritative HA signal), which beats the
  // @media (prefers-color-scheme: dark) fallback when they disagree.
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
    this._config = cfg;
  }

  public getCardSize(): number {
    if (!this._config) return 1;
    const rows = this._config.groups.reduce(
      (acc, g) =>
        acc +
        1 +
        g.circuits.reduce((n, c) => n + Math.max(1, c.zones?.length ?? 0), 0),
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
          phase: 'L1',
          color: '#2c5282',
          fill: '#bee3f8',
          stroke: '#3182ce',
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

  private static _fmt(w: number | null): string {
    if (w === null) return '';
    const sign = w < 0 ? '−' : '';
    const abs = Math.abs(w);
    return sign + (abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${Math.round(abs)} W`);
  }

  private _toggle(ev: Event, entity: string, criticalLabel?: string): void {
    ev.stopPropagation();
    if (!this.hass) return;
    if (criticalLabel && !confirm(`Êtes-vous sûr de vouloir commuter « ${criticalLabel} » ?`)) {
      return;
    }
    this.hass.callService('switch', 'toggle', { entity_id: entity });
  }

  // ── Layout (port of original yOff / circStartY algorithm) ─────────────────
  private _computeLayout(): Layout {
    const groups = this._config!.groups;
    const byGroup = new Map<string, GroupLayout>();
    let yCur = HEADER_H + PH_TAP_ZONE;

    for (const g of groups) {
      yCur += GPAD;
      const yOff = yCur;
      let localY = yOff + GHDR;
      const circuits = new Map<string, CircuitLayout>();
      for (const c of g.circuits) {
        const zones = Math.max(1, c.zones?.length ?? 0);
        const height = CB_SQ + zones * ZH;
        circuits.set(c.id, { startY: localY, height, zones });
        localY += height;
      }
      const groupHeight =
        GHDR +
        g.circuits.reduce((s, c) => {
          const z = Math.max(1, c.zones?.length ?? 0);
          return s + CB_SQ + z * ZH;
        }, 0);
      byGroup.set(g.id, { yOff, height: groupHeight, circuits });
      yCur += groupHeight;
    }

    const pvYOff = yCur + GPAD;
    const svgH = pvYOff + PV_HEIGHT + 24;
    return {
      svgW: SVG_W,
      svgH,
      pvYOff,
      phLineEnd: pvYOff + GHDR / 2,
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
    const floors = { ...DEFAULT_FLOORS, ...(this._config.floors ?? {}) };
    const phTapY1 = HEADER_H + 6;
    const phTapY2 = HEADER_H + 20;
    const phTapY3 = HEADER_H + 34;

    return html`
      <ha-card .header=${this._config.title ?? ''}>
        <div class="diagram-wrap">
          <svg
            viewBox="0 0 ${layout.svgW} ${layout.svgH}"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
          >
            <!-- Phase trunks -->
            <line
              x1=${PHASE_X.L3}
              y1=${HEADER_H}
              x2=${PHASE_X.L3}
              y2=${layout.phLineEnd}
              stroke=${PHASE_COLOR.L3}
              stroke-width="3"
            />
            <line
              x1=${PHASE_X.L2}
              y1=${HEADER_H}
              x2=${PHASE_X.L2}
              y2=${layout.phLineEnd}
              stroke=${PHASE_COLOR.L2}
              stroke-width="3"
            />
            <line
              x1=${PHASE_X.L1}
              y1=${HEADER_H}
              x2=${PHASE_X.L1}
              y2=${layout.phLineEnd}
              stroke=${PHASE_COLOR.L1}
              stroke-width="3"
            />

            <!-- Phase labels (text uses theme color, not cable color) -->
            <text class="phase-label" x=${PHASE_X.L3} y="16" text-anchor="middle"
                  font-size="7.5" font-weight="bold">L3</text>
            <text class="phase-label" x=${PHASE_X.L2} y="16" text-anchor="middle"
                  font-size="7.5" font-weight="bold">L2</text>
            <text class="phase-label" x=${PHASE_X.L1} y="16" text-anchor="middle"
                  font-size="7.5" font-weight="bold">L1</text>

            <!-- Staggered phase taps + bubbles. Tap dot uses cable colour;
                 bubble value text uses theme colour for readability. -->
            <circle cx=${PHASE_X.L1} cy=${phTapY1} r="2" fill=${PHASE_COLOR.L1}/>
            ${this._bubble({
              id: 'phase_l1',
              x: 150,
              y: phTapY1,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L1,
              powerEntity: sensors.phase_l1?.entity,
            })}
            <circle cx=${PHASE_X.L2} cy=${phTapY2} r="2" fill=${PHASE_COLOR.L2}/>
            ${this._bubble({
              id: 'phase_l2',
              x: 185,
              y: phTapY2,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L2,
              powerEntity: sensors.phase_l2?.entity,
            })}
            <circle cx=${PHASE_X.L3} cy=${phTapY3} r="2" fill=${PHASE_COLOR.L3}/>
            ${this._bubble({
              id: 'phase_l3',
              x: 220,
              y: phTapY3,
              fill: 'var(--primary-text-color)',
              connX: PHASE_X.L3,
              powerEntity: sensors.phase_l3?.entity,
            })}

            <!-- Main totals (right column) -->
            <text class="label-secondary" x=${PWR_X - 55} y=${phTapY1 + 3}
                  text-anchor="end" font-size="7.5">${sensors.total?.label ?? 'Total'}</text>
            ${this._bubble({
              id: 'total',
              x: PWR_X,
              y: phTapY1 + 3,
              fill: '#c53030',
              powerEntity: sensors.total?.entity,
            })}
            <text class="label-secondary" x=${PWR_X - 55} y=${phTapY2 + 3}
                  text-anchor="end" font-size="7.5">${sensors.grid?.label ?? 'Réseau'}</text>
            ${this._bubble({
              id: 'grid',
              x: PWR_X,
              y: phTapY2 + 3,
              powerEntity: sensors.grid?.entity,
            })}

            ${this._config.groups.map((g) => this._renderGroup(g, layout, floors))}
            ${this._renderPv(layout, sensors.pv?.entity, sensors.pv?.label)}
          </svg>
        </div>
      </ha-card>
    `;
  }

  private _renderGroup(g: Group, layout: Layout, floors: Record<string, FloorStyle>): unknown {
    const gl = layout.byGroup.get(g.id)!;
    const midY = gl.yOff + GHDR / 2;
    const subX = ML + SQ / 2;
    const lastC = g.circuits[g.circuits.length - 1];
    const lastCl = gl.circuits.get(lastC.id)!;
    const lastCircMid = lastCl.startY + CB_SQ / 2;

    return svg`
      ${
        g.phase === '3P'
          ? svg`
              <circle cx=${PHASE_X.L3} cy=${midY} r="3.5" fill=${g.stroke}/>
              <circle cx=${PHASE_X.L2} cy=${midY} r="3.5" fill=${g.stroke}/>
              <circle cx=${PHASE_X.L1} cy=${midY} r="3.5" fill=${g.stroke}/>
              <line x1=${PHASE_X.L3} y1=${midY} x2=${ML} y2=${midY}
                    stroke=${g.stroke} stroke-width="2"/>
            `
          : svg`
              <circle cx=${PHASE_X[g.phase]} cy=${midY} r="3.5" fill=${g.stroke}/>
              <line x1=${PHASE_X[g.phase]} y1=${midY} x2=${ML} y2=${midY}
                    stroke=${g.stroke} stroke-width="2"/>
            `
      }

      <rect x=${ML} y=${midY - SQ / 2} width=${SQ} height=${SQ}
            fill=${g.fill} stroke=${g.stroke} stroke-width="1.8" rx="2"/>
      <text x=${ML + SQ / 2} y=${midY + 4} text-anchor="middle"
            font-size="9" font-weight="bold" fill=${g.color}>${g.id}</text>

      ${
        g.sensor
          ? this._bubble({
              id: `g-${g.id}`,
              x: PWR_X,
              y: midY + 3,
              fill: g.color,
              connX: ML + SQ,
              switchEntity: g.switch,
              powerEntity: g.sensor,
            })
          : nothing
      }

      <line x1=${subX} y1=${midY + SQ / 2} x2=${subX} y2=${lastCircMid}
            stroke=${g.stroke} stroke-width="3"/>

      ${g.circuits.map((c) => this._renderCircuit(g, c, gl, floors))}
    `;
  }

  private _renderCircuit(
    g: Group,
    c: Circuit,
    gl: GroupLayout,
    floors: Record<string, FloorStyle>,
  ): unknown {
    const cl = gl.circuits.get(c.id)!;
    const cbMidY = cl.startY + CB_SQ / 2;
    const lastZoneY = cl.startY + CB_SQ + (cl.zones - 1) * ZH + ZH / 2;
    const cbCenterX = CB_X + CB_SQ / 2;
    const subX = ML + SQ / 2;
    const zones =
      c.zones && c.zones.length > 0 ? c.zones : [{ floor: undefined, room: undefined }];

    return svg`
      <line x1=${subX} y1=${cbMidY} x2=${CB_X} y2=${cbMidY}
            stroke=${g.stroke} stroke-width="3"/>
      <line x1=${cbCenterX} y1=${cl.startY + CB_SQ} x2=${cbCenterX} y2=${lastZoneY}
            stroke=${g.stroke} stroke-width="1.5"/>
      <rect x=${CB_X} y=${cl.startY} width=${CB_SQ} height=${CB_SQ}
            fill=${g.fill} stroke=${g.stroke} stroke-width="1.8" rx="2"/>
      <text x=${CB_X + CB_SQ / 2} y=${cl.startY + CB_SQ / 2 + 4} text-anchor="middle"
            font-size="9" font-weight="bold" fill=${g.color}>${c.id}</text>
      ${
        c.sensor
          ? this._bubble({
              id: `c-${c.id}`,
              x: PWR_X,
              y: cbMidY + 3,
              fill: g.color,
              connX: CB_RIGHT,
              switchEntity: c.switch,
              powerEntity: c.sensor,
            })
          : nothing
      }

      ${zones.map((zone, j) => {
        const zoneY = cl.startY + CB_SQ + j * ZH + ZH / 2;
        const ix0 = CB_RIGHT + 8;
        const BW = 20;
        const BH = 12;
        const BR = 3;
        const lineEnd = ix0 + 16;
        const textX = ix0 + 16;
        const fc = zone.floor
          ? floors[zone.floor] ?? { bg: '#a0aec0', fg: 'white' }
          : null;

        return svg`
          <line x1=${cbCenterX} y1=${zoneY} x2=${lineEnd} y2=${zoneY}
                stroke=${g.stroke} stroke-width="0.8"/>
          <text x=${ix0} y=${zoneY + 4} text-anchor="start" font-size="10">
            ${TYPE_ICON[c.type] ?? ''}
          </text>
          ${
            fc
              ? svg`
                  <rect x=${textX} y=${zoneY - BH / 2 - 1} width=${BW} height=${BH}
                        fill=${fc.bg} rx=${BR}/>
                  <text x=${textX + BW / 2} y=${zoneY - 1} text-anchor="middle"
                        dominant-baseline="central" font-size="7" font-weight="bold"
                        fill=${fc.fg}>${zone.floor}</text>
                `
              : nothing
          }
          ${
            zone.room
              ? svg`
                  <text class="zone-room" x=${fc ? textX + BW + 4 : textX} y=${zoneY - 1}
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

  private _renderPv(layout: Layout, pvEntity?: string, pvLabel?: string): unknown {
    const pvMidY = layout.pvYOff + GHDR / 2;
    const GW = layout.groupWidth;
    const pvR1 = layout.pvYOff + GHDR;
    const pvR2 = pvR1 + ZH;
    const title = pvLabel ?? 'Découplage 4P — Synergrid C10/11';

    return svg`
      <circle class="pv-accent" cx=${PHASE_X.L3} cy=${pvMidY} r="3.5"/>
      <circle class="pv-accent" cx=${PHASE_X.L2} cy=${pvMidY} r="3.5"/>
      <circle class="pv-accent" cx=${PHASE_X.L1} cy=${pvMidY} r="3.5"/>
      <line class="pv-accent-line" x1=${PHASE_X.L3} y1=${pvMidY} x2=${ML} y2=${pvMidY}/>
      <polygon class="pv-accent"
        points="${PHASE_X.L3 - 5},${pvMidY + 14} ${PHASE_X.L3},${pvMidY + 2} ${PHASE_X.L3 + 5},${pvMidY + 14}"
      />
      <rect class="pv-bg" x=${ML} y=${layout.pvYOff} width=${GW} height=${GHDR} rx="5"/>
      <text class="pv-icon" x=${ML + 14} y=${layout.pvYOff + GHDR / 2 + 5}
            text-anchor="middle" font-size="14">⚡</text>
      <text class="pv-text" x=${ML + 30} y=${layout.pvYOff + 14}
            text-anchor="start" font-size="8" font-weight="bold">${title}</text>
      <text class="pv-text" x=${ML + 30} y=${layout.pvYOff + 27}
            text-anchor="start" font-size="7.5">↑ Injection réseau</text>
      ${this._bubble({
        id: 'pv',
        x: PWR_X,
        y: layout.pvYOff + GHDR / 2 + 5,
        fill: 'var(--primary-text-color)',
        powerEntity: pvEntity,
      })}
      <rect class="pv-bg-row" x=${ML} y=${pvR1} width=${GW} height=${ZH}/>
      <text class="pv-icon" x=${ML + 6} y=${pvR1 + ZH / 2 + 3.5}
            text-anchor="start" font-size="12">☀</text>
      <text class="pv-text" x=${ML + 22} y=${pvR1 + ZH / 2 + 3.5}
            text-anchor="start" font-size="8">Onduleurs PV</text>
      <rect class="pv-bg-row-alt" x=${ML} y=${pvR2} width=${GW} height=${ZH}/>
      <text class="pv-icon" x=${ML + 6} y=${pvR2 + ZH / 2 + 3.5}
            text-anchor="start" font-size="10">☀</text>
      <text class="pv-text" x=${ML + 22} y=${pvR2 + ZH / 2 + 3.5}
            text-anchor="start" font-size="8">Panneaux PV</text>
      <line class="pv-divider" x1=${ML} y1=${pvR2 + ZH} x2=${ML + GW} y2=${pvR2 + ZH}/>
    `;
  }

  // After each render, size each power-bubble background to match its text bbox
  // (replicates the original imperative updateSVGPower behaviour).
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
        /* Phase colours — light-theme defaults. Override in a HA theme YAML
           (under \`card-mod\` or theme-level vars) for custom palettes. */
        --electrical-panel-phase-l1-color: #8b4513;
        --electrical-panel-phase-l2-color: #1a202c;
        --electrical-panel-phase-l3-color: #5a6474;
      }
      /* Dark mode — driven by HA's hass.themes.darkMode (reflected to the
         host attribute) and falling back to the OS preference for users
         outside HA's control. Phase wire colours stay canonical IEC 60446
         in both themes (real cables don't lighten at night); text uses
         theme-aware variables so labels and values stay readable. */
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
      /* Theme-aware structural elements */
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
      /* PV / injection block — uses HA energy-solar accent variable so the
         block stays recognisable as solar without imposing a custom palette
         (themes can override --energy-solar-color). Texts use the standard
         primary text colour. */
      .pv-accent {
        fill: var(--energy-solar-color, #ff9800);
      }
      .pv-accent-line {
        stroke: var(--energy-solar-color, #ff9800);
        stroke-width: 2;
      }
      .pv-icon {
        fill: var(--energy-solar-color, #ff9800);
      }
      .pv-text {
        fill: var(--primary-text-color);
      }
      .pv-bg {
        fill: color-mix(
          in srgb,
          var(--energy-solar-color, #ff9800) 15%,
          var(--ha-card-background, var(--card-background-color, transparent))
        );
        stroke: var(--energy-solar-color, #ff9800);
        stroke-width: 1.8;
      }
      .pv-bg-row {
        fill: color-mix(
          in srgb,
          var(--energy-solar-color, #ff9800) 10%,
          var(--ha-card-background, var(--card-background-color, transparent))
        );
        stroke: var(--energy-solar-color, #ff9800);
        stroke-width: 0.5;
      }
      .pv-bg-row-alt {
        fill: color-mix(
          in srgb,
          var(--energy-solar-color, #ff9800) 5%,
          var(--ha-card-background, var(--card-background-color, transparent))
        );
        stroke: var(--energy-solar-color, #ff9800);
        stroke-width: 0.5;
      }
      .pv-divider {
        stroke: var(--energy-solar-color, #ff9800);
        stroke-width: 1;
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'electrical-panel-card': ElectricalPanelCard;
  }
}
