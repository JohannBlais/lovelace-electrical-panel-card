# Data model (v0.6)

Reference for the YAML configuration consumed by `custom:electrical-panel-card`.

The schema describes _what is on the diagram_. **Everything is a group.** A group has a `type` that says whether it's a load (default) or a production source (`solar`, `wind`, `geothermal`, `hydro`). Loads and productions render with the same one-line-diagram visual; production units like PV inverters or wind turbines are expressed as **zones** of a circuit, which lets each unit carry its own sensor through the standard zone mechanics.

Groups nest: a group can declare its own `groups[]` for a sub-board fed by it rather than by the phase trunks — see [nested groups](#nested-groups--sub-boards).

> v0.6 adds `Circuit.label` and draws `Group.label` on the board; v0.5 added nested groups. Every v0.4 config remains valid throughout. v0.4 is **not** backward-compatible with versions before it. See the [CHANGELOG](../CHANGELOG.md) for migration steps.
>
> One behaviour change in v0.6: a `Group.label` set on an existing config used to appear only in the tooltip, and is now drawn beside the group box as well.

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
| `max_w`  | number | no       | Rated power in watts. Draws a [saturation bar](#saturation-bar) under this bubble. |

### Saturation bar

Set `max_w` alongside a sensor and the bubble gains a thin bar underneath
showing `current / max_w`. It fills proportionally, clamps at 100 %, and
repaints in `var(--error-color, #c53030)` once the reading exceeds the rating;
hovering gives the exact percentage. It is drawn only when both the rating and
a live reading are present.

`max_w` is accepted in two places, and works the same in both:

| On | Effect |
| -- | ------ |
| [`Sensor`](#sensor) — `sensors.total`, `sensors.grid`, `sensors.phases.l1/l2/l3` | Bar under the corresponding top-of-card bubble. Useful against a subscribed grid limit or a per-phase breaker rating. |
| [`Group`](#group) — `max_w` on the group itself | Bar under the group's own bubble. Useful for a production group (PV peak Wc) or a board approaching its main breaker rating. |

Circuits and zones have no `max_w`.

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
| `id`       | string                               | yes      | Short designator drawn inside the box (e.g. `D1`, `HVAC`). Also this group's identity: it forms the path (`D1`, `P/R1`) that keys the layout and the power bubbles, so it need only be unique among its siblings. The box grows to fit but stops at 64px and elides past that — put descriptive text in `label`, not here. |
| `type`     | `'distribution'` \| `'solar'` \| `'wind'` \| `'geothermal'` \| `'hydro'` | no | Defaults to `'distribution'`. Loads vs production. Visual is identical; the discriminator is for documentation, future tooling, and theming hooks. |
| `phases`   | `('L1' \| 'L2' \| 'L3')[]`           | yes      | Phases the group runs on. `[L1]` = single-phase; `[L1, L2, L3]` = three-phase; `[]` = no tap. Top-level groups tap the trunks here; on a nested group the value is informational (see [nested groups](#nested-groups--sub-boards)). |
| `accent`   | string (CSS colour)                  | no       | Single colour; renderer derives `color` / `stroke` / a tinted `fill` from it. When omitted, an accent is picked from a fallback palette by group index. |
| `color`    | string (CSS colour)                  | no       | Override for derived text colour. |
| `fill`     | string (CSS colour)                  | no       | Override for derived box fill. |
| `stroke`   | string (CSS colour)                  | no       | Override for derived box stroke. |
| `sensor`   | string (entity ID)                   | no       | Group-level live power. Renders a bubble next to the box. |
| `max_w`    | number                               | no       | Rated power in watts. With `sensor` set, draws a [saturation bar](#saturation-bar) under the group's bubble. |
| `switch`   | string (entity ID)                   | no       | Group-level toggle. Adds an inline switch to the bubble. |
| `summary`  | boolean                              | no       | Lists this group in the [source summary](#source-summary) above the diagram. Nested groups qualify. |
| `circuits` | [`Circuit[]`](#circuits)             | no       | Branches of this group. Optional — a group may render as just a box + tap line. |
| `groups`   | [`Group[]`](#nested-groups--sub-boards) | no    | Sub-boards fed by this group. Rendered indented, **above** this group's own circuits — see [nested groups](#nested-groups--sub-boards). |
| `label`    | string                               | no       | Human-readable name, drawn to the right of the box (e.g. `Main board`). Free to change at any time, unlike `id`. Elided if it would reach the power bubbles. Also leads the tooltip. |
| `amp` / `mA` / `poles` / `class` | numbers / string | no | _Metadata._ Structured RCD characteristics: rating in A, sensitivity in mA, pole count (1, 2, 3 or 4), IEC 60755 class (`'A'`, `'AC'`, `'B'`, `'F'`). |
| `mm2` / `cond` | numbers                      | no       | _Metadata._ The feed cable into this group: cross-section in mm² and conductor count. Most useful on a nested group, whose feed run is its own. |

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

### Source summary

Set `summary: true` on a group and it gains a row in a small table drawn above the diagram — its accent as a dot, its `label` (or `id`), and its live reading:

```yaml
groups:
  - id: ATS
    label: Grid via transfer switch
    phases: [L1]
    accent: '#3182ce'
    sensor: sensor.ats_grid_input_power
    summary: true

  - id: BYP
    label: Grid via inverter bypass
    phases: [L1]
    accent: '#805ad5'
    sensor: sensor.inverter_grid_input_power
    summary: true
```

| | |
| --- | --- |
| Grid via transfer switch | `0 W` |
| Grid via inverter bypass | `2.4 kW` |

That is the point of the table on a board with more than one way of being fed: the path carrying the house is the one not at zero. The card cannot say which is live — nothing reports the switch position — so it puts the readings side by side and lets you read it off.

Notes:

- **Opt-in, not inferred from `type`.** A `distribution` group can appear (a main breaker, a heavy load worth watching), and a source can stay out. Adding a type to your config never silently rewrites the header.
- **Nested groups qualify.** A PV array behind a sub-board is still where the power comes from. The row inherits the same accent it is drawn with below, so the dot matches its box.
- **Rows are listed in declaration order**, depth-first — parent before its own sub-groups.
- **A group with `summary: true` and no `sensor`** still gets a row, reading `—`. A misconfiguration should be visible, not silently dropped.
- **The table is HTML, not part of the SVG.** It therefore does not appear in the generated preview images under `assets/`, which serialise the diagram only.

### Phases array

| Value           | Meaning                                  |
| --------------- | ---------------------------------------- |
| `[L1]`          | Single-phase, taps L1.                   |
| `[L2]` / `[L3]` | Single-phase on the indicated phase.     |
| `[L1, L2, L3]`  | Three-phase. Renderer draws three taps. |
| `[L1, L2]`      | Two-phase. Two taps. (Rare in EU but supported.) |
| `[]`            | No phase tap. Group floats. |

### Nested groups / sub-boards

A group's `groups[]` holds the boards it feeds: an RCD sitting behind a main breaker, a remote sub-panel in a pool house or workshop, a contactor with its own set of circuits. Without it, everything behind a main breaker has to be flattened onto the main panel's bus, which draws a protection hierarchy that doesn't exist.

```yaml
groups:
  - id: P                  # main breaker, taps the trunks
    phases: [L1, L2, L3]
    poles: 4
    amp: 20
    sensor: sensor.pool_total_power
    circuits:
      - id: P3             # wired straight off P, no extra protection
        type: power
        sensor: sensor.pool_heat_pump_power
        zones:
          - { floor: L0, room: Pool heat pump, icon: mdi:heat-pump }
    groups:
      - id: R1             # 30 mA RCD inside the sub-board
        phases: [L1]
        amp: 40
        mA: 30
        poles: 2
        class: A
        sensor: sensor.pool_rcd_power
        circuits:
          - id: P1
            type: light
            zones:
              - { floor: L0, room: Underwater light }
              - { floor: L0, room: Safety cover }
```

Rendering rules:

| Rule | Detail |
| ---- | ------ |
| Feed | A nested group hangs off its parent's vertical bus, not off the phase trunks. No tap dots are drawn for it. |
| `phases` | Still required, still meaningful — but informational: it documents which phase the sub-board runs on and shows up in the tooltip and the metadata dialog. |
| Indent | One step right per level, for the group box and everything under it. Depth is unbounded; each level eats horizontal room, so two or three is the practical limit. |
| Order | A group's `groups[]` render first, then its own `circuits[]` — a feed to a remote board is a departure like any other and in practice sits above the breakers the parent keeps. YAML mappings carry no ordering between the two keys, so this is fixed rather than configurable. |
| Colour | A nested group with no `accent` inherits its parent's, so one branch of the diagram reads as one branch. Set `accent` to break it out. |
| Everything else | Identical to a top-level group: `sensor`, `switch`, `max_w`, metadata, tooltip, dialog. |

Ids are scoped by position in the tree (`P/R1`), so a sub-board may reuse a breaker letter already used on the parent board without the two colliding.

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
| `id`     | string                                | yes      | Short designator drawn inside the breaker box — the marking on the physical panel (e.g. `A`, `Q1`, `F12`). Unique within its group, and part of the bubble key. The box grows to fit but stops at 64px and elides past that — put descriptive text in `label`, not here. |
| `label`  | string                                | no       | Human-readable name, drawn to the right of the breaker box (e.g. `Kitchen sockets`). Free to change at any time, unlike `id`. Elided if it would reach the power bubbles. |
| `type`   | `'socket'` \| `'light'` \| `'power'`  | yes      | Picks the **default** icon for zones in this circuit (MDI: `mdi:power-socket-eu` / `mdi:lightbulb-outline` / `mdi:lightning-bolt`). |
| `icon`   | string (MDI name)                     | no       | Overrides the type default for all zones of this circuit. Any string accepted by `<ha-icon>` works (e.g. `mdi:solar-power`, `mdi:fire`). |
| `sensor` | string (entity ID)                    | no       | Per-circuit power. Bubble appears next to the breaker box. |
| `switch` | string (entity ID)                    | no       | Adds an inline toggle on the circuit's bubble. |
| `zones`  | [`Zone[]`](#zones)                    | no       | Branches off the circuit. Empty/missing = breaker box drawn alone, no zones. |
| `amp` / `poles` / `mm2` / `cond` / `pts` / `n_pts` | various | no | _Metadata._ Rating in A, pole count (1, 2, 3 or 4), cross-section in mm², conductor count, and a free-text / numeric points count. Surfaced in the tooltip and the metadata dialog. |

Icon resolution per zone: `Zone.icon` ⟶ `Circuit.icon` ⟶ default for `Circuit.type` ⟶ `mdi:help`.

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
| `floor`    | string           | Key into `floors`. Renders as a coloured pill, widened to fit the text — long floor names are no longer clipped. |
| `room`     | string           | Free-text label drawn next to the pill. |
| `sensor`   | string (entity)  | Per-zone power. Bubble to the right. |
| `switch`   | string (entity)  | Inline toggle on the bubble. |
| `critical` | boolean          | When `true` and `switch` is set, toggling shows a confirmation dialog using `room` as the load name. |
| `icon`     | string (MDI name) | Overrides `Circuit.icon` and the type default for this single zone. |

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
- `--secondary-text-color` → "Total" / "Grid" labels, room names, group / circuit `label` text
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

Bubble backgrounds are sized post-render in `updated()` via `getBBox()` on each `text.pwr-value`. Each element carries a `data-id` attribute used to find its companion `<rect data-bg-for="…">` background and `<line data-ln-for="…">` connector. Those ids are built from the element's path in the tree — `g-P/R1`, `c-P/R1-P1`, `z-P/R1-P1-0` — so they stay unique without the config having to keep every `id` globally distinct.

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
- Each group has an `id` and a `phases` array — nested groups included, reported with a path (`groups[1].groups[0]`).
- A group's `groups`, when present, is an array.

Anything else is accepted as-is. Unknown fields are ignored without warnings.
