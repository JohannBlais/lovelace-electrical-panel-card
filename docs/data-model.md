# Data model

Reference for the YAML configuration consumed by `custom:electrical-panel-card`.

> Status: provisional — the schema is still maturing. Fields marked _metadata_ are accepted but not yet used by the renderer; they exist so users can describe their panel completely and so future versions can surface them in tooltips / detail views without a breaking change.

## Top-level config

```yaml
type: custom:electrical-panel-card
title: Electrical panel
language: en        # optional override; auto-detected from hass.locale otherwise
sensors:            # optional — main / phase / PV / grid totals
  ...
floors:             # optional — visual style for floor pills
  ...
groups:             # required — at least one
  - ...
pv:                 # reserved (currently unused, see below)
  ...
```

| Field      | Type                                        | Required | Description |
| ---------- | ------------------------------------------- | -------- | ----------- |
| `type`     | `'custom:electrical-panel-card'`            | yes      | Lovelace card type. |
| `title`    | string                                      | no       | Optional `<ha-card>` header. Omit for no header. |
| `language` | `'en'` \| `'fr'` (BCP 47 primary subtag)    | no       | Language override. Falls back to `hass.locale.language`, then English. |
| `sensors`  | `Record<string, MainSensor>`                | no       | See [Main sensors](#main-sensors). |
| `floors`   | `Record<string, FloorStyle>`                | no       | See [Floors](#floors). |
| `groups`   | [`Group[]`](#groups)                        | **yes**  | One entry per RCD / breaker group. At least one required. |
| `pv`       | object                                      | no       | _Reserved._ Currently ignored by the renderer (the PV block is driven by `sensors.pv.label` and the dictionary defaults). May be wired up in a future release. |

## Main sensors

`sensors` is a map keyed by **well-known names** the renderer recognises. Unknown keys are silently ignored.

| Key        | Position in diagram                              | Bubble colour |
| ---------- | ------------------------------------------------ | ------------- |
| `total`    | Top-right — overall consumption                  | Red `#c53030` |
| `grid`     | Top-right — net grid (positive = import)         | Theme secondary |
| `pv`       | Inside the PV block, right side                  | Theme primary text |
| `phase_l1` | Top, attached to the L1 trunk                    | Theme primary text |
| `phase_l2` | Top, attached to the L2 trunk                    | Theme primary text |
| `phase_l3` | Top, attached to the L3 trunk                    | Theme primary text |

```yaml
sensors:
  total: { entity: sensor.envoy_current_power_consumption }
  grid:  { entity: sensor.envoy_current_net_power_consumption }
  pv:
    entity: sensor.envoy_current_power_production
    label: ☀ PV         # used as the PV block title
    max_w: 8075         # metadata, not rendered (yet)
  phase_l1: { entity: sensor.envoy_current_power_consumption_l1 }
  phase_l2: { entity: sensor.envoy_current_power_consumption_l2 }
  phase_l3: { entity: sensor.envoy_current_power_consumption_l3 }
```

### `MainSensor`

| Field    | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| `entity` | string | yes      | HA entity ID. The card reads `state` and applies kW → W normalisation if `unit_of_measurement` is `kW`. |
| `label`  | string | no       | Override for the rendered text. For `total` / `grid` it's the left-side label. For `pv` it's the PV block title. |
| `max_w`  | number | no       | _Metadata._ Peak rated power. Not rendered. |

## Floors

Floors are a small map of identifier → pill style, used by `Zone.floor`. Built-in defaults cover `E-1`, `E0`, `E1`, `E2` (basement → second floor). Override or add entries with the same shape.

```yaml
floors:
  E-1: { bg: '#718096', fg: 'white' }   # Basement
  E0:  { bg: '#38a169', fg: 'white' }   # Ground floor
  E1:  { bg: '#3182ce', fg: 'white' }   # First floor
  E2:  { bg: '#d69e2e', fg: 'white' }   # Second floor
```

### `FloorStyle`

| Field | Type   | Required | Description                                           |
| ----- | ------ | -------- | ----------------------------------------------------- |
| `bg`  | string | yes      | CSS colour for the pill background.                   |
| `fg`  | string | yes      | CSS colour for the pill text (the `floor` identifier).|

## Groups

Each `Group` represents one RCD (residual-current device) and the breakers under it. Visually, a group is a left-side phase tap → RCD box → vertical bus → branch breakers.

```yaml
groups:
  - id: D1
    phase: L3
    color: '#276749'       # text colour on the box
    fill:  '#c6f6d5'       # box fill
    stroke: '#38a169'      # box stroke + sub-bus + zone tap lines
    sensor: sensor.emporia_d1_power
    circuits:
      - ...
```

### `Group`

| Field      | Type                              | Required | Rendered? | Description |
| ---------- | --------------------------------- | -------- | --------- | ----------- |
| `id`       | string                            | yes      | yes       | Short label drawn inside the RCD box (e.g. `D1`). Must be unique across groups. |
| `phase`    | `'L1'` \| `'L2'` \| `'L3'` \| `'3P'` | yes      | yes       | Which trunk the RCD taps into. `3P` taps all three (used for three-phase loads). |
| `color`    | string                            | yes      | yes       | Text colour for the `id` label and the group's power bubble. |
| `fill`     | string                            | yes      | yes       | RCD box fill. |
| `stroke`   | string                            | yes      | yes       | RCD box stroke, the vertical sub-bus, and per-circuit / per-zone tap lines. |
| `sensor`   | string (entity ID)                | no       | yes       | Live power for the whole group. Renders a bubble next to the RCD box. |
| `switch`   | string (entity ID)                | no       | yes       | If set, the group's bubble gets an inline toggle. |
| `circuits` | [`Circuit[]`](#circuits)          | yes      | yes       | At least one. Order is visual top-to-bottom. |
| `label`    | string                            | no       | _no_      | _Metadata._ Reserved for tooltips. |
| `spec`     | string                            | no       | _no_      | _Metadata._ Free-form RCD spec (e.g. `30mA 40A 2P Cl.A`). |

> **Tip on colours.** Group `color` is intentionally dark-saturated for light themes. In dark mode the card automatically lightens it via a CSS filter, so you don't need two configs — pick a colour that reads on a light card and trust the dark adaptation.

## Circuits

A `Circuit` is one breaker (with one or more zones it serves).

```yaml
circuits:
  - id: A
    type: socket
    sensor: sensor.washing_machine_power
    switch: switch.washing_machine
    zones:
      - floor: E1
        room: laundry
        sensor: sensor.washing_machine_power
        switch: switch.washing_machine
```

### `Circuit`

| Field    | Type                                  | Required | Rendered? | Description |
| -------- | ------------------------------------- | -------- | --------- | ----------- |
| `id`     | string                                | yes      | yes       | Drawn inside the breaker box (e.g. `A`). Unique within a group; ideally globally unique to avoid `data-id` collisions used by the live-update logic. |
| `type`   | `'socket'` \| `'light'` \| `'power'`  | yes      | yes       | Picks the icon: 🔌 / 💡 / ⚙️ . |
| `sensor` | string (entity ID)                    | no       | yes       | Per-circuit power. Bubble appears to the right of the breaker box. |
| `switch` | string (entity ID)                    | no       | yes       | Adds an inline toggle on the circuit's bubble. |
| `zones`  | [`Zone[]`](#zones)                    | no       | yes       | Branches off the circuit. If omitted or empty, a single nameless zone is drawn. |
| `amp`    | number                                | no       | _no_      | _Metadata._ Breaker amperage. |
| `poles`  | `2` \| `4`                            | no       | _no_      | _Metadata._ Single- or three-phase breaker. |
| `mm2`    | string                                | no       | _no_      | _Metadata._ Wire cross-section. |
| `cond`   | number                                | no       | _no_      | _Metadata._ Number of conductors. |
| `pts`    | string                                | no       | _no_      | _Metadata._ Free text (e.g. `≥6 pts`). |
| `n_pts`  | number                                | no       | _no_      | _Metadata._ Numeric outlet count. |

## Zones

A `Zone` represents a physical destination served by a circuit (a room, a dedicated appliance, etc.).

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

| Field      | Type             | Required | Description |
| ---------- | ---------------- | -------- | ----------- |
| `floor`    | string           | no       | Key into `floors` (or one of the built-in defaults). Renders as a coloured pill. |
| `room`     | string           | no       | Free-text label drawn next to the floor pill. |
| `sensor`   | string (entity)  | no       | Per-zone power. Bubble to the right. |
| `switch`   | string (entity)  | no       | Inline toggle on the zone bubble. |
| `critical` | boolean          | no       | When `true` and `switch` is set, toggling shows a confirmation dialog using the zone's `room` as the name. Use for fridges, freezers, sump pumps, etc. |

## Theming

The card exposes CSS custom properties so themes can override visual choices. Set them in your HA `themes.yaml`:

| Variable                              | Default (light)                | Default (dark)            | Used by |
| ------------------------------------- | ------------------------------ | ------------------------- | ------- |
| `--electrical-panel-phase-l1-color`   | `#8B4513`                      | _same_ (cable colour)     | L1 trunk + tap dots |
| `--electrical-panel-phase-l2-color`   | `#1A202C`                      | _same_                    | L2 trunk + tap dots |
| `--electrical-panel-phase-l3-color`   | `#5A6474`                      | _same_                    | L3 trunk + tap dots |
| `--energy-solar-color`                | `#ff9800` (HA standard)        | theme-defined             | PV block accents and tinted bg |

Standard HA variables also drive the chrome:

- `--primary-text-color` → labels, all bubble values
- `--secondary-text-color` → "Total" / "Grid" labels, room names
- `--ha-card-background`, `--card-background-color` → bubble fills
- `--divider-color` → bubble borders, connector lines
- `--ha-font-family-body` → SVG font

Phase **wire** colours follow IEC 60446 in both themes — they represent physical cables, not UI text. Phase **labels** and bubble values use `--primary-text-color` so they stay readable.

## Internationalisation

Built-in dictionaries: `en` (default), `fr`. Detection chain:

1. `config.language` (explicit override)
2. `hass.locale.language` (auto)
3. `hass.language` (older HA)
4. `'en'`

To add a language, drop a `de.ts` (or whatever) next to `src/translations/en.ts` exporting a `Translations` object, then register it in `DICTS` in `src/translations/index.ts`.

## Special concepts

### Three-phase circuits (`phase: '3P'`)

A group with `phase: '3P'` taps L1 + L2 + L3 simultaneously. Used for heat pumps, induction cooktops, EV chargers, etc. Visually, three dots appear on the trunks instead of one.

```yaml
- id: D5
  phase: '3P'
  color: '#553c9a'
  fill:  '#e9d8fd'
  stroke: '#805ad5'
  circuits:
    - id: V
      type: power
      sensor: sensor.heat_pump_power
      zones:
        - { floor: E0, room: heat pump }
```

### Critical loads

`critical: true` on a zone triggers a `confirm()` dialog before toggling. The dialog message is localised and uses `zone.room` as the load name.

```yaml
- floor: E-1
  room: freezer
  sensor: sensor.freezer_power
  switch: switch.freezer
  critical: true
```

### Smart-plug toggles

Any element (group / circuit / zone) with both `sensor` and `switch` shows a small toggle inside its power bubble. Clicking calls `switch.toggle` on the entity. State is read from `hass.states[switch].state` (`'on'` → green knob right; `'off'` → grey knob left).

## Live-update mechanism (internal)

Bubble backgrounds are sized post-render in `updated()` via `getBBox()` on each `text.pwr-value` element. Each element carries a `data-id` attribute used to find its companion `<rect data-bg-for="…">` background and `<line data-ln-for="…">` connector. Circuit / group / zone IDs must therefore be unique within a render — duplicate IDs would cause incorrect bbox attribution.

## Minimal valid config

```yaml
type: custom:electrical-panel-card
groups:
  - id: D1
    phase: L1
    color: '#2c5282'
    fill:  '#bee3f8'
    stroke: '#3182ce'
    circuits:
      - id: A
        type: socket
        zones:
          - { floor: E0, room: example }
```
