import { LitElement, html, css, type CSSResultGroup, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HomeAssistant, LovelaceCard, LovelaceCardConfig } from 'custom-card-helpers';

import { CARD_TAG, CARD_VERSION } from './const.js';
import type { ElectricalPanelCardConfig } from './types.js';

/* eslint-disable no-console */
console.info(
  `%c ELECTRICAL-PANEL-CARD %c v${CARD_VERSION} `,
  'color: white; background: #2c5282; font-weight: 700;',
  'color: #2c5282; background: white; font-weight: 700;',
);
/* eslint-enable no-console */

// Register card so the Lovelace card picker can list it.
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

@customElement(CARD_TAG)
export class ElectricalPanelCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: ElectricalPanelCardConfig;

  public setConfig(config: LovelaceCardConfig): void {
    if (!config) {
      throw new Error('Invalid configuration');
    }
    const cfg = config as ElectricalPanelCardConfig;
    if (!Array.isArray(cfg.groups) || cfg.groups.length === 0) {
      throw new Error('`groups` is required and must contain at least one group');
    }
    this._config = cfg;
  }

  public getCardSize(): number {
    if (!this._config) return 1;
    const rows = this._config.groups.reduce((acc, g) => {
      const zones = g.circuits.reduce(
        (n, c) => n + Math.max(1, c.zones?.length ?? 0),
        0,
      );
      return acc + 1 + zones;
    }, 0);
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

  protected override render(): TemplateResult {
    if (!this._config || !this.hass) {
      return html``;
    }
    return html`
      <ha-card .header=${this._config.title ?? ''}>
        <div class="placeholder">
          Electrical Panel Card v${CARD_VERSION} —
          ${this._config.groups.length} group(s) configured.
          <br /><small>SVG renderer coming in Phase 2.</small>
        </div>
      </ha-card>
    `;
  }

  public static override get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
      }
      ha-card {
        padding: 16px;
      }
      .placeholder {
        font-size: 14px;
        color: var(--secondary-text-color);
        text-align: center;
        padding: 24px 8px;
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'electrical-panel-card': ElectricalPanelCard;
  }
}
