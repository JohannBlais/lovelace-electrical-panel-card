import { existsSync } from 'node:fs';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const dev = process.env.ROLLUP_WATCH === 'true';

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
  haCardDir = `${haWwwCandidate}/electrical-panel-card`;
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
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', sourceMap: dev, inlineSources: dev }),
    json(),
    !dev && terser({ format: { comments: false } }),
  ].filter(Boolean),
};
