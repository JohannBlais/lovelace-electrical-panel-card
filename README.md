# Electrical Panel Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/JohannBlais/lovelace-electrical-panel-card)](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Lovelace custom card that renders your electrical panel as an interactive **one-line diagram** — phase trunks, RCDs, breakers, zones — with **live power readings** at every level and **smart-plug toggles** built in. Configured entirely from YAML.

If you've ever wished your HA dashboard could show the panel the way the electrician sees it, this is that.

![Card preview](https://raw.githubusercontent.com/JohannBlais/lovelace-electrical-panel-card/main/assets/preview.svg)

---

## Features

- **One-line diagram** rendered as pure SVG, scaling to any width
- **Live power** on phase trunks, RCDs, circuits and individual zones — read straight from `hass.states`, no polling, no token
- **Smart-plug toggles** inline on each bubble, with confirmation dialog for `critical:` loads (fridges, freezers, sump pumps, …)
- **Production groups** alongside loads — `type: solar | wind | geothermal | hydro` rendered with the same primitives. Inverters and turbines become zones with their own sensors.
- **Three-phase aware** — `phases: [L1, L2, L3]` for 4P breakers, single phase for everything else, any combination accepted
- **MDI icons** per circuit type with per-circuit and per-zone overrides — `mdi:fridge`, `mdi:solar-power`, anything Material Design ships
- **Floor / room labelling** per zone with configurable colour-coded pills
- **Hover tooltips + click-to-open metadata dialog** with structured RCD / breaker specs (rating, sensitivity, poles, class, cross-section, …)
- **Theme-aware**: cable colours stay IEC 60446 across light / dark themes; everything else (text, dividers, bubbles, accents) follows the active HA theme
- **18 built-in languages** auto-detected from `hass.locale.language`: English, French, German, Spanish, Italian, Portuguese, Dutch, Polish, Swedish, Danish, Norwegian, Finnish, Czech, Russian, Ukrainian, Japanese, Chinese (Simplified), Korean

## Install

### HACS

1. HACS → **Frontend** → menu (⋮) → **Custom repositories**
2. Add `https://github.com/JohannBlais/lovelace-electrical-panel-card`, category **Lovelace**
3. Search for *Electrical Panel Card* and install
4. Hard-refresh your dashboard (`Ctrl+Shift+R`)

### Manual

Grab `electrical-panel-card.js` from the latest [release](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases), drop it under `<config>/www/electrical-panel-card/`, then declare a Lovelace resource:

```yaml
resources:
  - url: /local/electrical-panel-card/electrical-panel-card.js
    type: module
```

## Quick start

The minimum viable configuration is one group with one circuit and one zone:

```yaml
type: custom:electrical-panel-card
floors:
  L0: { bg: '#38a169', fg: white }
groups:
  - id: D1
    phases: [L1]
    accent: '#3182ce'
    circuits:
      - id: A
        type: socket
        zones:
          - { floor: L0, room: Kitchen }
```

From there you grow horizontally (more zones, more circuits, more groups) and vertically (sensors, switches, icons, metadata).

See [`examples/`](examples/) for richer configs:

| Scenario | File |
| -------- | ---- |
| Apartment, single-phase, no monitoring | [`01-minimal-single-phase.yaml`](examples/01-minimal-single-phase.yaml) |
| House, single-phase, small PV | [`02-single-phase-with-pv.yaml`](examples/02-single-phase-with-pv.yaml) |
| House, three-phase, no production | [`03-three-phase-no-production.yaml`](examples/03-three-phase-no-production.yaml) |
| House, three-phase, full PV | [`04-three-phase-with-pv.yaml`](examples/04-three-phase-with-pv.yaml) |

## Configuration reference

The full schema lives in [`docs/data-model.md`](docs/data-model.md). Key concepts in one paragraph:

- **`groups[]`** is the top-level structure; each group has a `type` (`distribution` for loads — the default — or one of the production kinds), a `phases` array describing which trunks it taps, and an `accent` colour from which the renderer derives `color` / `fill` / `stroke`.
- **`circuits[]`** under a group: one entry per breaker. Carries an icon-defining `type` (`socket` / `light` / `power`), optional `sensor` for live readings, optional `switch` for inline toggling, and a list of `zones[]`.
- **`zones[]`** are the leaves: a `floor` pill (defined in `floors:`), a free-text `room`, and optionally `sensor`, `switch`, `critical`, plus icon / metadata overrides.
- **`sensors:`** at the top level wires the card-wide totals — `total`, `grid` and the per-phase trunk readings.

## Languages

Auto-detected from `hass.locale.language` (BCP 47 primary subtag matching, so `pt-BR` → `pt`, `zh-Hans` → `zh`, `nb-NO` → `nb`). Override explicitly:

```yaml
type: custom:electrical-panel-card
language: de
...
```

To add a language, drop a `xx.ts` file next to `src/translations/en.ts` exporting a `Translations` object, then register it in `DICTS` in `src/translations/index.ts`. Three strings to translate (`card.total`, `card.grid`, `confirm.toggle`) plus the dialog vocabulary (`dialog.group_title`, `dialog.circuit_title`, `dialog.close`, and the field labels under `dialog.fields`).

## Theming

CSS custom properties exposed:

| Variable | Default | Used by |
| -------- | ------- | ------- |
| `--electrical-panel-phase-l1-color` | `#8B4513` | L1 trunk + tap dots |
| `--electrical-panel-phase-l2-color` | `#1A202C` | L2 trunk + tap dots |
| `--electrical-panel-phase-l3-color` | `#5A6474` | L3 trunk + tap dots |

Plus the standard HA variables: `--primary-text-color`, `--secondary-text-color`, `--ha-card-background`, `--card-background-color`, `--divider-color`, `--ha-font-family-body`, and `--energy-solar-color` (used as a default solar accent if you write `accent: 'var(--energy-solar-color, #d97706)'`).

Phase wire colours stay IEC 60446 across themes — real cables don't lighten at night. Phase **labels** and bubble values use `--primary-text-color` so they stay readable. In dark mode, user-configured group / circuit colours get a subtle CSS filter so dark accents stay legible.

## Development

```bash
npm install
npm run watch       # → dist/ + Z:/www/electrical-panel-card/
npm run typecheck
npm run build       # production bundle (minified)
```

`watch` and `build` mirror the bundle into the HA config directory so the card lands directly in HA. Defaults to `Z:/www` (a Samba mount on the author's machine). Override with environment variables:

| Variable | Effect |
| -------- | ------ |
| `HA_WWW_DIR=/path/to/www` | Mirror to a different directory |
| `NO_HA_MIRROR=1` | Skip the mirror (dist/ only) |
| `CI=true` | Same — auto-set by GitHub Actions |

When the target path is missing and no opt-out is set, the build **fails loudly** so stale code never lingers in HA.

## Releasing

```bash
npm version patch   # or minor / major
git push --follow-tags
```

The `.github/workflows/release.yml` action builds, type-checks, and attaches `dist/electrical-panel-card.js` to the GitHub release.

## License

[MIT](LICENSE) © Johann Blais
