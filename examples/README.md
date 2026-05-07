# Examples

Sample configurations covering common installation patterns. Drop the body of any file into a Lovelace dashboard `cards:` array — every example is a complete, self-contained card.

| File | Scenario |
| ---- | -------- |
| [`01-minimal-single-phase.yaml`](01-minimal-single-phase.yaml) | Smallest viable config. One single-phase RCD, two breakers (sockets + lighting), no live sensors. Apartment-scale. |
| [`02-single-phase-with-pv.yaml`](02-single-phase-with-pv.yaml) | Single-phase house. Adds top-of-card live readings, smart-plug toggles with `critical:` confirmation, MDI icon overrides per zone, and a small PV system with two microinverters expressed as zones. |
| [`03-three-phase-no-production.yaml`](03-three-phase-no-production.yaml) | Three-phase residential panel with three single-phase RCDs distributed across L1/L2/L3 plus one three-phase RCD for heat pump and induction cooktop. Per-phase total bubbles. No production. |
| [`04-three-phase-with-pv.yaml`](04-three-phase-with-pv.yaml) | Realistic full-house setup. Five-storey floor map, six load RCDs, three-phase HVAC, plus a PV group with six microinverters as individual zones. Demonstrates the recommended pattern for monitoring per-microinverter power. |

## How to use

1. Pick the example closest to your installation.
2. Copy its body (everything starting from `type: custom:electrical-panel-card`).
3. Paste it into Lovelace as a card and replace the placeholder entity IDs (`sensor.house_total_power`, etc.) with your actual entities.
4. Tune `accent`, `floors`, `room` labels, `icon:` overrides as you go.

## Floor identifier convention

The L-convention used in these examples (`LB` / `L0` / `L1` / `L2` / `TO`) matches Home Assistant's floor-plan notation:

| Code | Floor |
| ---- | ----- |
| `LB` | Lower basement |
| `L0` | Ground floor |
| `L1` | First floor |
| `L2` | Second floor |
| `TO` | Roof (typically used for solar panels and inverters) |

You're free to use any identifiers you want — the keys are arbitrary as long as `floors:` defines them. See [docs/data-model.md](../docs/data-model.md#floors) for details.

## Going further

- [Data model reference](../docs/data-model.md) — full schema documentation.
- [CHANGELOG](../CHANGELOG.md) — version history.
