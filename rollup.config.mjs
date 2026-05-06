import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const dev = process.env.ROLLUP_WATCH === 'true';

export default {
  input: 'src/electrical-panel-card.ts',
  output: {
    file: 'dist/electrical-panel-card.js',
    format: 'es',
    inlineDynamicImports: true,
    sourcemap: dev,
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', sourceMap: dev, inlineSources: dev }),
    json(),
    !dev && terser({ format: { comments: false } }),
  ].filter(Boolean),
};
