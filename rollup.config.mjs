import { existsSync } from 'node:fs';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const dev = process.env.ROLLUP_WATCH === 'true';

// DEV_TAG=1 builds a bundle that registers itself under distinct custom-element
// names, so it can live in Home Assistant next to the released (HACS) build
// instead of racing it for `electrical-panel-card`. Whichever script loaded
// second would otherwise lose its customElements.define() call silently, and
// you would be testing an unpredictable one of the two.
//
// The suffix is applied to every identity constant in src/const.ts, which is
// the single place the tags, the card-picker entry and the console banner all
// come from — so the dev build is unambiguous everywhere it surfaces.
const devTag = !!process.env.DEV_TAG;

const devTagSuffix = () => ({
  name: 'dev-tag-suffix',
  transform(code, id) {
    if (!devTag || !/[\\/]const\.ts$/.test(id)) return null;
    const suffixed = code
      .replace(/(export const CARD_TAG = ')([^']+)'/, "$1$2-dev'")
      .replace(/(export const EDITOR_TAG = ')([^']+)'/, "$1$2-dev'")
      .replace(/(export const CARD_NAME = ')([^']+)'/, "$1$2 (dev)'")
      .replace(/(export const CARD_VERSION = ')([^']+)'/, "$1$2-dev'");
    // A silent no-op here would ship a dev build that collides anyway, which is
    // exactly the failure this flag exists to prevent.
    if (suffixed === code) {
      this.error('[rollup] DEV_TAG is set but no identity constant matched in src/const.ts');
    }
    return { code: suffixed, map: null };
  },
});

// Dev mirror: drop the bundle into a dedicated subfolder under Home Assistant's
// www/, mirroring the per-card layout HACS uses. Defaults to Z:/www (the
// author's Samba mount); override via HA_WWW_DIR.
//
// We deliberately fail loudly when the path doesn't exist — a silent
// dist-only build can let stale code linger in HA without anyone noticing.
// Two opt-outs for environments that genuinely don't have an HA target:
//   - CI=true               (GitHub Actions sets this automatically)
//   - NO_HA_MIRROR=1        (explicit local opt-out for contributors)
const isCI = !!process.env.CI;
const skipMirror = isCI || !!process.env.NO_HA_MIRROR;
const haWwwCandidate = process.env.HA_WWW_DIR ?? 'Z:/www';

let haCardDir = null;
if (!skipMirror) {
  if (!existsSync(haWwwCandidate)) {
    throw new Error(
      `[rollup] HA mirror target "${haWwwCandidate}" not found.\n` +
        `  - Mount it (default: Z:/www → //<HA>/config/www), or\n` +
        `  - Set HA_WWW_DIR=<path> to point elsewhere, or\n` +
        `  - Set NO_HA_MIRROR=1 to skip mirroring locally, or\n` +
        `  - Set CI=true for CI builds (already auto-set by GitHub Actions).`,
    );
  }
  // Dev builds mirror to their own folder. Sharing one folder would mean a
  // plain `npm run build` silently replaces the dev bundle with a
  // normally-tagged one, breaking the registered dev resource.
  haCardDir = `${haWwwCandidate}/electrical-panel-card${devTag ? '-dev' : ''}`;
  // eslint-disable-next-line no-console
  console.log(`[rollup] mirroring bundle to ${haCardDir}/electrical-panel-card.js`);
}

const baseOutput = {
  format: 'es',
  inlineDynamicImports: true,
  sourcemap: dev,
};

export default {
  input: 'src/electrical-panel-card.ts',
  output: [
    { ...baseOutput, file: 'dist/electrical-panel-card.js' },
    ...(haCardDir ? [{ ...baseOutput, file: `${haCardDir}/electrical-panel-card.js` }] : []),
  ],
  plugins: [
    // Ahead of typescript() so it rewrites the original .ts source.
    devTagSuffix(),
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', sourceMap: dev, inlineSources: dev }),
    json(),
    !dev && terser({ format: { comments: false } }),
  ].filter(Boolean),
};
