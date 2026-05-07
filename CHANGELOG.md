# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(in pre-1.0, breaking changes may land in minor bumps).

## [0.17.0] — Visual editor (`getConfigElement`)

The card now ships a visual editor so it shows up properly in HA's
"Edit card" UI instead of falling back to the generic YAML pane.

### Implementation

- **`<ha-form>`** for the simple top-level scalars (`title`,
  `language`). Language is a dropdown populated from
  `SUPPORTED_LANGUAGES`.
- **`<ha-yaml-editor>`** for the nested structures (`sensors`,
  `floors`, `groups`). Groups / circuits / zones are too nested for a
  comfortable form UI; the YAML round-trip keeps full schema control
  with a familiar editor (syntax highlight, validation, …).
- A small inline hint links to the data-model reference for users new
  to the YAML schema.

The editor lives in `src/editor.ts` and is imported for side effect
from the main card so a single bundle still does the job — no separate
chunk to wire up.

### Bundle

47 KB minified (+~12 KB for the editor + ha-form / ha-yaml-editor
bindings).

## [0.16.0] — Per-zone tooltip + dialog

Zones get the same hover tooltip / click dialog treatment as RCDs and
breakers. Click anywhere on a zone row (floor pill, type icon, room
text, or power bubble — except the toggle, which still toggles) opens a
dialog with the zone's details and a "More info" button drilling into
the zone's `sensor:` (or `switch:` if no sensor).

### Added

- Hover tooltip on zone rows: `Room · Floor [· ✓ critical]`.
- Click handler on zone rows opening the metadata dialog with rows for
  Floor, Type, Power (live) and Critical (when set).
- New translation keys: `dialog.fields.floor` and `dialog.fields.critical`
  in all 18 languages (e.g. en `Floor` / `Critical`, fr `Étage` /
  `Critique`, de `Etage` / `Kritisch`, …).

### Behaviour

- Zone dialog title is `zone.room ?? '—'` (em dash when no room set).
- The "More info" entity defaults to `zone.sensor`, falls back to
  `zone.switch` when only a switch is configured.
- Toggling a smart-plug from the bubble still calls `switch.toggle`
  thanks to the existing `stopPropagation` on the toggle hit area —
  the click never reaches the zone-level handler.

## [0.15.0] — Dialog polish: "More info" button + tighter layout

The metadata dialog opened from a click on an RCD or breaker box gets a
secondary action that opens HA's standard `more-info` dialog for the
backing entity. Lets users drill into history charts, related entities,
and entity settings without leaving the panel context.

### Added

- **"More info" button** in the dialog footer (slot=`secondaryAction`),
  shown when the group / circuit has a `sensor:` entity. Clicking
  closes our dialog and fires `hass-more-info` on the backing entity.
- New `dialog.more_info` translation key (e.g. en `'More info'`,
  fr `'Plus d'infos'`, de `'Mehr Info'`, ja `'詳細情報'`, …) — added to
  all 18 built-in languages.

### Changed

- Metadata table CSS: 8 px padding, subtle row dividers via
  `border-top: 1px solid var(--divider-color)`, `min-width: 280px` on
  the table so even the shortest rows render with consistent width.

### Bundle

35 KB minified (+~1 KB for the action button + i18n strings).

## [0.14.0] — Render skip + memoised layout / bubble bbox

Three caches added to keep the card snappy on busy HA installs (where
`hass` updates fire every time _any_ entity in the system changes
state):

- **`shouldUpdate` skip** — overrides Lit's default policy. When `hass`
  is the only changed property, walks the list of entity IDs the card
  watches and skips the render entirely if none of their states or
  units have moved. Big win on panels with hundreds of unrelated
  entities updating constantly.
- **`_layoutCache`** — `_computeLayout()` runs once per `_config`,
  not once per render.
- **`_bubbleTextCache`** — bubble background `getBBox()` measurements
  and the resulting `setAttribute()` calls are skipped when the
  displayed text hasn't changed since the previous render. Saves the
  cost of forcing a synchronous layout per bubble on every tick.

All three caches are invalidated in `setConfig()` when the config is
replaced.

No schema or visual change.

## [0.13.0] — Saturation gauge under bubbles (`max_w`)

The `max_w` field — declared on `Sensor` since v0.1 but never rendered —
now drives a small saturation bar drawn beneath any bubble when both a
live reading and a peak value are configured. New `Group.max_w` field
extends this to group-level bubbles (typically the PV total: peak Wc).

### Added

- `Group.max_w?: number` — peak / rated power in watts.
- Saturation bar (30 × 2 px) under bubbles, fill width =
  `min(1, |current| / max_w) × 30`. Hover shows a percentage tooltip.
- Over 100 % saturation switches the fill to `var(--error-color)`
  (red) — caps at 100 % visual width but the tooltip still reports the
  real percentage.

### Wired

- Top-of-card `total` / `grid` / `phases.l[1-3]` bubbles read
  `max_w` from the corresponding `Sensor` entry.
- Group-level bubble reads `max_w` from `Group.max_w`.

Circuit and zone bubbles aren't wired yet (no `Circuit.max_w` or
`Zone.max_w` fields). Could be added later if useful.

### Example

```yaml
- id: PV
  type: solar
  phases: [L1, L2, L3]
  sensor: sensor.envoy_solar_production
  max_w: 8075                # 19 × 425 Wc array — peak power
```

## [0.12.0] — Metadata popup on click + i18n

Click on an RCD or breaker box opens an HA-native `<ha-dialog>` listing
the structured metadata. Coexists with the SVG `<title>` tooltip from
v0.11 — hover shows compact text, click opens the full table.

### Added on `Translations`

```ts
dialog: {
  group_title:   'RCD {id}',
  circuit_title: 'Circuit {id}',
  close: 'Close',
  fields: {
    label, type, phases, rating, sensitivity, poles, class,
    power, cross_section, conductors, points,
  },
}
```

All 18 built-in languages translated. The dialog title uses `{id}`
substitution so a French user sees "Différentiel D1", a German user
"FI-Schalter D1", a Russian user "УЗО D1", etc.

### Changed

- Group / circuit boxes get `class="meta-target"` and a `cursor: pointer`
  hint so hovering signals interactivity.

## [0.11.0] — Metadata tooltips on hover

The `Group` and `Circuit` metadata fields finally have a visible role.
Hovering a group's RCD box or a circuit's breaker box surfaces the
technical specs as a native browser tooltip (long-press on touch devices).

Generated from the structured fields with a compact technical notation:

- **RCD** (group): `40 A · 30 mA · 2P · Cl. A · L3`
- **Breaker** (circuit): `16 A · 2P · 2.5 mm² · 3 cond. · 1 (dedicated)`

Implementation: each box is wrapped in an SVG `<g>` with a `<title>`
child. No styling, no CSS, no extra DOM — leverages the browser's native
tooltip behaviour. Title text is omitted when no relevant metadata is
configured (so empty groups don't get phantom tooltips).

A future release may upgrade to a richer HA-styled popup on click.

## [0.10.0] — Structured RCD metadata at group level

Replaces the free-form `Group.spec` string with structured fields, mirroring
how `Circuit` already exposes its breaker characteristics (`amp`, `poles`,
`mm2`, `cond`, `pts`, `n_pts`).

### Added on `Group`

- `amp?: number` — RCD rating (e.g. `40`)
- `mA?: number` — sensitivity in milliamperes (e.g. `30`)
- `poles?: 2 | 4` — pole count
- `class?: string` — IEC 60755 class (`'A'`, `'AC'`, `'B'`, `'F'`)

### Breaking

- Removed `Group.spec`. Use the structured fields above instead. Configs
  that set `spec:` will now have it ignored (silently — unknown YAML keys
  are not validated). To migrate:
  ```yaml
  # before
  spec: '30mA 40A 2P Cl.A'
  # after
  amp: 40
  mA: 30
  poles: 2
  class: A
  ```

Metadata-only fields (not rendered), so no visual change.

## [0.9.0] — `Circuit.mm2` is now a number

Wire cross-section values are inherently numeric. The previous `string` type
forced quoting in YAML (`mm2: '2.5'`) which read as awkward and didn't match
the other numeric fields (`amp`, `cond`, `n_pts`).

### Breaking

- `Circuit.mm2: string` → `Circuit.mm2: number`. YAML configs need to drop
  the quotes around mm² values:
  ```yaml
  # before
  mm2: '2.5'
  # after
  mm2: 2.5
  ```

This is a metadata-only field (not rendered), so the change has no visual
effect on existing dashboards.

## [0.8.0] — 16 additional languages

Built-in translations expanded from `en` / `fr` to 18 languages, covering
the most common European and world languages used by HA installations:

| Code | Language       |
| ---- | -------------- |
| en   | English (default) |
| fr   | French          |
| de   | German          |
| es   | Spanish         |
| it   | Italian         |
| pt   | Portuguese      |
| nl   | Dutch           |
| pl   | Polish          |
| sv   | Swedish         |
| da   | Danish          |
| nb   | Norwegian Bokmål (also matches `no`) |
| fi   | Finnish         |
| cs   | Czech           |
| ru   | Russian         |
| uk   | Ukrainian       |
| ja   | Japanese        |
| zh   | Chinese (Simplified) |
| ko   | Korean          |

Detection still uses BCP 47 primary-subtag matching: `fr-BE` → `fr`,
`pt-BR` → `pt`, `zh-Hant` → `zh`, etc. Unknown languages fall back to
English (unchanged).

A new export `SUPPORTED_LANGUAGES` lists the registered codes — useful
for docs or future UI.

## [0.7.1] — Fix MDI icon clipping inside foreignObject

`<ha-icon>` defaults to `display: inline-flex` with `vertical-align: middle`,
which positioned the icon slightly below the geometric centre of its
`<foreignObject>` host. The bottom half of the icon was getting clipped by
the foreignObject's default `overflow: hidden`. Wrapped the ha-icon in a
flex div (in HTML namespace) that centres the icon precisely, plus
`overflow: visible` on the foreignObject as belt-and-suspenders.

## [0.7.0] — MDI icons (per zone, per circuit, with type defaults)

Zone icons are now Material Design icons rendered through Home Assistant's
`<ha-icon>` element, instead of unicode emoji. They follow `--secondary-text-color`
so they adapt to themes (emoji had inherent multi-colour rendering and looked
out of place in dark mode). Override per circuit or per zone.

### Added

- `Circuit.icon?: string` — MDI icon applied to all zones of the circuit
  (e.g. `icon: mdi:solar-power` on a PV inverter circuit).
- `Zone.icon?: string` — overrides the circuit-level icon for a single zone.

### Changed

- Default icons by `Circuit.type` now resolve to MDI:
  - `socket` → `mdi:power-socket-eu`
  - `light`  → `mdi:lightbulb-outline`
  - `power`  → `mdi:lightning-bolt`
- Icons render at 12 px square in a `<foreignObject>` host inside the SVG.

### Resolution order

```
zone.icon  →  circuit.icon  →  TYPE_DEFAULT_ICON[circuit.type]  →  mdi:help
```

## [0.6.0] — No floor presets, zone layout swap, more vertical space

### Breaking

- **Removed `DEFAULT_FLOORS`.** The card no longer ships with any built-in
  floor identifiers. Defining "some but not others" is confusing and
  installation-specific. Configure floors explicitly via `config.floors`;
  the README and docs/data-model.md show the recommended L-convention map
  (LB / L0 / L1 / L2). Zones referencing a floor key not in `config.floors`
  fall back to a neutral grey pill (unchanged behaviour for unknown keys).

### Changed

- **Zone layout swap.** Zone rendering order is now
  `connector → floor pill → type icon → room` (was
  `connector → type icon → floor pill → room`). The connector line stops at
  the start of the zone content so it no longer crosses the type icon.
- **More vertical space at the top of the card.** Staggered phase taps
  spread by 20 px between adjacent levels (was 14 px) so the right-column
  "Total" / "Grid" bubbles are visually separated. `PH_TAP_ZONE` increased
  to 54 px (was 42).

### Migration

If you were relying on the built-in `LB` / `L0` / `L1` / `L2` presets, copy
them into your card config:

```yaml
floors:
  LB: { bg: '#718096', fg: white }
  L0: { bg: '#38a169', fg: white }
  L1: { bg: '#3182ce', fg: white }
  L2: { bg: '#d69e2e', fg: white }
```

## [0.5.0] — Default floor identifiers renamed to L-convention

The card's built-in floor pill defaults now follow the HA-style "level"
convention used by floor plans: `LB` (lower basement) / `L0` (ground floor) /
`L1` / `L2`. Replaces the previous `E-1` / `E0` / `E1` / `E2` defaults. Same
colours.

### Breaking

- `DEFAULT_FLOORS` keys renamed: `E-1` → `LB`, `E0` → `L0`, `E1` → `L1`,
  `E2` → `L2`. Existing zones referencing `E-1` / `E0` / `E1` / `E2` will fall
  back to the generic grey pill (no built-in match) until they are renamed
  in the YAML config or the previous identifiers are restored via the
  `floors:` map:

  ```yaml
  floors:
    E-1: { bg: '#718096', fg: 'white' }
    E0:  { bg: '#38a169', fg: 'white' }
    E1:  { bg: '#3182ce', fg: 'white' }
    E2:  { bg: '#d69e2e', fg: 'white' }
  ```

### Migration

In each `Zone.floor` reference, replace:

| Old   | New |
| ----- | --- |
| `E-1` | `LB` |
| `E0`  | `L0` |
| `E1`  | `L1` |
| `E2`  | `L2` |

## [0.4.0] — Group `type` discriminator, single renderer for loads and productions

A simpler model: in the YAML, **everything is a group**. A group has a `type` that says whether it's a load (default) or a production source. Loads and productions render with the **same** logic — the existing distribution-style box with circuits and zones underneath. Production units (PV inverters, wind turbines, geothermal pumps, hydro generators) are expressed as **zones** of a circuit, which lets each unit carry its own `sensor`, `switch`, `room`, etc. through the existing zone mechanics — no PV-specific rendering needed.

### Breaking — schema

- `Group.kind: 'distribution' | 'grid_coupling' | 'pv_system'` → `Group.type: 'distribution' | 'solar' | 'wind' | 'geothermal' | 'hydro'`. Default is `'distribution'` (load).
- Removed: `Group.rows`, `Group.subtitle`, `Group.panels`, `Group.inverters` — those were `grid_coupling`/`pv_system` specifics. Express PV inverters as zones of a circuit instead.
- Removed types: `PvPanel`, `PvInverter`, `DetailRow`. They no longer appear in the public API.

### Breaking — i18n keys

- Removed: `grid_coupling.title_default`, `pv_system.title_default`. There is no longer any kind-specific localised default.

### Removed code

- `_renderGridCoupling`, `_renderPvSystem` rendering methods.
- `tint`, `formatInverterText`, `formatPanelText` helpers.

### Notes

- Production groups visually look identical to load groups. Use a clear `accent` (e.g. `var(--energy-solar-color, #d97706)` for solar) to distinguish them at a glance.
- `Group.circuits` is now optional. A group may render as just a box + tap line (no sub-bus, no internal structure) — useful for a minimal production declaration with just a total sensor.

### Migration

```yaml
# Before (v0.3) — pv_system kind with structured panels / inverters
- id: PV
  kind: pv_system
  phases: [L1, L2, L3]
  accent: 'var(--energy-solar-color, #d97706)'
  sensor: sensor.envoy_production
  subtitle: ↑ Grid injection
  inverters:
    - { brand: Enphase, model: IQ7+, count: 19, sensor: sensor.envoy_inverter_total }
  panels:
    - { count: 19, power_wc: 425 }

# After (v0.4) — type: solar, inverters as zones of a "production" circuit
- id: PV
  type: solar
  phases: [L1, L2, L3]
  accent: 'var(--energy-solar-color, #d97706)'
  sensor: sensor.envoy_production
  circuits:
    - id: INV
      type: power                                  # circuit-level icon
      zones:
        - { room: "IQ7+ #1",  sensor: sensor.envoy_microinverter_1_power }
        - { room: "IQ7+ #2",  sensor: sensor.envoy_microinverter_2_power }
        # ... × 19
```

Each microinverter gets its own zone row with its own bubble. Same mechanics as any zone.

## [0.3.0] — `pv_system` group kind

PV systems now have their own first-class group kind with structured hardware metadata, instead of being expressed via `grid_coupling` + free-form `rows`.

### Added

- `kind: 'pv_system'` — visually identical to `grid_coupling` (wide accent block with phase taps and arrow) but ignores `rows` in favour of:
  - `inverters: PvInverter[]` — `{ brand?, model?, count?, power_w?, sensor? }`. One row per entry; if `sensor` is set, a live-power bubble renders on the row.
  - `panels: PvPanel[]` — `{ brand?, model?, count?, power_wc? }`. One row per entry, formatted as `count × power_wc Wc · brand model`.
- `pv_system.title_default` translation key (en: "PV system", fr: "Production photovoltaïque").

### Notes

- `grid_coupling` remains for non-PV bidirectional / decoupling use cases (battery storage, wind, generic protection blocks).
- An empty `pv_system` (no `inverters`, no `panels`) is valid — renders just the header with the optional group `sensor` bubble.

### Migration

```yaml
# v0.2 — generic grid_coupling with free-form rows
- id: PV
  kind: grid_coupling
  phases: [L1, L2, L3]
  accent: 'var(--energy-solar-color, #d97706)'
  sensor: sensor.envoy_production
  label: Découplage 4P — Synergrid C10/11
  subtitle: ↑ Injection réseau
  rows:
    - { icon: ☀, label: Onduleurs PV }
    - { icon: ☀, label: Panneaux PV }

# v0.3 — pv_system with hardware spec
- id: PV
  kind: pv_system
  phases: [L1, L2, L3]
  accent: 'var(--energy-solar-color, #d97706)'
  sensor: sensor.envoy_production
  subtitle: ↑ Injection réseau
  inverters:
    - { brand: Enphase, model: IQ7+, count: 19 }
  panels:
    - { count: 19, power_wc: 425 }
```

## [0.2.0] — Schema generalisation

This release reshapes the YAML schema so it describes _what is on the diagram_ rather than the user's specific Belgian residential electrical layout. There is **no backward compatibility** with v0.1 configs — see Migration below.

### Breaking — schema

- `Group.phase: 'L1' | 'L2' | 'L3' | '3P'` → `Group.phases: ('L1' | 'L2' | 'L3')[]`. Use `[L1]` for single-phase, `[L1, L2, L3]` for three-phase. Open to other combinations.
- `Group.color`, `Group.fill`, `Group.stroke` are no longer required. New optional `Group.accent: string` provides a single colour from which the renderer derives `color` (text), `stroke`, and a tinted `fill` via `color-mix()`. The three explicit fields remain available as overrides. When neither `accent` nor overrides are set, a colour is picked from a fallback palette by group index.
- `Group.kind?: 'distribution' | 'grid_coupling'` (default `'distribution'`). `grid_coupling` is the new generic block that replaces the hardcoded PV section — used for PV decoupling, bidirectional grid meters, etc.
- For `kind: 'grid_coupling'`: optional `Group.label`, `Group.subtitle`, and `Group.rows: { icon?, label }[]` for decorative info rows.
- `MainSensors` is now a typed interface instead of `Record<string, MainSensor>`:
  ```ts
  { total?, grid?, phases?: { l1?, l2?, l3? } }
  ```
  Old keys `phase_l1` / `phase_l2` / `phase_l3` → `phases.l1` / `phases.l2` / `phases.l3`.
- `sensors.pv` is removed. The PV power reading now comes from a `grid_coupling` group's `sensor` field.
- Top-level `pv` config object (the `PvBlockConfig` orphan) is removed.
- Empty/missing `Circuit.zones` no longer renders a placeholder "phantom zone" — the breaker box draws alone. To force an empty zone slot, pass `zones: [{}]` explicitly.

### Breaking — i18n keys

- Removed: `pv.title_default`, `pv.injection`, `pv.inverters`, `pv.panels` (those are now user-provided per `grid_coupling` group via `label`, `subtitle`, `rows`).
- Renamed: `pv.title_default` → `grid_coupling.title_default` (used as fallback when a `grid_coupling` group has no `label`).
- Removed: `card.pv` (was unused).

### Added

- Per-group fallback palette so a minimal config (only `id`, `phases`, `circuits`) produces a usable card.
- Validation in `setConfig`: per-group checks for `id`, `phases` array, and `circuits` presence on `kind: 'distribution'`.

### Migration from 0.1.x

```yaml
# Before
- id: D1
  phase: L3
  color: '#276749'
  fill: '#c6f6d5'
  stroke: '#38a169'
  sensor: ...
  circuits: [...]

# After (minimum)
- id: D1
  phases: [L3]
  accent: '#38a169'    # was the stroke; the renderer derives the rest
  sensor: ...
  circuits: [...]
```

```yaml
# Before — implicit PV section
sensors:
  pv: { entity: sensor.envoy_production, label: PV title }

# After — PV is a regular group with kind: grid_coupling
groups:
  - id: PV
    kind: grid_coupling
    phases: [L1, L2, L3]
    accent: '#d97706'                 # any accent; uses `--energy-solar-color` if you want it themed
    sensor: sensor.envoy_production
    label: PV / Grid coupling
    subtitle: ↑ Grid injection
    rows:
      - { icon: ☀, label: PV inverters }
      - { icon: ☀, label: PV panels }
```

```yaml
# Before
sensors:
  phase_l1: { entity: ... }
  phase_l2: { entity: ... }
  phase_l3: { entity: ... }

# After
sensors:
  phases:
    l1: { entity: ... }
    l2: { entity: ... }
    l3: { entity: ... }
```

## [0.1.0] — Initial public scaffold

- Lit + Rollup card scaffold with HACS metadata.
- Faithful port of an internal SVG one-line diagram into a Lovelace custom card.
- Reads live values via `hass.states[]`; toggles via `hass.callService('switch', 'toggle', …)`.
- Light / dark theme adaptation for chrome (texts, bubbles, dividers).
- Phase wires keep IEC 60446 colours regardless of theme.
- English (default) + French i18n.
