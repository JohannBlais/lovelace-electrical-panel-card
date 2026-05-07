# Data model (v0.2)

Reference for the YAML configuration consumed by `custom:electrical-panel-card`.

The schema describes _what is on the diagram_ — groups, circuits, zones — not the electrical-installation semantics. A "group" is just a visual block on the panel, whether it represents an RCD, a sub-distribution board, or a grid-coupling protection. Anything installation-specific (breaker amperage, conductor cross-section, IEC phase mapping) is optional metadata.

> v0.2 is **not** backward-compatible with v0.1. See [CHANGELOG](../CHANGELOG.md) for migration steps.

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
| `sensors`  | [`MainSensors`](#main-sensors)              | no       | Top-of-card live readings (total, grid, per-phase totals). |
| `floors`   | `Record<string, FloorStyle>`                | no       | Floor pill styles, see [Floors](#floors). |
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

PV / production is **not** a top-level sensor anymore — declare it as a `grid_coupling` group (see below).

### `Sensor`

| Field    | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `entity` | string | yes      | HA entity ID. State is parsed as a number; if `unit_of_measurement` is `kW` the value is normalised to W. |
| `label`  | string | no       | Override for the rendered label (where applicable). |
| `max_w`  | number | no       | _Metadata._ Peak rated power. Not rendered. |

## Floors

```yaml
floors:
  E-1: { bg: '#718096', fg: 'white' }
  E0:  { bg: '#38a169', fg: 'white' }
  E1:  { bg: '#3182ce', fg: 'white' }
  E2:  { bg: '#d69e2e', fg: 'white' }
```

`floors` is a map of identifier → pill style, used by `Zone.floor`. Built-in defaults cover `E-1`, `E0`, `E1`, `E2` — override or add entries with the same shape.

### `FloorStyle`

| Field | Type   | Required | Description |
| ----- | ------ | -------- | ----------- |
| `bg`  | string | yes      | Pill background. |
| `fg`  | string | yes      | Pill text colour. |

## Groups

A `Group` is a visual block on the diagram. The `kind` discriminator picks how it is drawn.

```yaml
- id: D1
  phases: [L3]            # one tap on L3
  accent: '#38a169'       # single colour; renderer derives fill / stroke / text
  sensor: sensor.emporia_d1_power
  circuits:
    - ...
```

### `Group`

| Field      | Type                                 | Required | Description |
| ---------- | ------------------------------------ | -------- | ----------- |
| `id`       | string                               | yes      | Unique label drawn inside the box (e.g. `D1`). Must be unique across groups. |
| `kind`     | `'distribution'` \| `'grid_coupling'` | no      | Visual style. Defaults to `'distribution'`. |
| `phases`   | `('L1' \| 'L2' \| 'L3')[]`           | yes      | Phase trunks the group taps into. `[L1]` = single-phase. `[L1, L2, L3]` = three-phase. `[]` = no tap. |
| `accent`   | string (CSS colour)                  | no       | Single colour; renderer derives `color` / `stroke` / a tinted `fill` from it. When omitted, an accent is picked from a fallback palette by group index. |
| `color`    | string (CSS colour)                  | no       | Override for derived text colour. |
| `fill`     | string (CSS colour)                  | no       | Override for derived box fill. |
| `stroke`   | string (CSS colour)                  | no       | Override for derived box stroke. |
| `sensor`   | string (entity ID)                   | no       | Group-level live power. Renders a bubble next to the box. |
| `switch`   | string (entity ID)                   | no       | Group-level toggle. Adds an inline switch to the bubble. |
| `circuits` | [`Circuit[]`](#circuits)             | yes for `distribution` / ignored for `grid_coupling` | Circuits under this group. |
| `label`    | string                               | no       | For `grid_coupling`: the header title (falls back to a localised default). For `distribution`: metadata. |
| `subtitle` | string                               | no       | `grid_coupling` only — second line under the title. |
| `rows`     | [`DetailRow[]`](#detail-rows-grid_coupling-only) | no | `grid_coupling` only — additional info rows under the header. |
| `spec`     | string                               | no       | _Metadata._ Free-form spec text (e.g. `'30mA 40A 2P Cl.A'`). |

### Colour resolution

Specify `accent` and let the renderer derive the rest, or specify `color` / `fill` / `stroke` for exact control.

```ts
// Defaults applied per group
color  = group.color  ?? group.accent ?? FALLBACK_PALETTE[idx % palette.length]
stroke = group.stroke ?? group.accent ?? <same fallback>
fill   = group.fill   ?? color-mix(in srgb, accent 18%, var(--ha-card-background))
```

The `color-mix()` fallback for `fill` adapts to the active theme — light themes get a lightly-tinted box, dark themes get an accent-tinted darker box.

You can also set `accent` to a CSS variable so the colour follows the theme:

```yaml
accent: 'var(--energy-solar-color, #ff9800)'
```

The HA fallback palette (cycled by group index when no accent is set) is:
`#3182ce`, `#38a169`, `#d69e2e`, `#e53e3e`, `#805ad5`, `#319795`, `#dd6b20`, `#5a67d8`.

### Phases array

| Value           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `[L1]`          | Single-phase, taps L1.                   |
| `[L2]` / `[L3]` | Single-phase on the indicated phase.     |
| `[L1, L2, L3]`  | Three-phase. Renderer draws three taps. |
| `[L1, L2]`      | Two-phase. Two taps. (Rare in EU but supported.) |
| `[]`            | No phase tap. Group floats — useful for grouping logical things visually without a wire.|

## Circuits

```yaml
circuits:
  - id: A
    type: socket
    sensor: sensor.washing_machine_power
    switch: switch.washing_machine
    zones:
      - { floor: E1, room: laundry }
```

### `Circuit`

| Field    | Type                                  | Required | Description |
| -------- | ------------------------------------- | -------- | ----------- |
| `id`     | string                                | yes      | Drawn inside the breaker box (e.g. `A`). Unique within a group; ideally globally unique to avoid `data-id` collisions in the live-update DOM logic. |
| `type`   | `'socket'` \| `'light'` \| `'power'`  | yes      | Picks the icon: 🔌 / 💡 / ⚙️ . |
| `sensor` | string (entity ID)                    | no       | Per-circuit power. Bubble appears to the right of the breaker box. |
| `switch` | string (entity ID)                    | no       | Adds an inline toggle on the circuit's bubble. |
| `zones`  | [`Zone[]`](#zones)                    | no       | Branches off the circuit. **Empty/missing** = breaker box drawn alone, no zones. To force one empty zone, pass `zones: [{}]`. |
| `amp`    | number                                | no       | _Metadata._ |
| `poles`  | `2` \| `4`                            | no       | _Metadata._ |
| `mm2`    | string                                | no       | _Metadata._ Wire cross-section. |
| `cond`   | number                                | no       | _Metadata._ |
| `pts`    | string                                | no       | _Metadata._ Free text (e.g. `'≥6 pts'`). |
| `n_pts`  | number                                | no       | _Metadata._ |

## Zones

```yaml
zones:
  - { floor: E0, room: kitchen }                     # informational only
  - floor: E0                                        # with live monitoring
    room: dishwasher
    sensor: sensor.dishwasher_power
    switch: switch.dishwasher
    critical: true                                   # confirm before toggling
```

### `Zone`

| Field      | Type             | Description |
| ---------- | ---------------- | ----------- |
| `floor`    | string           | Key into `floors` (or one of the built-in defaults). Renders as a coloured pill. |
| `room`     | string           | Free-text label drawn next to the pill. |
| `sensor`   | string (entity)  | Per-zone power. Bubble to the right. |
| `switch`   | string (entity)  | Inline toggle on the bubble. |
| `critical` | boolean          | When `true` and `switch` is set, toggling shows a confirmation dialog using `room` as the load name. |

## Detail rows (`grid_coupling` only)

```yaml
rows:
  - { icon: ☀, label: PV inverters }
  - { icon: ☀, label: PV panels }
```

### `DetailRow`

| Field   | Type   | Description                                            |
| ------- | ------ | ------------------------------------------------------ |
| `icon`  | string | Optional emoji / character drawn at the row's left.   |
| `label` | string | Row text.                                              |

Rows alternate background tints for visual rhythm.

## Theming

The card exposes CSS custom properties so themes can override visual choices. Set them in your HA `themes.yaml`:

| Variable                              | Default (light)                | Used by |
| ------------------------------------- | ------------------------------ | ------- |
| `--electrical-panel-phase-l1-color`   | `#8B4513`                      | L1 trunk + tap dots |
| `--electrical-panel-phase-l2-color`   | `#1A202C`                      | L2 trunk + tap dots |
| `--electrical-panel-phase-l3-color`   | `#5A6474`                      | L3 trunk + tap dots |
| `--energy-solar-color`                | `#ff9800` (HA standard)        | Use as `accent` on a `grid_coupling` group for solar. |

Standard HA variables drive the chrome:

- `--primary-text-color` → labels, all bubble values
- `--secondary-text-color` → "Total" / "Grid" labels, room names
- `--ha-card-background`, `--card-background-color` → bubble fills, accent-tinted box fills
- `--divider-color` → bubble borders, connector lines
- `--ha-font-family-body` → SVG font

Phase **wire** colours follow IEC 60446 in both themes — they represent physical cables. Phase **labels** and bubble values use `--primary-text-color` so they stay readable.

In dark mode (detected via `hass.themes.darkMode`), bubble values for `data-id^="g-"` and `data-id^="c-"` get a `filter: brightness(1.55) saturate(0.85)` so user-configured dark accent colours stay legible.

## Internationalisation

Built-in dictionaries: `en` (default), `fr`. Detection chain:

1. `config.language` (explicit override)
2. `hass.locale.language` (auto)
3. `hass.language` (older HA)
4. `'en'`

Translated strings:

- `card.total`, `card.grid` — fallback labels for `sensors.total.label` / `sensors.grid.label`
- `grid_coupling.title_default` — fallback for a `grid_coupling` group's `label`
- `confirm.toggle` — confirmation dialog when toggling a `critical` zone

To add a language, drop `de.ts` (etc.) next to `src/translations/en.ts` exporting a `Translations` object, then register it in `DICTS` in `src/translations/index.ts`.

## Special concepts

### Three-phase circuits

Set `phases: [L1, L2, L3]` on a group. Three tap dots render on the trunks; the horizontal feed line starts at the leftmost phase X coordinate. Used for heat pumps, induction cooktops, EV chargers, etc.

### `grid_coupling` group

A wide horizontal block typically used to represent a PV / utility decoupling protection or a bidirectional grid meter. Ignores `circuits`; carries `label`, `subtitle`, and decorative `rows`. Renders with the group's `accent` colour throughout (taps, arrow indicator, header tint, row tints, divider).

```yaml
- id: PV
  kind: grid_coupling
  phases: [L1, L2, L3]
  accent: 'var(--energy-solar-color, #d97706)'
  sensor: sensor.envoy_production
  label: Découplage 4P — Synergrid C10/11
  subtitle: ↑ Grid injection
  rows:
    - { icon: ☀, label: PV inverters }
    - { icon: ☀, label: PV panels }
```

### Critical loads

`critical: true` on a zone triggers a `confirm()` dialog before toggling. The dialog message is localised and uses `zone.room` as the load name.

### Smart-plug toggles

Any element (group / circuit / zone) with both `sensor` and `switch` shows a small toggle inside its power bubble. Clicking calls `switch.toggle` on the entity. State is read from `hass.states[switch].state` (`'on'` → green knob right; `'off'` → grey knob left).

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
          - { floor: E0, room: example }
```

## Validation

`setConfig` enforces:

- `groups` is a non-empty array.
- Each group has an `id` and a `phases` array.
- For `kind: 'distribution'` (or default), `circuits` is non-empty.

Anything else is accepted as-is. Unknown fields are ignored without warnings.
