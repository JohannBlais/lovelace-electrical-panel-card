#!/usr/bin/env node
// Interaction smoke test. Drives the real card bundle in jsdom and exercises
// the paths the preview generator cannot reach: opening the metadata dialog,
// its markup contract with Home Assistant's <ha-dialog>, and the `fireEvent`
// call that opens HA's native more-info dialog.
//
// Usage: `npm run smoke-test` (requires `npm run build` first)
//
// Why this exists: #19 shipped to users because nothing opened a dialog. The
// card was still emitting the pre-2026.3 mwc-dialog markup (`heading`, plus
// `primaryAction` / `secondaryAction` slots directly on `ha-dialog`), and
// content addressed to a slot that no longer exists is dropped *silently* —
// so the dialog rendered with no title and no buttons while every check
// stayed green. The assertions below are shaped around that failure: they
// check where the buttons live, not merely that some markup was produced.

import { window, mountCard, unmountCard } from './lib/card-harness.mjs';

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL ${label}\n`);
    if (detail) process.stdout.write(`       ${detail}\n`);
  }
}

// A zone carrying an entity, a zone carrying none, and a group-level sensor —
// enough to cover both dialog shapes (with and without the more-info action).
const config = {
  type: 'custom:electrical-panel-card',
  title: 'Smoke test',
  sensors: { total: { entity: 'sensor.total_power' } },
  floors: { L0: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'D1',
      phases: ['L1'],
      sensor: 'sensor.group_power',
      circuits: [
        {
          id: 'A',
          type: 'socket',
          amp: 16,
          zones: [
            { floor: 'L0', room: 'Measured zone', sensor: 'sensor.zone_power', switch: 'switch.zone' },
            { floor: 'L0', room: 'Bare zone' },
          ],
        },
      ],
    },
  ],
};

function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// Click each clickable target until the dialog title matches `title`. Clicking
// a different target replaces the open dialog, so no explicit close is needed.
async function openDialogTitled(card, title) {
  const targets = card.shadowRoot.querySelectorAll('g.meta-target');
  for (const target of targets) {
    click(target);
    await card.updateComplete;
    const dialog = card.shadowRoot.querySelector('ha-dialog');
    if (dialog && dialog.headerTitle === title) return dialog;
  }
  return null;
}

const card = await mountCard(config);

process.stdout.write('\nRendering\n');
check('card produces an SVG', !!card.shadowRoot?.querySelector('svg'));
check(
  'no dialog before any click',
  !card.shadowRoot.querySelector('ha-dialog'),
);
check(
  'clickable targets exist',
  card.shadowRoot.querySelectorAll('g.meta-target').length > 0,
  `found ${card.shadowRoot.querySelectorAll('g.meta-target').length}`,
);

process.stdout.write('\nDialog markup (guards against #19)\n');
const dialog = await openDialogTitled(card, 'Measured zone');
check('clicking a zone opens ha-dialog with its title', !!dialog);

if (dialog) {
  // The pre-2026.3 markup put the buttons directly on ha-dialog. They must now
  // live inside ha-dialog-footer; anything still slotted onto the dialog itself
  // would be silently dropped by Home Assistant.
  const footer = dialog.querySelector('ha-dialog-footer[slot="footer"]');
  check('buttons are wrapped in ha-dialog-footer[slot="footer"]', !!footer);

  const strandedOnDialog = [...dialog.children].filter(
    (el) =>
      el.tagName.toLowerCase() !== 'ha-dialog-footer' &&
      ['primaryAction', 'secondaryAction'].includes(el.getAttribute('slot')),
  );
  check(
    'no action slotted directly onto ha-dialog',
    strandedOnDialog.length === 0,
    strandedOnDialog.map((el) => `<${el.tagName.toLowerCase()} slot="${el.getAttribute('slot')}">`).join(' '),
  );

  check('dialog carries a non-empty headerTitle', !!dialog.headerTitle);
  check(
    'no legacy heading attribute',
    !dialog.hasAttribute('heading'),
  );
  check(
    'no mwc-button anywhere in the dialog',
    dialog.querySelectorAll('mwc-button').length === 0,
  );

  if (footer) {
    check(
      'close button present in the footer',
      !!footer.querySelector('ha-button[slot="primaryAction"]'),
    );
    check(
      'more-info button present for an entity-bearing zone',
      !!footer.querySelector('ha-button[slot="secondaryAction"]'),
    );
  }
}

process.stdout.write('\nfireEvent → HA more-info\n');
if (dialog) {
  const moreInfo = dialog.querySelector('ha-button[slot="secondaryAction"]');
  if (moreInfo) {
    // fireEvent comes from custom-card-helpers; this is the only place the
    // card calls into that library at runtime, so it is the only automated
    // coverage a major bump of it ever gets.
    let received = null;
    card.addEventListener('hass-more-info', (ev) => {
      received = ev.detail;
    });
    click(moreInfo);
    await card.updateComplete;
    check('clicking more-info fires hass-more-info', !!received);
    check(
      'event carries the zone entity',
      received?.entityId === 'sensor.zone_power',
      `got ${JSON.stringify(received)}`,
    );
    check(
      'dialog closes on more-info',
      !card.shadowRoot.querySelector('ha-dialog'),
    );
  } else {
    check('more-info button reachable', false, 'button missing, cannot test fireEvent');
  }
}

process.stdout.write('\nZone without an entity\n');
const bare = await openDialogTitled(card, 'Bare zone');
check('clicking an entity-less zone still opens a dialog', !!bare);
if (bare) {
  check(
    'no more-info action offered',
    !bare.querySelector('ha-button[slot="secondaryAction"]'),
  );
  check(
    'close button still offered',
    !!bare.querySelector('ha-button[slot="primaryAction"]'),
  );
}

unmountCard(card);

process.stdout.write(
  `\n${checks - failures}/${checks} checks passed\n`,
);
if (failures) {
  process.stdout.write(`${failures} FAILED\n`);
  process.exitCode = 1;
}
