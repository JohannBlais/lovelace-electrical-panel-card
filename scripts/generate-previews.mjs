#!/usr/bin/env node
// Generate preview SVGs for each YAML config in `examples/` by loading the
// real card bundle inside jsdom, feeding it a synthetic `hass`, and extracting
// the rendered SVG. The output reflects the exact same code paths as the live
// card — same layout maths, same icon resolution, same saturation gauge.
//
// Usage: `npm run generate-previews`
//
// The script also doubles as a sanity test: if the renderer throws or yields
// nothing, the generator fails. A future commit can add snapshot diffing for
// visual regression coverage.

import { load as loadYaml } from 'js-yaml';
import * as mdiIcons from '@mdi/js';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// jsdom window, globals, getBBox stubs, the loaded bundle and the mock-hass
// builder all live in the shared harness — see scripts/lib/card-harness.mjs.
import {
  root,
  document,
  fontFor,
  mountCard,
  unmountCard,
} from './lib/card-harness.mjs';

const examplesDir = resolve(root, 'examples');
const assetsDir = resolve(root, 'assets');

if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

// ─── ha-icon → inline MDI path replacement ────────────────────────────────────
// jsdom doesn't render <ha-icon> (it's a HA frontend element). For the static
// preview we replace each foreignObject containing an <ha-icon icon="mdi:xxx">
// with a real <svg><path d="…"/></svg> using the path data shipped by @mdi/js.
function mdiName(slug) {
  // 'mdi:solar-power' → 'mdiSolarPower'
  return (
    'mdi' +
    slug
      .replace(/^mdi:/, '')
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('')
  );
}

// ─── Stylesheet drift guard ───────────────────────────────────────────────────
// The stylesheet inlined in renderExample is a hand-maintained mirror of the
// card's own CSS. It has to be hand-maintained: the card styles through
// `var(--token, fallback)`, and a static SVG viewed outside Home Assistant has
// no theme to resolve those against, so concrete colours are written out here.
//
// The failure mode is silent. Add a class to the card, forget this copy, and
// the shape renders with the SVG default — black — while every test still
// passes, because the card itself is styled correctly and only the baked
// preview is wrong. That is exactly how `.board-label` first shipped black in
// #30. So: fail the build rather than the eye.
//
// Two classes carry no rule on purpose:
//   - `meta-target` groups click targets and paints nothing
//   - `pwr-value` takes its colour from an inline `fill` (the group accent)
const UNSTYLED_BY_DESIGN = new Set(['meta-target', 'pwr-value']);

function assertEveryClassIsStyled(svgEl, styleText) {
  const styled = new Set(
    [...styleText.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]),
  );
  const missing = new Set();
  for (const el of svgEl.querySelectorAll('[class]')) {
    for (const name of (el.getAttribute('class') ?? '').split(/\s+/)) {
      if (name && !styled.has(name) && !UNSTYLED_BY_DESIGN.has(name)) {
        missing.add(name);
      }
    }
  }
  if (missing.size) {
    throw new Error(
      `Classes present in the generated SVG with no rule in the inlined ` +
        `stylesheet: ${[...missing].sort().join(', ')}. Mirror the rule from ` +
        `src/electrical-panel-card.ts into the style block in this file, or ` +
        `add it to UNSTYLED_BY_DESIGN if it genuinely paints nothing.`,
    );
  }
}

// ─── <text> → <path> conversion (bake Roboto outlines into the SVG) ──────────
// Walks every <text> in the SVG and replaces it with a <path d="…"/> using
// the actual Roboto glyph outlines. The result renders identically in any
// SVG viewer, with no font dependency. Class / opacity / fill attributes are
// preserved so the existing inline stylesheet still applies.
// SVG `dominant-baseline` lets `<text>` callers reposition the baseline
// relative to the y attribute. opentype.js always treats y as the
// alphabetic baseline, so we have to compensate ourselves — otherwise
// labels that should be vertically centred next to icons (zone names,
// floor pills) end up shifted upward by ~0.34 × fontSize.
function baselineShiftFor(font, fontSize, dominantBaseline) {
  if (!dominantBaseline) return 0;
  const ascender = font.ascender; // positive font units, top of em
  const descender = font.descender; // negative font units, below baseline
  const upm = font.unitsPerEm;
  const halfHeight = (ascender + descender) / 2 / upm;
  switch (dominantBaseline) {
    case 'central':
    case 'middle':
      // y currently marks the visual centre — shift baseline down so the
      // glyph sits centred on y.
      return halfHeight * fontSize;
    case 'hanging':
    case 'text-before-edge':
      return (ascender / upm) * fontSize;
    case 'ideographic':
    case 'text-after-edge':
      return (descender / upm) * fontSize;
    default:
      return 0;
  }
}

function textToPaths(svgEl) {
  const texts = svgEl.querySelectorAll('text');
  for (const text of texts) {
    const content = text.textContent ?? '';
    if (!content.trim()) {
      text.remove();
      continue;
    }
    const fontSize = parseFloat(text.getAttribute('font-size') ?? '10');
    const fontWeight = text.getAttribute('font-weight');
    const anchor = text.getAttribute('text-anchor') ?? 'start';
    const dominantBaseline = text.getAttribute('dominant-baseline');
    const x = parseFloat(text.getAttribute('x') ?? '0');
    const y = parseFloat(text.getAttribute('y') ?? '0');
    const font = fontFor(fontWeight);
    const advance = font.getAdvanceWidth(content, fontSize);
    const offsetX =
      anchor === 'end' ? -advance : anchor === 'middle' ? -advance / 2 : 0;
    const offsetY = baselineShiftFor(font, fontSize, dominantBaseline);
    const path = font.getPath(content, x + offsetX, y + offsetY, fontSize);
    const d = path.toPathData(1);

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', d);
    // Preserve presentation attributes that the card might have set on the
    // text. Anything covered by CSS classes carries over as-is.
    for (const attr of ['class', 'fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-width']) {
      const v = text.getAttribute(attr);
      if (v != null) pathEl.setAttribute(attr, v);
    }
    text.replaceWith(pathEl);
  }
}

function replaceHaIcons(svgEl) {
  const fos = svgEl.querySelectorAll('foreignObject');
  for (const fo of fos) {
    const haIcon = fo.querySelector('ha-icon');
    const slug = haIcon?.getAttribute('icon') ?? '';
    const exportName = mdiName(slug);
    const pathData = mdiIcons[exportName];
    if (!pathData) {
      // Unknown icon — leave a small empty placeholder.
      continue;
    }
    const x = fo.getAttribute('x');
    const y = fo.getAttribute('y');
    const w = fo.getAttribute('width');
    const h = fo.getAttribute('height');
    // Build replacement: nested <svg> at the foreignObject's position with
    // a <path> using the MDI data, filled with the secondary text colour.
    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrapper.setAttribute('x', x);
    wrapper.setAttribute('y', y);
    wrapper.setAttribute('width', w);
    wrapper.setAttribute('height', h);
    wrapper.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'var(--secondary-text-color, #718096)');
    wrapper.appendChild(path);
    fo.replaceWith(wrapper);
  }
}

// ─── Render one example to SVG ────────────────────────────────────────────────
async function renderExample(yamlPath) {
  const config = loadYaml(readFileSync(yamlPath, 'utf-8'));
  const card = await mountCard(config);

  const svg = card.shadowRoot?.querySelector('svg');
  if (!svg) {
    unmountCard(card);
    throw new Error(`No SVG produced for ${yamlPath}`);
  }
  // Inline the MDI icon paths so the SVG renders standalone (without HA).
  replaceHaIcons(svg);
  // Bake every <text> into <path> outlines using the real Roboto font. This
  // removes the dependency on the Roboto webfont being available wherever
  // the SVG ends up displayed (GitHub camo, librsvg, ImageMagick, mobile
  // browsers) — what you see is exactly what HA shows in a live dashboard.
  textToPaths(svg);
  // Inline a minimal stylesheet so themes aren't required for the static
  // SVG to look right outside Home Assistant. Mirrors the card's CSS for
  // the elements that survive in the saved markup. No font-family rule
  // needed: text has been baked into <path> outlines.
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .bubble-bg { fill: #ffffff; stroke: #e2e8f0; stroke-width: 0.7; }
    .bubble-conn { stroke: #cbd5e0; stroke-width: 0.5; }
    .label-secondary, .zone-room, .board-label { fill: #718096; }
    .phase-label { fill: #1a202c; }
    .sat-track { fill: #e2e8f0; opacity: 0.5; }
  `;
  svg.insertBefore(style, svg.firstChild);
  assertEveryClassIsStyled(svg, style.textContent);
  // Ensure xmlns attribute (jsdom strips it on serialization sometimes).
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Clean up
  unmountCard(card);
  // Strip Lit's part-marker comments (`<!--?lit$NNNNNNNNN$-->` and the
  // empty `<!---->` placeholders). They're internal to Lit's reactive
  // bookkeeping and embed a per-build hash — leaving them in causes the
  // CI drift check to flap on every rebuild even when nothing visible
  // changed. The empty-comment trail is also gone-after-rendering noise.
  const cleaned = svg.outerHTML
    .replace(/<!--\?lit\$\d+\$-->/g, '')
    .replace(/<!---->/g, '');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + cleaned + '\n';
}

// ─── Run for every YAML in examples/ ──────────────────────────────────────────
const yamlFiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.yaml'))
  .sort();

for (const file of yamlFiles) {
  const yamlPath = resolve(examplesDir, file);
  const outName = `preview-${basename(file, '.yaml')}.svg`;
  const outPath = resolve(assetsDir, outName);
  process.stdout.write(`Generating ${outName} … `);
  try {
    const svg = await renderExample(yamlPath);
    writeFileSync(outPath, svg);
    process.stdout.write(`ok (${(svg.length / 1024).toFixed(1)} KiB)\n`);
  } catch (err) {
    process.stdout.write(`FAILED\n`);
    console.error(err);
    process.exitCode = 1;
  }
}
