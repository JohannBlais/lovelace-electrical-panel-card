import { existsSync } from 'node:fs';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const dev = process.env.ROLLUP_WATCH === 'true';

// Optional dev mirror: drop the bundle straight into Home Assistant's www/.
// Set HA_WWW_DIR to override; defaults to Z:/www if that drive is mounted.
const haWwwCandidate = process.env.HA_WWW_DIR ?? 'Z:/www';
const haWww = existsSync(haWwwCandidate) ? haWwwCandidate : null;

if (haWww) {
  // eslint-disable-next-line no-console
  console.log(`[rollup] mirroring bundle to ${haWww}/electrical-panel-card.js`);
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
    ...(haWww ? [{ ...baseOutput, file: `${haWww}/electrical-panel-card.js` }] : []),
  ],
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', sourceMap: dev, inlineSources: dev }),
    json(),
    !dev && terser({ format: { comments: false } }),
  ].filter(Boolean),
};
