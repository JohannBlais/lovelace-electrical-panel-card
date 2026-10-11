import { LitElement, html, css, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  fireEvent,
  type HomeAssistant,
  type LovelaceCardEditor,
} from 'custom-card-helpers';

import { EDITOR_TAG } from './const.js';
import { SUPPORTED_LANGUAGES } from './translations/index.js';
import type { ElectricalPanelCardConfig } from './types.js';

// ha-form schema for the simple top-level scalar fields. `groups`, `sensors`
// and `floors` are too nested for a comfortable form UI — we expose them
// through a YAML editor instead.
const TOP_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  {
    name: 'language',
    selector: {
      select: {
        options: SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: code })),
        mode: 'dropdown',
      },
    },
  },
  {
    name: 'max_width',
    selector: { number: { min: 300, step: 10, mode: 'box', unit_of_measurement: 'px' } },
  },
  {
    name: 'idle_below_w',
    selector: { number: { min: 0, step: 1, mode: 'box', unit_of_measurement: 'W' } },
  },
];

// Where title-casing the key would read badly: the unit is already beside the
// field, so "Idle below w" says it twice and the second time wrongly.
const LABELS: Record<string, string> = { idle_below_w: 'Idle below' };

@customElement(EDITOR_TAG)
export class ElectricalPanelCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: ElectricalPanelCardConfig;

  public setConfig(config: ElectricalPanelCardConfig): void {
    this._config = config;
  }

  protected override render(): TemplateResult {
    if (!this._config) return html``;
    const topData = {
      title: this._config.title ?? '',
      language: this._config.language ?? '',
      max_width: this._config.max_width,
      idle_below_w: this._config.idle_below_w,
    };
    // Pull the nested structures into a YAML payload. We round-trip the whole
    // thing through ha-yaml-editor so users keep full schema control without
    // us having to invent a UI for groups / circuits / zones.
    const yamlData: Record<string, unknown> = {};
    if (this._config.sensors) yamlData.sensors = this._config.sensors;
    if (this._config.floors) yamlData.floors = this._config.floors;
    if (this._config.groups) yamlData.groups = this._config.groups;

    return html`
      <div class="editor">
        <ha-form
          .hass=${this.hass}
          .data=${topData}
          .schema=${TOP_SCHEMA}
          .computeLabel=${this._computeLabel}
          @value-changed=${this._topChanged}
        ></ha-form>
        <p class="hint">
          The sections below (sensors, floors, groups) keep YAML editing —
          the schema is too nested for a friendly form UI. See the
          <a
            href="https://github.com/JohannBlais/lovelace-electrical-panel-card/blob/main/docs/data-model.md"
            target="_blank"
            rel="noopener"
            >data-model reference</a
          >.
        </p>
        <ha-yaml-editor
          .hass=${this.hass}
          .defaultValue=${yamlData}
          @value-changed=${this._yamlChanged}
        ></ha-yaml-editor>
      </div>
    `;
  }

  // ha-form's computeLabel sees the schema entry; we just title-case the name
  // (`max_width` → "Max width").
  private readonly _computeLabel = (schema: { name: string }): string => {
    if (LABELS[schema.name]) return LABELS[schema.name];
    const words = schema.name.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  };

  private _topChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    const v = ev.detail.value as {
      title?: string;
      language?: string;
      max_width?: number;
      idle_below_w?: number;
    };
    const next: ElectricalPanelCardConfig = {
      ...this._config,
      title: v.title || undefined,
      language: v.language || undefined,
      max_width: v.max_width || undefined,
      // Not `||`: 0 is a real threshold, meaning no reading is ever idle.
      idle_below_w: typeof v.idle_below_w === 'number' ? v.idle_below_w : undefined,
    };
    this._fire(next);
  }

  private _yamlChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;
    if (ev.detail.isValid === false) return;
    const v = (ev.detail.value as Partial<ElectricalPanelCardConfig>) ?? {};
    const next = {
      type: this._config.type,
      ...(this._config.title !== undefined && { title: this._config.title }),
      ...(this._config.language !== undefined && { language: this._config.language }),
      ...(this._config.max_width !== undefined && { max_width: this._config.max_width }),
      ...(this._config.idle_below_w !== undefined && { idle_below_w: this._config.idle_below_w }),
      ...v,
    } as ElectricalPanelCardConfig;
    this._fire(next);
  }

  private _fire(config: ElectricalPanelCardConfig): void {
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  public static override get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
      }
      .editor {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      ha-form,
      ha-yaml-editor {
        display: block;
      }
      .hint {
        margin: 0;
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      .hint a {
        color: var(--primary-color);
      }
    `;
  }
}

// Avoid "declared but never read" when the file is imported only for its
// custom-element registration side effect.
void nothing;

declare global {
  interface HTMLElementTagNameMap {
    'electrical-panel-card-editor': ElectricalPanelCardEditor;
  }
}
