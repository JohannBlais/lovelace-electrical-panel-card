# Electrical Panel Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![GitHub Release](https://img.shields.io/github/v/release/JohannBlais/lovelace-electrical-panel-card)](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Lovelace custom card that renders your electrical panel as an interactive **one-line diagram** — phase trunks, RCDs, breakers, zones — with **live power readings** at every level and **smart-plug toggles** built in. Configured entirely from YAML.

If you've ever wished your HA dashboard could show the panel the way the electrician sees it, this is that.

![Card preview](https://raw.githubusercontent.com/JohannBlais/lovelace-electrical-panel-card/main/assets/preview-04-three-phase-with-pv.svg)

---

## Features

- **One-line diagram** rendered as pure SVG, scaling to any width
- **Live power** on phase trunks, RCDs, circuits and individual zones — read straight from `hass.states`, no polling, no token
- **Smart-plug toggles** inline on each bubble, with confirmation dialog for `critical:` loads (fridges, freezers, sump pumps, …)
- **Production groups** alongside loads — `type: solar | wind | geothermal | hydro` rendered with the same primitives. Inverters and turbines become zones with their own sensors.
- **Nested sub-boards** — a group can carry its own `groups[]`, so a pool house, garage or workshop board fed by a main breaker draws as an indented branch instead of being flattened into the main panel
- **Three-phase aware** — `phases: [L1, L2, L3]` for 4P breakers, single phase for everything else, any combination accepted
- **MDI icons** per circuit type with per-circuit and per-zone overrides — `mdi:fridge`, `mdi:solar-power`, anything Material Design ships
- **Floor / room labelling** per zone with configurable colour-coded pills
- **Hover tooltips + click-to-open metadata dialog** with structured RCD / breaker specs (rating, sensitivity, poles, class, cross-section, …)
- **Theme-aware**: cable colours stay IEC 60446 across light / dark themes; everything else (text, dividers, bubbles, accents) follows the active HA theme
- **18 built-in languages** auto-detected from `hass.locale.language`: English, French, German, Spanish, Italian, Portuguese, Dutch, Polish, Swedish, Danish, Norwegian, Finnish, Czech, Russian, Ukrainian, Japanese, Chinese (Simplified), Korean

## Install

> **Requires Home Assistant 2026.3 or later.** The metadata dialog is built on the webawesome-based `ha-dialog` introduced in that release. On earlier versions the card still draws, but the dialog opens without its title or buttons.

### HACS

1. HACS → **Frontend** → menu (⋮) → **Custom repositories**
2. Add `https://github.com/JohannBlais/lovelace-electrical-panel-card`, category **Lovelace**
3. Search for *Electrical Panel Card* and install
4. Reload the page (`F5`)

HACS warns after every plugin update that you have to clear the frontend cache manually. With dashboards in storage mode you don't: HACS rewrites the resource URL to `/hacsfiles/lovelace-electrical-panel-card/electrical-panel-card.js?hacstag=<id><version>` on each update, so the new bundle lives at a URL the browser has never seen and a plain reload picks it up. The warning is generic — HACS shows it for every Lovelace plugin. In YAML mode it does apply, since HACS cannot touch a `resources:` list it does not own; version the URL yourself as below.

### Manual

Grab `electrical-panel-card.js` from the latest [release](https://github.com/JohannBlais/lovelace-electrical-panel-card/releases), drop it under `<config>/www/electrical-panel-card/`, then declare a Lovelace resource with the version in the URL:

```yaml
resources:
  - url: /local/electrical-panel-card/electrical-panel-card.js?v=0.17.5
    type: module
```

Bump `?v=` every time you replace the file. Home Assistant serves `/local` with `Cache-Control: public, max-age=2678400` — 31 days — so on an unchanged URL the browser keeps serving the old bundle and the update looks like it did nothing.

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
- **`groups[]`** *inside* a group: a sub-board fed by that group rather than by the phase trunks. Drawn indented off the parent's bus, above the parent's own circuits, inheriting its `accent` unless it sets one.
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
npm run lint
npm run build       # production bundle (minified)
npm run smoke-test  # drives the built bundle in jsdom (needs build first)
```

`smoke-test` opens the metadata dialog and clicks through it, covering what `generate-previews` cannot: the markup contract with HA's `ha-dialog`, and the `fireEvent` call behind **More info**. Both scripts share the jsdom harness in `scripts/lib/card-harness.mjs`.

`watch` and `build` mirror the bundle into the HA config directory so the card lands directly in HA. Defaults to `Z:/www` (a Samba mount on the author's machine). Override with environment variables:

| Variable | Effect |
| -------- | ------ |
| `HA_WWW_DIR=/path/to/www` | Mirror to a different directory |
| `NO_HA_MIRROR=1` | Skip the mirror (dist/ only) |
| `CI=true` | Same — auto-set by GitHub Actions |

When the target path is missing and no opt-out is set, the build **fails loudly** so stale code never lingers in HA.

### Running a dev build next to the released one

A normal build registers itself as `electrical-panel-card` — the same custom-element name the HACS release uses. Registering both in the same Home Assistant means whichever script loads second loses its `customElements.define()` call silently, and you end up testing an unpredictable one of the two.

`build:dev` / `watch:dev` avoid that by suffixing every identity constant, so the two builds coexist:

```bash
npm run watch:dev   # → dist/ + Z:/www/electrical-panel-card-dev/
npm run build:dev
```

|  | Released build | Dev build |
| --- | --- | --- |
| Card type | `custom:electrical-panel-card` | `custom:electrical-panel-card-dev` |
| Editor element | `electrical-panel-card-editor` | `electrical-panel-card-editor-dev` |
| Card picker entry | Electrical Panel Card | Electrical Panel Card (dev) |
| Console banner | `v<version>` | `v<version>-dev` |
| Mirror folder | `www/electrical-panel-card/` | `www/electrical-panel-card-dev/` |

Register the dev bundle as a second Lovelace resource (Settings → Dashboards → ⋮ → Resources):

```
/local/electrical-panel-card-dev/electrical-panel-card.js?v=1
```

Then point a scratch dashboard at `type: custom:electrical-panel-card-dev` while your real dashboards keep running the stable HACS build. The separate mirror folder matters: sharing one folder would let a plain `npm run build` silently replace the dev bundle with a normally-tagged one, breaking the registered resource.

The 31-day cache on `/local` bites hardest here, where the file changes on every rebuild: a `watch:dev` loop writes a new bundle that the browser then refuses to fetch. Keep DevTools open with **Disable cache** ticked for the whole session — editing the resource's `?v=` after each rebuild works too, but you would be doing it every few minutes.

## Previews

The SVGs under [`assets/`](assets/) are generated from the YAML configs in [`examples/`](examples/) by:

```bash
npm run generate-previews
```

The script runs the real card bundle inside jsdom with synthetic state values, then bakes every `<text>` element into `<path>` outlines using the actual Roboto glyphs (via `opentype.js`). The output reflects the exact code paths the live card takes — same layout maths, same icon resolution, same saturation gauge — and renders identically in any SVG viewer (GitHub camo, librsvg, ImageMagick, mobile browsers) without depending on the Roboto webfont.

It doubles as a sanity test: if the renderer throws or yields no SVG, generation fails. A future commit can wire snapshot diffing for proper visual regression coverage.

## Releasing

`package.json` is the only place the version lives. `CARD_VERSION` in [`src/const.ts`](src/const.ts) is injected from it at every build, so there is nothing to keep in sync by hand:

```bash
npm version patch --no-git-tag-version   # or minor / major
```

That rewrites `package.json` and the lockfile without committing or tagging. Add a [`CHANGELOG.md`](CHANGELOG.md) entry for the new version, land both as a release PR, then tag the merge commit:

```bash
git checkout main && git pull && git tag "v$(node -p "require('./package.json').version")" && git push --tags
```

Deriving the tag from `package.json` rather than typing it is the point — `release.yml` rejects a mismatch, and the pull matters because tagging a stale `main` would publish the previous commit.

[`release.yml`](.github/workflows/release.yml) refuses to build when the tag disagrees with `package.json` — a mistyped tag is the one remaining way to publish an inconsistent release. It then type-checks, builds, and attaches `dist/electrical-panel-card.js` to the GitHub release, which is the file HACS serves.

One constraint on version numbers: HACS derives its cache-busting `hacstag` by stripping every non-digit from the tag, so `v0.17.5` becomes `0175`. Two releases whose digits collapse to the same string (`0.17.5` and `0.1.75`, or `1.0` and `0.10`) would leave users on a stale cached bundle. Ordinary patch and minor bumps are safe.

## License

[MIT](LICENSE) © Johann Blais
