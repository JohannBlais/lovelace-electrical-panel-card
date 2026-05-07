# Data model (v0.4)

Reference for the YAML configuration consumed by `custom:electrical-panel-card`.

The schema describes _what is on the diagram_. **Everything is a group.** A group has a `type` that says whether it's a load (default) or a production source (`solar`, `wind`, `geothermal`, `hydro`). Loads and productions render with the same one-line-diagram visual; production units like PV inverters or wind turbines are expressed as **zones** of a circuit, which lets each unit carry its own sensor through the standard zone mechanics.

> v0.4 is **not** backward-compatible with earlier versions. See the [CHANGELOG](../CHANGELOG.md) for migration steps.

## Top-level config

```yaml
type: custom:electrical-panel-card
title: Electrical panel
language: en        # optional override; auto-detected from hass.locale otherwise
sensors:            # optional — main / phase / grid totals
  ...
floors:             # optional — visual style for floor pills
  ...
groups:             # required — at least one
  - ...
```

| Field      | Type                                        | Required | Description |
| ---------- | ------------------------------------------- | -------- | ----------- |
| `type`     | `'custom:electrical-panel-card'`            | yes      | Lovelace card type. |
| `title`    | string                                      | no       | Optional `<ha-card>` header. Omit for no header. |
| `language` | `'en'` \| `'fr'` (BCP 47 primary subtag)    | no       | Language override. Falls back to `hass.locale.language`, then English. |
| `sensors`  | [`MainSensors`](#main-sensors)              | no       | Top-of-card live readings. |
| `floors`   | `Record<string, FloorStyle>`                | no       | Floor pill styles. |
| `groups`   | [`Group[]`](#groups)                        | **yes**  | One entry per visual group. At least one required. |

## Main sensors

```yaml
sensors:
  total: { entity: sensor.envoy_total }
  grid:  { entity: sensor.envoy_net }
  phases:
    l1: { entity: sensor.envoy_l1 }
    l2: { entity: sensor.envoy_l2 }
    l3: { entity: sensor.envoy_l3 }
```

| Field    | Type            | Description |
| -------- | --------------- | ----------- |
| `total`  | `Sensor`        | Top-right "Total" bubble. |
| `grid`   | `Sensor`        | Top-right "Grid" bubble (positive = import). |
| `phases` | `PhaseSensors`  | Per-phase L1/L2/L3 bubbles attached to the trunk. |

PV / production is just a group — declare it under `groups[]` with `type: solar` (or `wind`, etc.).

### `Sensor`

| Field    | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `entity` | string | yes      | HA entity ID. State is parsed as a number; if `unit_of_measurement` is `kW` the value is normalised to W. |
| `label`  | string | no       | Override for the rendered label. |
| `max_w`  | number | no       | _Metadata._ Peak rated power. Not rendered. |

## Floors

```yaml
floors:
  LB: { bg: '#718096', fg: 'white' }   # lower basement
  L0: { bg: '#38a169', fg: 'white' }   # ground floor
  L1: { bg: '#3182ce', fg: 'white' }   # first floor
  L2: { bg: '#d69e2e', fg: 'white' }   # second floor
```

Map of identifier → pill style, used by `Zone.floor`. **No built-in defaults** — the right identifier scheme depends on your installation, so the card ships empty. The map above is the recommended L-convention (matches HA floor-plans: Lower Basement, Level 0, etc.); copy it into your config and adjust as needed. Zones referencing a key not in this map fall back to a neutral grey pill.

| Field | Type   | Required | Description |
| ----- | ------ | -------- | ----------- |
| `bg`  | string | yes      | Pill background colour. |
| `fg`  | string | yes      | Pill text colour. |

## Groups

A `Group` is a visual block. The `type` discriminator is informational and groups are visually identical regardless of type — same RCD-like box, same circuits, same zones underneath.

```yaml
- id: D1
  type: distribution      # default — can be omitted
  phases: [L3]
  accent: '#38a169'
  sensor: sensor.emporia_d1_power
  circuits:
    - ...
```

### `Group`

| Field      | Type                                 | Required | Description |
| ---------- | ------------------------------------ | -------- | ----------- |
| `id`       | string                               | yes      | Unique label drawn inside the box (e.g. `D1`). |
| `type`     | `'distribution'` \| `'solar'` \| `'wind'` \| `'geothermal'` \| `'hydro'` | no | Defaults to `'distribution'`. Loads vs production. Visual is identical; the discriminator is for documentation, future tooling, and theming hooks. |
| `phases`   | `('L1' \| 'L2' \| 'L3')[]`           | yes      | Phase trunks the group taps into. `[L1]` = single-phase; `[L1, L2, L3]` = three-phase; `[]` = no tap. |
| `accent`   | string (CSS colour)                  | no       | Single colour; renderer derives `color` / `stroke` / a tinted `fill` from it. When omitted, an accent is picked from a fallback palette by group index. |
| `color`    | string (CSS colour)                  | no       | Override for derived text colour. |
| `fill`     | string (CSS colour)                  | no       | Override for derived box fill. |
| `stroke`   | string (CSS colour)                  | no       | Override for derived box stroke. |
| `sensor`   | string (entity ID)                   | no       | Group-level live power. Renders a bubble next to the box. |
| `switch`   | string (entity ID)                   | no       | Group-level toggle. Adds an inline switch to the bubble. |
| `circuits` | [`Circuit[]`](#circuits)             | no       | Branches of this group. Optional — a group may render as just a box + tap line. |
| `label`    | string                               | no       | _Metadata._ Reserved for future tooltips. |
| `spec`     | string                               | no       | _Metadata._ Free-form spec text. |

### Group types

| `type`         | Use for                                           |
| -------------- | ------------------------------------------------- |
| `distribution` | Default. Sub-distribution boards, RCDs, breaker groups, anything that distributes power to loads. |
| `solar`        | Photovoltaic production. Inverters become zones (each with its own `sensor`). |
| `wind`         | Wind production. Each turbine = one zone. |
| `geothermal`   | Geothermal production. |
| `hydro`        | Hydroelectric production. |

The renderer is identical for all types; the discriminator is informational. Pick a meaningful `accent` to differentiate visually (e.g. `var(--energy-solar-color, #d97706)` for solar).

### Colour resolution

```ts
color  = group.color  ?? group.accent ?? FALLBACK_PALETTE[idx % palette.length]
stroke = group.stroke ?? group.accent ?? <same fallback>
fill   = group.fill   ?? color-mix(in srgb, accent 18%, var(--ha-card-background))
```

The `color-mix()` fallback for `fill` adapts to the active theme. `accent` itself can be a CSS variable so the colour follows the theme:

```yaml
accent: 'var(--energy-solar-color, #ff9800)'
```

Fallback palette (cycled by group index when no accent is set): `#3182ce`, `#38a169`, `#d69e2e`, `#e53e3e`, `#805ad5`, `#319795`, `#dd6b20`, `#5a67d8`.

### Phases array

| Value           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `[L1]`          | Single-phase, taps L1.                   |
| `[L2]` / `[L3]` | Single-phase on the indicated phase.     |
| `[L1, L2, L3]`  | Three-phase. Renderer draws three taps. |
| `[L1, L2]`      | Two-phase. Two taps. (Rare in EU but supported.) |
| `[]`            | No phase tap. Group floats. |

## Circuits

```yaml
circuits:
  - id: A
    type: socket
    sensor: sensor.washing_machine_power
    switch: switch.washing_machine
    zones:
      - { floor: L1, room: laundry }
```

### `Circuit`

| Field    | Type                                  | Required | Description |
| -------- | ------------------------------------- | -------- | ----------- |
| `id`     | string                                | yes      | Drawn inside the breaker box (e.g. `A`). Unique within a group. |
| `type`   | `'socket'` \| `'light'` \| `'power'`  | yes      | Picks the icon shown next to each zone: 🔌 / 💡 / ⚙️ . |
| `sensor` | string (entity ID)                    | no       | Per-circuit power. Bubble appears next to the breaker box. |
| `switch` | string (entity ID)                    | no       | Adds an inline toggle on the circuit's bubble. |
| `zones`  | [`Zone[]`](#zones)                    | no       | Branches off the circuit. Empty/missing = breaker box drawn alone, no zones. |
| `amp` / `poles` / `mm2` / `cond` / `pts` / `n_pts` | various | no | _Metadata._ Reserved for future tooltips. |

## Zones

```yaml
zones:
  - { floor: L0, room: kitchen }                     # informational only
  - floor: L0                                        # with live monitoring
    room: dishwasher
    sensor: sensor.dishwasher_power
    switch: switch.dishwasher
    critical: true                                   # confirm before toggling
```

### `Zone`

| Field      | Type             | Description |
| ---------- | ---------------- | ----------- |
| `floor`    | string           | Key into `floors`. Renders as a coloured pill. |
| `room`     | string           | Free-text label drawn next to the pill. |
| `sensor`   | string (entity)  | Per-zone power. Bubble to the right. |
| `switch`   | string (entity)  | Inline toggle on the bubble. |
| `critical` | boolean          | When `true` and `switch` is set, toggling shows a confirmation dialog using `room` as the load name. |

## Modelling production sources

Each production unit (PV inverter, wind turbine, geothermal pump, hydro generator) is a **zone** under a circuit of a production-typed group. This reuses the existing zone mechanics — sensor, switch, floor, room, critical — without any production-specific schema.

### PV example

```yaml
- id: PV
  type: solar
  phases: [L1, L2, L3]
  accent: 'var(--energy-solar-color, #d97706)'
  sensor: sensor.envoy_total_production    # group-level total
  circuits:
    - id: INV
      type: power
      zones:
        - { room: "IQ7+ #1",  sensor: sensor.envoy_microinverter_1_power }
        - { room: "IQ7+ #2",  sensor: sensor.envoy_microinverter_2_power }
        - { room: "IQ7+ #3",  sensor: sensor.envoy_microinverter_3_power }
        # ... one zone per microinverter
```

Each microinverter renders as a zone row with its `room` label and a power bubble fed by its individual sensor. The group-level `sensor` (envoy total) shows in the box-side bubble.

### Other production types

```yaml
# Wind
- id: WIND
  type: wind
  phases: [L1, L2, L3]
  accent: '#319795'
  circuits:
    - id: TURB
      type: power
      zones:
        - { room: "Turbine #1", sensor: sensor.turbine_1_power }
        - { room: "Turbine #2", sensor: sensor.turbine_2_power }

# Hydro
- id: HYD
  type: hydro
  phases: [L1, L2, L3]
  accent: '#3182ce'
  sensor: sensor.hydro_total
```

## Theming

CSS custom properties exposed by the card:

| Variable                              | Default (light)                | Used by |
| ------------------------------------- | ------------------------------ | ------- |
| `--electrical-panel-phase-l1-color`   | `#8B4513`                      | L1 trunk + tap dots |
| `--electrical-panel-phase-l2-color`   | `#1A202C`                      | L2 trunk + tap dots |
| `--electrical-panel-phase-l3-color`   | `#5A6474`                      | L3 trunk + tap dots |

Standard HA variables drive the chrome:

- `--primary-text-color` → labels, all bubble values
- `--secondary-text-color` → "Total" / "Grid" labels, room names
- `--ha-card-background`, `--card-background-color` → bubble fills
- `--divider-color` → bubble borders, connector lines
- `--ha-font-family-body` → SVG font

Phase **wire** colours follow IEC 60446 in both themes. Phase **labels** and bubble values use `--primary-text-color` so they stay readable. In dark mode (detected via `hass.themes.darkMode`), bubble values for `data-id^="g-"` and `data-id^="c-"` get a `filter: brightness(1.55) saturate(0.85)` so user-configured dark accent colours stay legible.

## Internationalisation

Built-in dictionaries: `en` (default), `fr`. Detection chain:

1. `config.language` (explicit override)
2. `hass.locale.language` (auto)
3. `hass.language` (older HA)
4. `'en'`

Translated strings:

- `card.total`, `card.grid` — fallback labels for the top-right bubbles.
- `confirm.toggle` — confirmation dialog when toggling a `critical` zone.

## Special concepts

### Three-phase circuits

Set `phases: [L1, L2, L3]` on a group. Three tap dots render on the trunks; the horizontal feed line starts at the leftmost phase X coordinate.

### Critical loads

`critical: true` on a zone triggers a `confirm()` dialog before toggling. The dialog message is localised and uses `zone.room` as the load name.

### Smart-plug toggles

Any element (group / circuit / zone) with both `sensor` and `switch` shows a small toggle inside its power bubble. Clicking calls `switch.toggle` on the entity.

## Live-update mechanism (internal)

Bubble backgrounds are sized post-render in `updated()` via `getBBox()` on each `text.pwr-value`. Each element carries a `data-id` attribute used to find its companion `<rect data-bg-for="…">` background and `<line data-ln-for="…">` connector. Group / circuit / zone IDs must therefore be unique within a render — duplicate IDs would cause incorrect bbox attribution.

## Minimal valid config

```yaml
type: custom:electrical-panel-card
groups:
  - id: D1
    phases: [L1]
    circuits:
      - id: A
        type: socket
        zones:
          - { floor: L0, room: example }
```

## Validation

`setConfig` enforces:

- `groups` is a non-empty array.
- Each group has an `id` and a `phases` array.

Anything else is accepted as-is. Unknown fields are ignored without warnings.
