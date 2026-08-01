// Shared jsdom harness for the scripts that drive the real card bundle outside
// a browser. Extracted from generate-previews.mjs so the smoke test can reuse
// it rather than keep a second copy of the globals/getBBox/mock-hass setup in
// sync by hand.
//
// Importing this module has side effects by design: it builds a jsdom window,
// mirrors the globals the bundle touches, patches getBBox, and imports
// dist/electrical-panel-card.js (which registers the custom element). Node's
// module cache keeps that to once per process.

import { JSDOM } from 'jsdom';
import opentype from 'opentype.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const root = resolve(dirname(__filename), '..', '..');

// ─── Roboto fonts (parsed once) ───────────────────────────────────────────────
// Needed here rather than in the caller because getBBox is stubbed with real
// Roboto metrics — the card's updated() hook sizes bubble backgrounds from it.
function loadFont(rel) {
  const buf = readFileSync(resolve(root, rel));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const robotoRegular = loadFont('node_modules/roboto-fontface/fonts/roboto/Roboto-Regular.woff');
const robotoMedium = loadFont('node_modules/roboto-fontface/fonts/roboto/Roboto-Medium.woff');

export function fontFor(weight) {
  const w = String(weight ?? '').toLowerCase();
  if (w === 'bold' || w === '500' || w === '600' || w === '700' || w === 'bolder') {
    return robotoMedium;
  }
  return robotoRegular;
}

// ─── jsdom setup ──────────────────────────────────────────────────────────────
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
export const { window } = dom;
export const { document } = window;

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
// Modern Node ships its own Event / CustomEvent globals. Those are *not*
// interchangeable with jsdom's: jsdom's dispatchEvent brand-checks its
// argument and rejects an event built from Node's class with "parameter 1 is
// not of type 'Event'". custom-card-helpers' fireEvent constructs a
// CustomEvent from whatever is global, so leaving Node's in place makes every
// fireEvent call throw here while working fine in a real browser. Force
// jsdom's versions to win.
const forceFromJsdom = new Set(['Event', 'CustomEvent']);

for (const name of globalNames) {
  if (name in globalThis && !forceFromJsdom.has(name)) continue;
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
    const fontWeight = this.getAttribute('font-weight');
    const anchor = this.getAttribute('text-anchor') ?? 'start';
    // Use real Roboto metrics so bubble background sizes (computed via
    // getBBox in the card's updated() hook) match the glyphs we'll bake
    // into <path> elements at the end. A naïve `length × 0.55` factor
    // would leave bubbles slightly wider/narrower than the text inside.
    const font = fontFor(fontWeight);
    const width = font.getAdvanceWidth(text, fontSize);
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

// `npm run build:dev` writes to dist/ as well, and that bundle registers
// itself as `electrical-panel-card-dev`. Without this check the failure
// surfaces much later as a bare "card.setConfig is not a function", which
// says nothing about the actual cause.
if (!window.customElements.get('electrical-panel-card')) {
  const dev = window.customElements.get('electrical-panel-card-dev');
  throw new Error(
    dev
      ? `${bundlePath} is a DEV build (registers electrical-panel-card-dev). ` +
        `Run 'npm run build' to restore the normally-tagged bundle.`
      : `${bundlePath} did not register <electrical-panel-card>.`,
  );
}

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

export function buildMockHass(config) {
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

// ─── Mount a configured card and wait for its first render ────────────────────
export async function mountCard(config, { hass } = {}) {
  const card = document.createElement('electrical-panel-card');
  card.hass = hass ?? buildMockHass(config);
  card.setConfig(config);
  document.body.appendChild(card);
  // Wait for Lit's update cycle. updated() runs synchronously after render
  // in Lit 3, so two microtask ticks usually suffice.
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 20));
  return card;
}

export function unmountCard(card) {
  if (card.parentNode) card.parentNode.removeChild(card);
}
