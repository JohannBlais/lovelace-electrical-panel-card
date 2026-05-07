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

import { JSDOM } from 'jsdom';
import { load as loadYaml } from 'js-yaml';
import * as mdiIcons from '@mdi/js';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), '..');
const examplesDir = resolve(root, 'examples');
const assetsDir = resolve(root, 'assets');

if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

// ─── jsdom setup ──────────────────────────────────────────────────────────────
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;
const { document } = window;

// Expose enough globals for Lit + the bundled card.
// Mirror most browser globals from jsdom into Node so the bundled card can
// load. The bundle touches `Document.prototype`, `Object.defineProperty`,
// shadow DOM APIs, etc.
const globalNames = [
  'window', 'document', 'navigator',
  'customElements', 'HTMLElement', 'Element', 'Node', 'NodeFilter',
  'ShadowRoot', 'DocumentFragment', 'Document', 'MutationObserver',
  'CSSStyleSheet', 'CustomEvent', 'Event',
  'SVGElement', 'SVGGraphicsElement', 'SVGTextElement', 'SVGSVGElement',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
];
for (const name of globalNames) {
  if (name in globalThis) continue;
  const value = name === 'window' ? window : window[name] ?? dom.window[name];
  if (value === undefined) continue;
  globalThis[name] = typeof value === 'function' && value.bind ? value : value;
}
// rAF / cAF need binding so jsdom's internal `this` is preserved.
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

// jsdom doesn't compute SVG layout. Stub `getBBox` on every relevant
// prototype so the live card's `updated()` lifecycle can size the bubble
// backgrounds the same way it does in a real browser. The patch goes on
// SVGGraphicsElement / SVGTextElement / SVGElement / Element so it lands
// regardless of which class jsdom hangs the instance off — they don't
// always share the parent we'd expect from the spec.
function bboxStub() {
  const tag = this.tagName?.toLowerCase?.();
  if (tag === 'text') {
    const text = (this.textContent ?? '').trim();
    const fontSize = parseFloat(this.getAttribute('font-size') ?? '10');
    const anchor = this.getAttribute('text-anchor') ?? 'start';
    // ~0.55 × fontSize per character — a passable sans-serif approximation.
    const width = text.length * fontSize * 0.55;
    const height = fontSize * 1.0;
    const x = parseFloat(this.getAttribute('x') ?? '0');
    const y = parseFloat(this.getAttribute('y') ?? '0');
    const left =
      anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    return { x: left, y: y - height * 0.8, width, height };
  }
  return { x: 0, y: 0, width: 0, height: 0 };
}
for (const proto of [
  window.SVGGraphicsElement?.prototype,
  window.SVGTextElement?.prototype,
  window.SVGElement?.prototype,
  window.Element?.prototype,
]) {
  if (proto) proto.getBBox = bboxStub;
}

// ─── Load the bundled card (registers <electrical-panel-card>) ────────────────
const bundlePath = resolve(root, 'dist/electrical-panel-card.js');
if (!existsSync(bundlePath)) {
  throw new Error(`Bundle not found at ${bundlePath}. Run 'npm run build' first.`);
}
await import(pathToFileURL(bundlePath).href);

// ─── Mock hass builder ────────────────────────────────────────────────────────
function collectEntities(config) {
  const set = new Set();
  const s = config.sensors ?? {};
  [
    s.total?.entity,
    s.grid?.entity,
    s.phases?.l1?.entity,
    s.phases?.l2?.entity,
    s.phases?.l3?.entity,
  ].forEach((e) => e && set.add(e));
  for (const g of config.groups ?? []) {
    if (g.sensor) set.add(g.sensor);
    if (g.switch) set.add(g.switch);
    for (const c of g.circuits ?? []) {
      if (c.sensor) set.add(c.sensor);
      if (c.switch) set.add(c.switch);
      for (const z of c.zones ?? []) {
        if (z.sensor) set.add(z.sensor);
        if (z.switch) set.add(z.switch);
      }
    }
  }
  return [...set];
}

// Deterministic synthetic state values. Hash entity name → 0..1, scale per
// kind so totals look plausible without random noise (same input → same SVG).
function hashf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 1000) / 1000;
}

function syntheticPower(entity) {
  const r = hashf(entity);
  if (entity.includes('production') || entity.includes('inverter') || entity.includes('solar')) {
    // PV production — negative or large positive
    return -Math.round(800 + r * 4000);
  }
  if (entity.includes('total')) return Math.round(1500 + r * 2500);
  if (entity.includes('grid') || entity.includes('net')) return Math.round(-1500 + r * 3000);
  if (entity.includes('phase') || /_l[123]\b/.test(entity)) return Math.round(400 + r * 1200);
  if (entity.includes('heat_pump') || entity.includes('cooktop')) return Math.round(800 + r * 2200);
  // Generic load
  return Math.round(50 + r * 800);
}

function syntheticSwitch(entity) {
  return hashf(entity) > 0.5 ? 'on' : 'off';
}

function buildMockHass(config) {
  const states = {};
  for (const entity of collectEntities(config)) {
    if (entity.startsWith('sensor.')) {
      const value = syntheticPower(entity);
      states[entity] = {
        entity_id: entity,
        state: String(value),
        attributes: { unit_of_measurement: 'W', friendly_name: entity },
      };
    } else if (entity.startsWith('switch.')) {
      states[entity] = {
        entity_id: entity,
        state: syntheticSwitch(entity),
        attributes: { friendly_name: entity },
      };
    } else {
      states[entity] = {
        entity_id: entity,
        state: 'unknown',
        attributes: {},
      };
    }
  }
  return {
    states,
    locale: { language: 'en' },
    themes: { darkMode: false },
    callService: () => Promise.resolve(),
  };
}

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
  const card = document.createElement('electrical-panel-card');
  card.hass = buildMockHass(config);
  card.setConfig(config);
  document.body.appendChild(card);
  // Wait for Lit's update cycle. updated() runs synchronously after render
  // in Lit 3, so two microtask ticks usually suffice.
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 20));

  const svg = card.shadowRoot?.querySelector('svg');
  if (!svg) {
    document.body.removeChild(card);
    throw new Error(`No SVG produced for ${yamlPath}`);
  }
  // Inline the MDI icon paths so the SVG renders standalone (without HA).
  replaceHaIcons(svg);
  // Inline a minimal stylesheet so themes aren't required for the static
  // SVG to look right outside Home Assistant. Mirrors the card's CSS for
  // the elements that survive in the saved markup, and forces a font-family
  // chain that lands on Roboto (HA's default) when available, or a
  // close-enough system sans-serif everywhere else.
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    svg {
      font-family: 'Roboto', system-ui, -apple-system, BlinkMacSystemFont,
        'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    }
    .bubble-bg { fill: #ffffff; stroke: #e2e8f0; stroke-width: 0.7; }
    .bubble-conn { stroke: #cbd5e0; stroke-width: 0.5; }
    .label-secondary, .zone-room { fill: #718096; }
    .phase-label { fill: #1a202c; }
    .sat-track { fill: #e2e8f0; opacity: 0.5; }
  `;
  svg.insertBefore(style, svg.firstChild);
  // Ensure xmlns attribute (jsdom strips it on serialization sometimes).
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Clean up
  document.body.removeChild(card);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML + '\n';
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
