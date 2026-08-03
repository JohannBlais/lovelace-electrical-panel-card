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

// ─── Nested groups ────────────────────────────────────────────────────────────
// A sub-board dropped from the render would fail silently: the card still
// produces a valid SVG, just without that whole branch. These checks assert
// the branch is there, is indented (not flattened onto the parent's column),
// and that path-scoped ids keep bubbles apart when a breaker letter is reused
// between the parent board and the nested one.
process.stdout.write('\nNested groups\n');
const nestedConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Nested',
  floors: { L0: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'P',
      phases: ['L1', 'L2'],
      circuits: [
        {
          id: 'A',
          type: 'power',
          sensor: 'sensor.parent_a_power',
          zones: [{ floor: 'L0', room: 'Parent load' }],
        },
      ],
      groups: [
        {
          id: 'R1',
          phases: ['L1'],
          mA: 30,
          mm2: 10,
          cond: 3,
          sensor: 'sensor.subboard_power',
          circuits: [
            {
              id: 'A',
              type: 'socket',
              sensor: 'sensor.nested_a_power',
              zones: [{ floor: 'L0', room: 'Nested load' }],
            },
          ],
        },
      ],
    },
  ],
};

const nested = await mountCard(nestedConfig);
const svgText = nested.shadowRoot.querySelector('svg').textContent;
check('nested group box is rendered', svgText.includes('R1'));
check('nested group circuit is rendered', svgText.includes('Nested load'));

// Box x positions: the nested group must sit one indent step right of its
// parent, and its own breaker further right again.
const boxX = (label) => {
  const text = [...nested.shadowRoot.querySelectorAll('text')].find(
    (t) => t.textContent.trim() === label && t.getAttribute('font-weight') === 'bold',
  );
  return text ? parseFloat(text.getAttribute('x')) : null;
};
const parentBoxX = boxX('P');
const subBoxX = boxX('R1');
check(
  'nested group is indented past its parent',
  parentBoxX !== null && subBoxX !== null && subBoxX > parentBoxX,
  `P at x=${parentBoxX}, R1 at x=${subBoxX}`,
);

// Reused breaker letter across the two boards — path-scoped ids must keep the
// two bubbles distinct, or one would size itself from the other's bbox.
const bubbleIds = [...nested.shadowRoot.querySelectorAll('text.pwr-value')].map(
  (t) => t.dataset.id,
);
check(
  'reused circuit ids yield distinct bubble ids',
  new Set(bubbleIds).size === bubbleIds.length,
  bubbleIds.join(' '),
);
check(
  'nested group bubble is present',
  bubbleIds.includes('g-P/R1'),
  bubbleIds.join(' '),
);

// Sub-boards render above the parent's own breakers. Bubble ids are the
// unambiguous handle here — both boards have a circuit labelled "A", so
// matching on the drawn text would pick whichever came first in the DOM.
const bubbleY = (id) => {
  const t = nested.shadowRoot.querySelector(`text.pwr-value[data-id="${id}"]`);
  return t ? parseFloat(t.getAttribute('y')) : null;
};
const subY = bubbleY('g-P/R1');
const ownCircuitY = bubbleY('c-P-A');
check(
  'nested group renders above the parent own circuits',
  subY !== null && ownCircuitY !== null && subY < ownCircuitY,
  `R1 at y=${subY}, P/A at y=${ownCircuitY}`,
);

const nestedDialog = await openDialogTitled(nested, 'RCD R1');
check('clicking a nested group opens its dialog', !!nestedDialog);
if (nestedDialog) {
  // Feed-cable metadata is group-level; a missing row here means the field
  // was declared in the type but never wired into the dialog.
  const table = nestedDialog.querySelector('table.meta-table')?.textContent ?? '';
  check('group dialog lists the feed cross-section', table.includes('10 mm²'), table);
  check('group dialog lists the conductor count', table.includes('Conductors'), table);
}

unmountCard(nested);

process.stdout.write(
  `\n${checks - failures}/${checks} checks passed\n`,
);
if (failures) {
  process.stdout.write(`${failures} FAILED\n`);
  process.exitCode = 1;
}
