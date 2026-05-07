# Electrical Panel Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/JohannBlais/lovelace-electrical-panel-card)](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Custom Lovelace card for Home Assistant — interactive one-line electrical panel diagram with live power readings, smart-plug toggles, and per-circuit / per-zone breakdown. Configured entirely from YAML.

## Features

- Live power on phases (L1/L2/L3), groups, circuits and individual zones
- Toggle smart plugs straight from the diagram, with confirmation for critical loads
- Floor + room labelling per zone
- One model for everything: each group has a `type` (`distribution` for loads — the default — or `solar` / `wind` / `geothermal` / `hydro` for productions). Loads and productions render the same way; production units (PV inverters, turbines, …) are expressed as zones with their own `sensor`.
- Single `accent` colour per group — the renderer derives `color` / `fill` / `stroke` via `color-mix()`. Override individually for exact control.
- Phase array (`phases: [L1]`, `[L1, L2, L3]`, …) — single, three- or any combination
- 100 % YAML configuration; pure SVG, no iframe, no token, no polling — uses the standard `hass` object
- Light / dark theme aware (cable colours stay IEC 60446; texts adapt)
- English (default) and French built-in; auto-detected from `hass.locale.language`

## Installation

### HACS (recommended)

1. Open HACS → **Frontend** → menu (⋮) → **Custom repositories**.
2. Add `https://github.com/JohannBlais/lovelace-electrical-panel-card` with category **Lovelace**.
3. Search for *Electrical Panel Card* and install.
4. Refresh your browser (or hard-reload the dashboard).

### Manual

Download `electrical-panel-card.js` from the latest [release](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases), copy it to `<config>/www/electrical-panel-card/`, then add a Lovelace resource:

```yaml
resources:
  - url: /local/electrical-panel-card/electrical-panel-card.js
    type: module
```

## Usage

Add the card to a dashboard:

```yaml
type: custom:electrical-panel-card
title: Electrical panel
# Optional — overrides the language auto-detected from hass.locale.
# Built-in: 'en' (default) and 'fr'. Falls back to English if unknown.
# language: fr
sensors:
  total: { entity: sensor.envoy_current_power_consumption }
  grid:  { entity: sensor.envoy_current_net_power_consumption }
  phases:
    l1: { entity: sensor.envoy_current_power_consumption_l1 }
    l2: { entity: sensor.envoy_current_power_consumption_l2 }
    l3: { entity: sensor.envoy_current_power_consumption_l3 }
floors:
  # Recommended L-convention (matches HA floor-plans). Copy into your
  # config and tweak — the card ships with no built-in floor presets.
  LB: { bg: '#718096', fg: white }   # lower basement
  L0: { bg: '#38a169', fg: white }   # ground floor
  L1: { bg: '#3182ce', fg: white }   # first floor
  L2: { bg: '#d69e2e', fg: white }   # second floor
groups:
  - id: D1
    phases: [L1]
    accent: '#3182ce'         # single colour, renderer derives the rest
    sensor: sensor.emporia_d1_power
    circuits:
      - id: A
        type: socket
        sensor: sensor.washing_machine_power
        switch: switch.washing_machine
        zones:
          - { floor: L1, room: laundry }

  - id: PV
    type: solar
    phases: [L1, L2, L3]
    accent: 'var(--energy-solar-color, #d97706)'
    sensor: sensor.envoy_current_power_production
    circuits:
      - id: INV
        type: power
        zones:
          - { room: "IQ7+ #1", sensor: sensor.envoy_microinverter_1_power }
          - { room: "IQ7+ #2", sensor: sensor.envoy_microinverter_2_power }
          # ... one zone per microinverter
```

See [docs/data-model.md](docs/data-model.md) for the full schema, theming variables, and special concepts (three-phase loads, critical-toggle confirmation, internationalisation).

## Development

```bash
npm install
npm run watch     # rebuild on changes → dist/ + Z:/www/electrical-panel-card/
npm run typecheck
npm run build     # production bundle (minified)
```

The build mirrors the bundle into `<HA-config>/www/electrical-panel-card/` so changes land directly in Home Assistant. By default it expects the HA config dir at `Z:/www` (a Samba mount). Override:

| Variable                | Effect                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `HA_WWW_DIR=/path/to/www` | Use that directory instead of `Z:/www`.                          |
| `NO_HA_MIRROR=1`        | Skip the mirror entirely (build dist/ only). For contributors without an HA setup. |
| `CI=true`               | Same as `NO_HA_MIRROR` — auto-set by GitHub Actions.             |

If the target path doesn't exist and none of the opt-outs are set, the build **fails loudly** rather than silently leaving stale code in HA.

## Releasing

Push a tag and the GitHub workflow will build and attach the bundle to the release:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

## License

[MIT](LICENSE) © Johann Blais
