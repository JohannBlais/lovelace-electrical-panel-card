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

// ─── Elastic id boxes (#30) ───────────────────────────────────────────────────
// A box narrower than the id it holds spills text out of both sides, because
// the label is centred. Boxes therefore grow with their text, with the old
// fixed sizes kept as minimums. These checks pin all three outcomes: unchanged
// when short, grown when long, capped-and-elided when absurd — plus the knock-on
// effect that a wider group box has to push its children further right.
process.stdout.write('\nElastic id boxes\n');
const wideConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Wide',
  floors: { Basement: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'Distribution',
      phases: ['L1'],
      circuits: [
        { id: 'Q1', type: 'power', zones: [{ room: 'Short' }] },
        {
          id: 'Kitchen sockets ring final',
          type: 'socket',
          zones: [{ floor: 'Basement', room: 'Long' }],
        },
      ],
    },
    { id: 'S', phases: ['L1'], circuits: [{ id: 'Q2', type: 'power' }] },
  ],
};

// Box geometry behind a given drawn id. The rect is matched by being centred
// on the label rather than by DOM order, which interleaves groups, breakers
// and floor pills.
const boxOfIn = (card, label) => {
  const t = [...card.shadowRoot.querySelectorAll('text')].find(
    (el) => el.textContent.trim() === label && el.getAttribute('font-weight') === 'bold',
  );
  if (!t) return null;
  const cx = parseFloat(t.getAttribute('x'));
  const rect = [...card.shadowRoot.querySelectorAll('rect')].find((r) => {
    const x = parseFloat(r.getAttribute('x'));
    const w = parseFloat(r.getAttribute('width'));
    return Number.isFinite(x) && Number.isFinite(w) && Math.abs(x + w / 2 - cx) < 0.51;
  });
  return rect
    ? { x: parseFloat(rect.getAttribute('x')), w: parseFloat(rect.getAttribute('width')) }
    : null;
};

const wide = await mountCard(wideConfig);
const boxOf = (label) => boxOfIn(wide, label);

// SQ = 24 / CB_SQ = 20 are the floors: a one- or two-character id must render
// at exactly the size it did before this change.
const shortGroup = boxOf('S');
check(
  'short group id keeps the default 24-wide box',
  shortGroup !== null && shortGroup.w === 24,
  `S box = ${JSON.stringify(shortGroup)}`,
);
const shortCircuit = boxOf('Q1');
check(
  'short breaker id keeps the default 20-wide box',
  shortCircuit !== null && shortCircuit.w === 20,
  `Q1 box = ${JSON.stringify(shortCircuit)}`,
);

const longGroup = boxOf('Distribution');
check(
  'long group id widens its box past the default',
  longGroup !== null && longGroup.w > 24,
  `Distribution box = ${JSON.stringify(longGroup)}`,
);

// MAX_BOX_W = 64. Past it the id is elided rather than allowed to shove the
// zone text under the power bubbles, so the full string must be gone from the
// SVG and an ellipsis present in its place.
// Only the drawn <text> nodes — the full id is *expected* in the <title>, and
// svg.textContent would sweep that up too.
const drawnText = [...wide.shadowRoot.querySelectorAll('text')].map((t) =>
  t.textContent.trim(),
);
check(
  'over-long breaker id is elided, not drawn in full',
  !drawnText.includes('Kitchen sockets ring final'),
  drawnText.join(' | '),
);
const elided = [...wide.shadowRoot.querySelectorAll('text')].find((t) =>
  t.textContent.trim().startsWith('Kitchen'),
);
check(
  'elided id ends in an ellipsis',
  !!elided && elided.textContent.trim().endsWith('…'),
  elided ? elided.textContent.trim() : 'no such text node',
);
const elidedBox = elided ? boxOf(elided.textContent.trim()) : null;
check(
  'elided id box stops at the 64 ceiling',
  elidedBox !== null && elidedBox.w === 64,
  `box = ${JSON.stringify(elidedBox)}`,
);

// The full id would otherwise be unrecoverable once elided.
const elidedTitle = elided?.closest('g')?.querySelector('title')?.textContent ?? '';
check(
  'elided id stays readable in the tooltip',
  elidedTitle.includes('Kitchen sockets ring final'),
  elidedTitle || 'no title',
);

// A group box that grew has to push its own breakers right, or the two overlap.
const wideGroupBreaker = boxOf('Q1');
check(
  'breakers clear a widened parent group box',
  longGroup !== null && wideGroupBreaker !== null &&
    wideGroupBreaker.x >= longGroup.x + longGroup.w,
  `Distribution ends at ${longGroup && longGroup.x + longGroup.w}, Q1 starts at ${wideGroupBreaker?.x}`,
);

// Same rule for the floor pill, which had its own hard-coded 20.
const pillText = [...wide.shadowRoot.querySelectorAll('text')].find(
  (t) => t.textContent.trim() === 'Basement',
);
const pillBox = pillText ? boxOf('Basement') : null;
check(
  'long floor name widens its pill',
  pillBox !== null && pillBox.w > 20,
  `Basement pill = ${JSON.stringify(pillBox)}`,
);

unmountCard(wide);

// ─── Board labels (#30) ───────────────────────────────────────────────────────
// `id` stays the short designator drawn in the box; `label` carries the
// human-readable name and is drawn beside it. The label shares its row with the
// connector line out to the power bubble, so that line has to resume *after*
// the text rather than run through it.
process.stdout.write('\nBoard labels\n');
const labelConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Labels',
  groups: [
    {
      id: 'D1',
      label: 'Main board',
      phases: ['L1'],
      sensor: 'sensor.main_power',
      circuits: [
        { id: 'A', label: 'Kitchen sockets', type: 'socket', sensor: 'sensor.kitchen_power' },
        { id: 'B', type: 'light' },
        {
          id: 'C',
          label:
            'An extremely long circuit description that cannot possibly fit on one row',
          type: 'power',
        },
      ],
    },
  ],
};

const labelled = await mountCard(labelConfig);
const textNodes = () => [...labelled.shadowRoot.querySelectorAll('text')];
const labelNode = (starts) =>
  textNodes().find(
    (t) => t.classList.contains('board-label') && t.textContent.trim().startsWith(starts),
  );

check('group label is drawn on the board', !!labelNode('Main board'));
check('circuit label is drawn on the board', !!labelNode('Kitchen sockets'));
check(
  'a circuit without a label draws none',
  textNodes().filter((t) => t.classList.contains('board-label')).length === 3,
  `${textNodes().filter((t) => t.classList.contains('board-label')).length} label nodes`,
);

// Left edge of each label must clear its box, or the text would sit on top of
// the id.
const groupLabelX = labelNode('Main board')
  ? parseFloat(labelNode('Main board').getAttribute('x'))
  : null;
const groupIdBox = boxOfIn(labelled, 'D1');
check(
  'group label starts clear of the group box',
  groupLabelX !== null && groupIdBox !== null && groupLabelX >= groupIdBox.x + groupIdBox.w,
  `box ends at ${groupIdBox && groupIdBox.x + groupIdBox.w}, label at ${groupLabelX}`,
);

// The over-long one must be cut before it reaches the bubbles (LABEL_RIGHT).
const longLabel = labelNode('An extremely long');
check(
  'over-long label is elided',
  !!longLabel && longLabel.textContent.trim().endsWith('…'),
  longLabel ? longLabel.textContent.trim() : 'missing',
);

// Connector line must start after the label, not at the box — otherwise it
// strikes through the text.
const groupConn = labelled.shadowRoot.querySelector('line.bubble-conn[data-ln-for="g-D1"]');
check(
  'bubble connector resumes past the group label',
  !!groupConn && groupLabelX !== null &&
    parseFloat(groupConn.getAttribute('x1')) > groupLabelX,
  groupConn ? `label at ${groupLabelX}, connector from ${groupConn.getAttribute('x1')}` : 'no connector',
);

// An elided label would otherwise be lost; circuitTooltip has to carry it.
const longTitle = longLabel?.closest('g')?.querySelector('title')?.textContent ?? '';
check(
  'elided circuit label stays readable in the tooltip',
  longTitle.includes('An extremely long circuit description'),
  longTitle || 'no title',
);

unmountCard(labelled);

// ─── Zone rows down a deep board (#53) ────────────────────────────────────────
// A zone's room name sits after its floor pill and icon, which move right with
// every nesting level, while its bubble stays in the right-hand column. The
// name used to be drawn whole and its connector to start at a fixed x, so a few
// levels down the connector struck through the name and the name ran under its
// own bubble. One board with zones at depths 0, 2, 3 and 4 covers each stage.
process.stdout.write('\nZone rows down a deep board (#53)\n');

const zoneCircuit = (id, ...rooms) => ({
  id,
  type: 'socket',
  zones: rooms.map((room, j) => ({
    floor: 'L0',
    room,
    sensor: `sensor.${id.toLowerCase()}_${j}_power`,
  })),
});
const deepConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Deep board',
  floors: { L0: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'M',
      phases: ['L1'],
      circuits: [zoneCircuit('A', 'Kitchen')],
      groups: [
        {
          id: 'S1',
          phases: ['L1'],
          groups: [
            {
              id: 'R1',
              phases: ['L1'],
              circuits: [zoneCircuit('B', 'Hall', 'Living room by the bay window')],
              groups: [
                {
                  id: 'S2',
                  phases: ['L1'],
                  circuits: [zoneCircuit('C', 'Workshop bench')],
                  groups: [
                    { id: 'R2', phases: ['L1'], circuits: [zoneCircuit('D', 'Garden shed')] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const deep = await mountCard(deepConfig);
// Everything drawn on one zone row, found from its bubble id.
const zoneRow = (id) => {
  const conn = deep.shadowRoot.querySelector(`line.bubble-conn[data-ln-for="${id}"]`);
  const row = conn?.closest('g');
  const room = row?.querySelector('text.zone-room');
  const icon = row?.querySelector('foreignObject');
  const bg = deep.shadowRoot.querySelector(`rect[data-bg-for="${id}"]`);
  const box = room?.getBBox();
  return {
    connX: conn ? parseFloat(conn.getAttribute('x1')) : NaN,
    roomText: room ? room.textContent.trim() : null,
    roomEnd: box ? box.x + box.width : null,
    iconEnd: icon
      ? parseFloat(icon.getAttribute('x')) + parseFloat(icon.getAttribute('width'))
      : NaN,
    bubbleX: bg ? parseFloat(bg.getAttribute('x')) : NaN,
    tooltip: row?.querySelector('title')?.textContent ?? '',
  };
};
const kitchen = zoneRow('z-M-A-0');
const hall = zoneRow('z-M/S1/R1-B-0');
const living = zoneRow('z-M/S1/R1-B-1');
const workshop = zoneRow('z-M/S1/R1/S2-C-0');
const shed = zoneRow('z-M/S1/R1/S2/R2-D-0');
const zoneDetail = (z) =>
  `"${z.roomText}" ends at ${z.roomEnd?.toFixed(1)}, ` +
  `connector from ${z.connX}, bubble from ${z.bubbleX.toFixed(1)}`;

for (const [depth, z] of [['depth 2', living], ['depth 3', workshop]]) {
  check(
    `a ${depth} room name stops short of its bubble`,
    z.roomEnd !== null && z.roomEnd <= z.bubbleX,
    zoneDetail(z),
  );
  check(
    `a ${depth} connector starts after the room name`,
    z.roomEnd !== null && z.connX >= z.roomEnd,
    zoneDetail(z),
  );
}
check('an over-long room name is elided', !!living.roomText?.endsWith('…'), zoneDetail(living));
check(
  'an elided room name stays readable in the tooltip',
  living.tooltip.includes('Living room by the bay window'),
  living.tooltip || 'no title',
);

// Four levels down there is no room for the name at all before the bubbles.
// It is left to the tooltip, as a board label is, and the connector has to
// clear the icon instead.
check('a room name with no space left is not drawn', shed.roomText === null, zoneDetail(shed));
check(
  'an undrawn room name stays readable in the tooltip',
  shed.tooltip.includes('Garden shed'),
  shed.tooltip || 'no title',
);
check(
  'a connector clears the zone icon',
  shed.connX >= shed.iconEnd,
  `icon ends at ${shed.iconEnd}, connector from ${shed.connX}`,
);

// Names that fit leave their connectors on the shared column — which is every
// zone on a board short of this depth, so those boards draw as before.
check(
  'zones whose names fit keep one connector column',
  kitchen.connX === hall.connX && hall.roomEnd !== null && hall.roomEnd < hall.connX,
  `${zoneDetail(kitchen)}; ${zoneDetail(hall)}`,
);

unmountCard(deep);

// ─── Source summary (#3) ──────────────────────────────────────────────────────
// Groups opting in with `summary: true` are listed above the diagram with their
// live reading. The scenario below is the one from #3: a board reachable by two
// separate mains paths, only one of which carries the house at any moment. The
// card cannot say which — no entity reports the transfer switch position — so
// the table has to make "this one is at zero, that one isn't" readable at a
// glance. That is the assertion that matters here.
process.stdout.write('\nSource summary\n');

// No `type:` on the two mains rows: which types exist is a separate concern,
// and the table keys off `summary`, not off the discriminator.
const summaryConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Sources',
  groups: [
    {
      id: 'ATS',
      label: 'Grid via transfer switch',
      phases: ['L1'],
      accent: '#3182ce',
      sensor: 'sensor.ats_power',
      summary: true,
    },
    {
      id: 'BYP',
      label: 'Grid via inverter bypass',
      phases: ['L1'],
      accent: '#805ad5',
      sensor: 'sensor.bypass_power',
      summary: true,
    },
    {
      id: 'BAT',
      phases: ['L1'],
      accent: '#38a169',
      sensor: 'sensor.battery_power',
      summary: true,
    },
    // Opted in but unmeasured — a misconfiguration that must stay visible
    // rather than drop the row silently.
    { id: 'GEN', label: 'Generator', phases: ['L1'], accent: '#d69e2e', summary: true },
    // Not opted in: present on the board, absent from the table.
    { id: 'D1', phases: ['L1'], sensor: 'sensor.loads_power', circuits: [{ id: 'Q1', type: 'power' }] },
    {
      id: 'INV',
      phases: ['L1'],
      accent: '#dd6b20',
      // Nested and opted in — a PV array behind a sub-board is still a source.
      groups: [
        { id: 'PV', type: 'solar', label: 'Solar via inverter', phases: ['L1'], sensor: 'sensor.pv_power', summary: true },
      ],
    },
  ],
};

// Pinned rather than synthesised: the whole point is the exact readings.
const summaryHass = {
  states: Object.fromEntries(
    [
      ['sensor.ats_power', '0'],
      ['sensor.bypass_power', '2350'],
      ['sensor.battery_power', '-1200'],
      ['sensor.pv_power', '4120'],
      ['sensor.loads_power', '900'],
    ].map(([entity, state]) => [
      entity,
      { entity_id: entity, state, attributes: { unit_of_measurement: 'W' } },
    ]),
  ),
  locale: { language: 'en' },
  themes: { darkMode: false },
  callService: () => Promise.resolve(),
};

const summarised = await mountCard(summaryConfig, { hass: summaryHass });
const table = summarised.shadowRoot.querySelector('table.source-summary');
check('summary table is rendered', !!table);

const summaryRow = (label) =>
  [...(table?.querySelectorAll('tbody tr') ?? [])].find(
    (tr) => tr.querySelector('th')?.textContent.trim() === label,
  );
const rowValue = (label) => summaryRow(label)?.querySelector('td')?.textContent.trim() ?? null;

check(
  'one row per opted-in group, in declaration order',
  [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
    tr.querySelector('th')?.textContent.trim(),
  ).join(' | ') ===
    'Grid via transfer switch | Grid via inverter bypass | BAT | Generator | Solar via inverter',
  [...(table?.querySelectorAll('tbody tr') ?? [])]
    .map((tr) => tr.querySelector('th')?.textContent.trim())
    .join(' | '),
);
check('a group without a label falls back to its id', !!summaryRow('BAT'));
check('a group that did not opt in is absent', !summaryRow('D1'));
check('a nested group can opt in', !!summaryRow('Solar via inverter'));

// The reason the table exists: the dead path reads 0 W next to the live one.
check('an idle source reads zero', rowValue('Grid via transfer switch') === '0 W', rowValue('Grid via transfer switch'));
check('the live path carries the house', rowValue('Grid via inverter bypass') === '2.4 kW', rowValue('Grid via inverter bypass'));
// U+2212, the same minus the bubbles use — an ASCII hyphen here would be a
// second convention for the same thing.
check('a charging battery reads negative', rowValue('BAT') === '−1.2 kW', rowValue('BAT'));
check('a summarised group with no sensor still gets a row', rowValue('Generator') === '—', rowValue('Generator'));

// The dot ties the row to its box below; a nested group inherits its parent's
// accent, so PV must show the inverter's orange rather than a palette pick.
const dotColor = (label) => summaryRow(label)?.querySelector('.source-dot')?.style.background ?? null;
check('the row dot carries the group accent', dotColor('Grid via transfer switch') === 'rgb(49, 130, 206)', dotColor('Grid via transfer switch'));
check(
  'a nested row inherits its parent accent',
  dotColor('Solar via inverter') === 'rgb(221, 107, 32)',
  dotColor('Solar via inverter'),
);

unmountCard(summarised);

// Nothing opted in — the card must not grow an empty header.
const plain = await mountCard(config);
check('no table when no group opts in', !plain.shadowRoot.querySelector('table.source-summary'));
unmountCard(plain);

// ─── Card-level totals in the summary ─────────────────────────────────────────
// `summary: true` on a `sensors.*` reading *moves* it: unlike a group, which
// keeps its box on the board either way, these have no existence beyond their
// bubble, so leaving the bubble behind would recreate the duplication the table
// exists to remove. The bubble going missing is the assertion that matters —
// a row that renders while the old bubble stays put is the failure mode.
process.stdout.write('\nCard-level totals in the summary\n');
const totalsConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Totals',
  sensors: {
    total: { entity: 'sensor.house_total', summary: true },
    grid: { entity: 'sensor.house_net', summary: true },
    phases: {
      l1: { entity: 'sensor.house_l1', summary: true },
      // L2 stays on the board — the two paths must coexist in one config.
      l2: { entity: 'sensor.house_l2' },
    },
  },
  groups: [
    { id: 'PV', label: 'Solaire', type: 'solar', phases: ['L1'], accent: '#d97706', sensor: 'sensor.pv', summary: true },
  ],
};

const totalsHass = {
  states: Object.fromEntries(
    [
      ['sensor.house_total', '2270'],
      ['sensor.house_net', '-1850'],
      ['sensor.house_l1', '640'],
      ['sensor.house_l2', '810'],
      ['sensor.pv', '4120'],
    ].map(([entity, state]) => [
      entity,
      { entity_id: entity, state, attributes: { unit_of_measurement: 'W' } },
    ]),
  ),
  locale: { language: 'en' },
  themes: { darkMode: false },
  callService: () => Promise.resolve(),
};

const totalsCard = await mountCard(totalsConfig, { hass: totalsHass });
const tTable = totalsCard.shadowRoot.querySelector('table.source-summary');
const footRows = [...(tTable?.querySelectorAll('tfoot tr') ?? [])].map((tr) => [
  tr.querySelector('th')?.textContent.trim(),
  tr.querySelector('td')?.textContent.trim(),
]);

check(
  'moved readings land in the foot, in total/grid/phase order',
  footRows.map(([l]) => l).join(' | ') === 'Total | Grid | L1',
  footRows.map(([l]) => l).join(' | '),
);
check('the total carries its value', footRows[0]?.[1] === '2.3 kW', footRows[0]?.[1]);
check('a negative net still reads negative', footRows[1]?.[1] === '−1.9 kW', footRows[1]?.[1]);

// Sources stay in the body, above the rule — the foot is not a dumping ground.
check(
  'source rows stay in the body',
  [...(tTable?.querySelectorAll('tbody tr th') ?? [])].map((th) => th.textContent.trim()).join() ===
    'Solaire',
  [...(tTable?.querySelectorAll('tbody tr th') ?? [])].map((th) => th.textContent.trim()).join(),
);

// The move, asserted from the board's side.
const bubbleIdsPresent = new Set(
  [...totalsCard.shadowRoot.querySelectorAll('text.pwr-value')].map((t) => t.dataset.id),
);
check('the moved total leaves no bubble behind', !bubbleIdsPresent.has('total'), [...bubbleIdsPresent].join(' '));
check('the moved grid leaves no bubble behind', !bubbleIdsPresent.has('grid'), [...bubbleIdsPresent].join(' '));
check('the moved phase leaves no bubble behind', !bubbleIdsPresent.has('phase_l1'), [...bubbleIdsPresent].join(' '));
check('a phase that did not opt in keeps its bubble', bubbleIdsPresent.has('phase_l2'), [...bubbleIdsPresent].join(' '));
check('the group keeps its bubble as well as its row', bubbleIdsPresent.has('g-PV'), [...bubbleIdsPresent].join(' '));

// The label text beside a moved bubble has to go too, or the board keeps a
// caption pointing at nothing.
const boardText = totalsCard.shadowRoot.querySelector('svg').textContent;
check('no orphaned "Total" caption on the board', !boardText.includes('Total'), boardText.slice(0, 120));

// The trunks are the diagram; only the bubble's anchor dot travels with it.
const trunkLines = totalsCard.shadowRoot.querySelectorAll('svg line[stroke-width="3"]');
check('phase trunks are untouched by the move', trunkLines.length === 3, `${trunkLines.length} trunks`);

unmountCard(totalsCard);

// Totals alone, with no group opting in, must still produce the table.
const footOnly = await mountCard({
  type: 'custom:electrical-panel-card',
  title: 'Foot only',
  sensors: { total: { entity: 'sensor.house_total', summary: true } },
  groups: [{ id: 'D1', phases: ['L1'], circuits: [{ id: 'Q1', type: 'power' }] }],
}, { hass: totalsHass });
check(
  'a table with only a foot still renders',
  !!footOnly.shadowRoot.querySelector('table.source-summary tfoot tr'),
);
check(
  'and has no empty body rows',
  footOnly.shadowRoot.querySelectorAll('table.source-summary tbody tr').length === 0,
);
unmountCard(footOnly);

// A caption naming a reading that was never configured, beside an empty
// bubble. Drawn unconditionally until now, and newly visible once a board
// drops `sensors.grid` in favour of a `type: grid` group.
const noMains = await mountCard({
  type: 'custom:electrical-panel-card',
  title: 'No mains sensors',
  groups: [{ id: 'D1', phases: ['L1'], circuits: [{ id: 'Q1', type: 'power' }] }],
});
const noMainsText = noMains.shadowRoot.querySelector('svg').textContent;
check('no "Total" caption when no total is configured', !noMainsText.includes('Total'), noMainsText.slice(0, 80));
check('no "Grid" caption when no grid is configured', !noMainsText.includes('Grid'), noMainsText.slice(0, 80));
// The trunks and their phase labels are the diagram, not a reading.
check('phase labels are still drawn', noMainsText.includes('L1'), noMainsText.slice(0, 80));
unmountCard(noMains);

// ─── Toggling across domains (#43) ────────────────────────────────────────────
// The read path never looks at the domain, so a `light.*` or `input_boolean.*`
// entity renders a toggle showing the correct state. The write path used to
// hardcode `switch.toggle`, which made every one of those a no-op — silently,
// because a service call matching no entity reports nothing back. Nothing here
// asserted the call itself, which is why it shipped. These checks read the
// domain and service off the recorded call rather than trusting the click.
process.stdout.write('\nToggling across domains (#43)\n');

const DOMAINS = ['switch', 'light', 'fan', 'input_boolean', 'cover'];

const recordingHass = (states) => ({
  states,
  locale: { language: 'en' },
  themes: { darkMode: false },
  serviceCalls: [],
  callService(domain, service, data) {
    this.serviceCalls.push({ domain, service, data });
    return Promise.resolve();
  },
});

const toggleConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Toggles',
  floors: { L0: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'D1',
      phases: ['L1'],
      circuits: [
        {
          id: 'A',
          type: 'socket',
          // Each zone carries a reading as well, so the toggle is exercised in
          // the common metered layout; the switch-only one is covered by #45.
          zones: DOMAINS.map((d) => ({
            floor: 'L0',
            room: `${d} load`,
            sensor: `sensor.${d}_power`,
            switch: `${d}.thing`,
          })),
        },
      ],
    },
  ],
};

const toggleHass = recordingHass(
  Object.fromEntries([
    ...DOMAINS.map((d) => [
      `sensor.${d}_power`,
      { entity_id: `sensor.${d}_power`, state: '120', attributes: { unit_of_measurement: 'W' } },
    ]),
    // Alternating, so the pill is exercised in both positions.
    ...DOMAINS.map((d, i) => [
      `${d}.thing`,
      { entity_id: `${d}.thing`, state: i % 2 === 0 ? 'on' : 'off', attributes: {} },
    ]),
  ]),
);

const toggles = await mountCard(toggleConfig, { hass: toggleHass });

for (const [i, d] of DOMAINS.entries()) {
  const hit = toggles.shadowRoot.querySelector(`[data-toggle-hit-for="z-D1-A-${i}"]`);
  if (!hit) {
    check(`${d}.* zone exposes a clickable toggle`, false, 'hit area missing');
    continue;
  }
  toggleHass.serviceCalls.length = 0;
  click(hit);
  await toggles.updateComplete;
  const call = toggleHass.serviceCalls[0];
  check(
    `${d}.* toggle reaches a service that can act on it`,
    !!call && call.domain === 'homeassistant' && call.service === 'toggle',
    call ? `${call.domain}.${call.service}` : 'no service call',
  );
  check(
    `${d}.* toggle targets its own entity`,
    call?.data?.entity_id === `${d}.thing`,
    JSON.stringify(call?.data),
  );
}

// The read path was never domain-bound. Pin that, so a later change to the
// write side cannot quietly narrow it back.
const pillFill = (i) =>
  toggles.shadowRoot.querySelector(`[data-toggle-for="z-D1-A-${i}"]`)?.getAttribute('fill');
check(
  'a non-switch entity reflects its state in the pill',
  !!pillFill(1) && pillFill(1) !== pillFill(0),
  `${pillFill(0)} (on) vs ${pillFill(1)} (off)`,
);

unmountCard(toggles);

// ─── The critical-load gate ───────────────────────────────────────────────────
// `critical: true` puts a confirm() in front of the toggle. It guards freezers
// and sump pumps and shares the method just changed, so both answers are
// pinned. The entity here is a `light.*` on purpose: a relay behind a Switch
// as X helper is exactly the case that used to render this gate and then do
// nothing either way.
process.stdout.write('\nCritical-load confirmation\n');

const criticalConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Critical',
  floors: { L0: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'D1',
      phases: ['L1'],
      circuits: [
        {
          id: 'A',
          type: 'socket',
          zones: [
            {
              floor: 'L0',
              room: 'Freezer',
              sensor: 'sensor.freezer_power',
              switch: 'light.freezer_relay',
              critical: true,
            },
          ],
        },
      ],
    },
  ],
};

const criticalHass = recordingHass({
  'sensor.freezer_power': {
    entity_id: 'sensor.freezer_power',
    state: '90',
    attributes: { unit_of_measurement: 'W' },
  },
  'light.freezer_relay': { entity_id: 'light.freezer_relay', state: 'on', attributes: {} },
});

const critical = await mountCard(criticalConfig, { hass: criticalHass });
const criticalHit = critical.shadowRoot.querySelector('[data-toggle-hit-for="z-D1-A-0"]');

const realConfirm = globalThis.confirm;
let asked = null;
globalThis.confirm = (msg) => {
  asked = msg;
  return false;
};
click(criticalHit);
await critical.updateComplete;
check(
  'a refused confirmation calls no service',
  criticalHass.serviceCalls.length === 0,
  JSON.stringify(criticalHass.serviceCalls),
);
check('the prompt names the load', (asked ?? '').includes('Freezer'), asked ?? 'never asked');

globalThis.confirm = () => true;
click(criticalHit);
await critical.updateComplete;
check(
  'an accepted confirmation toggles it, domain and all',
  criticalHass.serviceCalls.length === 1 &&
    criticalHass.serviceCalls[0].domain === 'homeassistant' &&
    criticalHass.serviceCalls[0].data.entity_id === 'light.freezer_relay',
  JSON.stringify(criticalHass.serviceCalls),
);
globalThis.confirm = realConfirm;
unmountCard(critical);

// ─── A switch with no sensor (#45) ────────────────────────────────────────────
// The toggle is drawn by the power bubble, and the bubble used to be gated on
// `sensor` — so a `switch` on its own was accepted and rendered nothing, at all
// three levels. The realistic case is a load with nothing to measure: a
// contactor, a relay, a plug without metering. Each level is asserted through
// the recorded service call, and the connector is checked to reach the toggle,
// since without a reading beside it a toggle is otherwise tied to no row.
process.stdout.write('\nA switch with no sensor (#45)\n');

const switchOnlyConfig = {
  type: 'custom:electrical-panel-card',
  title: 'Switch only',
  floors: { L0: { bg: '#38a169', fg: 'white' } },
  groups: [
    {
      id: 'D1',
      phases: ['L1'],
      switch: 'switch.main_contactor',
      circuits: [
        {
          id: 'A',
          type: 'socket',
          switch: 'switch.circuit_a',
          zones: [
            { floor: 'L0', room: 'Zone B', switch: 'switch.plug_b' },
            { floor: 'L0', room: 'Zone C', sensor: 'sensor.plug_c_power', switch: 'switch.plug_c' },
            { floor: 'L0', room: 'Zone D', sensor: 'sensor.plug_d_power', switch: 'switch.plug_d' },
            { floor: 'L0', room: 'Zone E' },
          ],
        },
      ],
    },
  ],
};

const switchOnlyHass = recordingHass({
  'switch.main_contactor': { entity_id: 'switch.main_contactor', state: 'on', attributes: {} },
  'switch.circuit_a': { entity_id: 'switch.circuit_a', state: 'off', attributes: {} },
  'switch.plug_b': { entity_id: 'switch.plug_b', state: 'on', attributes: {} },
  'switch.plug_c': { entity_id: 'switch.plug_c', state: 'on', attributes: {} },
  'switch.plug_d': { entity_id: 'switch.plug_d', state: 'on', attributes: {} },
  'sensor.plug_c_power': {
    entity_id: 'sensor.plug_c_power',
    state: '120',
    attributes: { unit_of_measurement: 'W' },
  },
  // Configured but not reporting: the one state that already drew a toggle
  // with no reading beside it before #45, and so shares its connector rule.
  'sensor.plug_d_power': {
    entity_id: 'sensor.plug_d_power',
    state: 'unavailable',
    attributes: {},
  },
});

const switchOnly = await mountCard(switchOnlyConfig, { hass: switchOnlyHass });
const q = (sel) => switchOnly.shadowRoot.querySelector(sel);

const LEVELS = [
  ['group', 'g-D1', 'switch.main_contactor'],
  ['circuit', 'c-D1-A', 'switch.circuit_a'],
  ['zone', 'z-D1-A-0', 'switch.plug_b'],
];

for (const [level, id, entity] of LEVELS) {
  const hit = q(`[data-toggle-hit-for="${id}"]`);
  if (!hit) {
    check(`a ${level} with only a switch renders a toggle`, false, 'hit area missing');
    continue;
  }
  switchOnlyHass.serviceCalls.length = 0;
  click(hit);
  await switchOnly.updateComplete;
  const call = switchOnlyHass.serviceCalls[0];
  check(
    `a ${level} with only a switch toggles its entity`,
    !!call && call.service === 'toggle' && call.data?.entity_id === entity,
    call ? `${call.domain}.${call.service} ${JSON.stringify(call.data)}` : 'no service call',
  );
  // No sensor means no figure to show — a placeholder like "0 W" would be a
  // reading the installation does not have.
  check(
    `a ${level} with only a switch shows no reading`,
    (q(`text.pwr-value[data-id="${id}"]`)?.textContent ?? '').trim() === '' &&
      q(`rect[data-bg-for="${id}"]`)?.getAttribute('visibility') === 'hidden',
    q(`text.pwr-value[data-id="${id}"]`)?.textContent,
  );
}

// The connector runs from the row to the toggle's own left edge, at the height
// of its centre — a wire into the switch rather than a line ending in the air.
const connectorReachesToggle = (id) => {
  const ln = q(`line[data-ln-for="${id}"]`);
  const tog = q(`rect[data-toggle-for="${id}"]`);
  if (!ln || !tog) return { ok: false, detail: `line ${!!ln}, toggle ${!!tog}` };
  const midY = parseFloat(tog.getAttribute('y')) + parseFloat(tog.getAttribute('height')) / 2;
  const ok =
    ln.getAttribute('visibility') === 'visible' &&
    parseFloat(ln.getAttribute('x2')) === parseFloat(tog.getAttribute('x')) &&
    parseFloat(ln.getAttribute('y1')) === midY &&
    parseFloat(ln.getAttribute('y2')) === midY;
  return {
    ok,
    detail: `visibility=${ln.getAttribute('visibility')} x2=${ln.getAttribute('x2')} ` +
      `y=${ln.getAttribute('y1')}/${ln.getAttribute('y2')}, toggle x=${tog.getAttribute('x')} mid=${midY}`,
  };
};
for (const [level, id] of LEVELS) {
  const { ok, detail } = connectorReachesToggle(id);
  check(`a ${level} with only a switch is wired to its toggle`, ok, detail);
}
{
  const { ok, detail } = connectorReachesToggle('z-D1-A-2');
  check('an unavailable sensor keeps the toggle wired to its row', ok, detail);
}

// Neighbours unchanged: a metered zone keeps its reading and its bubble, and a
// zone with neither key still draws no bubble at all.
check(
  'a zone with sensor and switch still shows its reading',
  q('text.pwr-value[data-id="z-D1-A-1"]')?.textContent.trim() === '120 W' &&
    q('rect[data-bg-for="z-D1-A-1"]')?.getAttribute('visibility') === 'visible',
  q('text.pwr-value[data-id="z-D1-A-1"]')?.textContent,
);
check(
  'a zone with neither sensor nor switch draws no bubble',
  !q('[data-id="z-D1-A-3"]') && !q('[data-toggle-for="z-D1-A-3"]'),
);

// More-info from the metadata dialog falls back to the switch, as the zone
// dialog already did — otherwise a switch-only group or circuit offers none.
for (const [title, entity] of [
  ['RCD D1', 'switch.main_contactor'],
  ['Circuit A', 'switch.circuit_a'],
]) {
  const dlg = await openDialogTitled(switchOnly, title);
  const moreInfo = dlg?.querySelector('ha-button[slot="secondaryAction"]');
  if (!moreInfo) {
    check(`"${title}" dialog offers more-info for its switch`, false, dlg ? 'button missing' : 'dialog missing');
    continue;
  }
  let received = null;
  const listener = (ev) => {
    received = ev.detail;
  };
  switchOnly.addEventListener('hass-more-info', listener);
  click(moreInfo);
  await switchOnly.updateComplete;
  switchOnly.removeEventListener('hass-more-info', listener);
  check(
    `"${title}" dialog offers more-info for its switch`,
    received?.entityId === entity,
    `got ${JSON.stringify(received)}`,
  );
}

unmountCard(switchOnly);


process.stdout.write(
  `\n${checks - failures}/${checks} checks passed\n`,
);
if (failures) {
  process.stdout.write(`${failures} FAILED\n`);
  process.exitCode = 1;
}
