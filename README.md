# Electrical Panel Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/JohannBlais/lovelace-electrical-panel-card)](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Custom Lovelace card for Home Assistant — interactive one-line electrical panel diagram with live power readings, smart-plug toggles, and per-circuit / per-zone breakdown. Configured entirely from YAML.

> **Status:** early development. The diagram renderer arrives in Phase 2; the current build is a minimal scaffold that validates the configuration.

## Features (target)

- Live power on phases (L1/L2/L3), RCDs, circuits and individual loads
- Toggle smart plugs straight from the diagram (with confirmation for critical loads)
- Floor + room labelling per zone
- Three-phase loads, PV / grid injection block
- 100 % YAML configuration — adapt it to any panel layout
- Pure SVG, no iframe, no token, no polling — uses the standard `hass` object
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
title: Tableau électrique
# Optional — overrides the language auto-detected from hass.locale.
# Built-in: 'en' (default) and 'fr'. Falls back to English if unknown.
language: fr
sensors:
  total: { entity: sensor.envoy_current_power_consumption, label: Total }
  pv:    { entity: sensor.envoy_current_power_production,  label: ☀ PV, max_w: 8075 }
floors:
  E0: { bg: '#38a169', fg: white }
  E1: { bg: '#3182ce', fg: white }
groups:
  - id: D1
    phase: L1
    color: '#2c5282'
    fill:  '#bee3f8'
    stroke: '#3182ce'
    sensor: sensor.emporia_d1_power
    circuits:
      - id: A
        amp: 16
        type: socket
        sensor: sensor.washing_machine_power
        switch: switch.washing_machine
        zones:
          - { floor: E1, room: laundry }
```

See [docs/data-model.md](docs/data-model.md) for the full schema, theming variables, and special concepts (three-phase loads, critical-toggle confirmation, internationalisation).

## Development

```bash
npm install
npm run watch     # rebuild on changes → dist/electrical-panel-card.js
npm run typecheck
npm run build     # production bundle (minified)
```

To test inside Home Assistant, copy `dist/electrical-panel-card.js` into your HA `www/` directory and add it as a Lovelace resource (see Manual install above).

## Releasing

Push a tag and the GitHub workflow will build and attach the bundle to the release:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

## License

[MIT](LICENSE) © Johann Blais
