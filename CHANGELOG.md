# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(in pre-1.0, breaking changes may land in minor bumps).

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
