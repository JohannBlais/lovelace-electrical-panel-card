import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const dev = process.env.ROLLUP_WATCH === 'true';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

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

// Both rewrites land on src/const.ts, so they share one transform.
//
// CARD_VERSION always comes from package.json, which is therefore the only
// place the version lives. It used to be a literal that had to be kept in step
// with package.json and the git tag by hand, with nothing enforcing the
// agreement — and since the console banner is how you tell builds apart in a
// live Home Assistant, a stale one is worse than no banner at all.
const rewriteIdentity = () => ({
  name: 'rewrite-identity',
  transform(code, id) {
    if (!/[\\/]const\.ts$/.test(id)) return null;

    // A rewrite that silently matched nothing would ship the placeholder
    // version, or a dev build that collides anyway — exactly the failures this
    // transform exists to prevent.
    const rewrite = (constant, replacement) => {
      const declaration = new RegExp(`(export const ${constant} = ')([^']*)'`);
      if (!declaration.test(code)) {
        this.error(`[rollup] no ${constant} declaration to rewrite in src/const.ts`);
      }
      code = code.replace(declaration, replacement);
    };

    rewrite('CARD_VERSION', `$1${pkg.version}${devTag ? '-dev' : ''}'`);

    if (devTag) {
      rewrite('CARD_TAG', "$1$2-dev'");
      rewrite('EDITOR_TAG', "$1$2-dev'");
      rewrite('CARD_NAME', "$1$2 (dev)'");
    }

    return { code, map: null };
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
}

// The dev mirror never puts the bundle at the URL Home Assistant loads.
// /local is served with a 31-day cache, so a bundle at a fixed URL goes stale
// on the first rebuild, and the registered resource would need a new `?v=`
// after every one. Instead, that URL gets a loader whose content never changes.
// The bundle sits next to it, and each build records a hash of it in
// build.json. The loader fetches that file uncached and imports the bundle
// with the hash as `?v=`, so the bundle's URL changes whenever its code does.
const mirrorFile = haCardDir && `${haCardDir}/electrical-panel-card${devTag ? '.bundle' : ''}.js`;
if (mirrorFile) {
  // eslint-disable-next-line no-console
  console.log(`[rollup] mirroring bundle to ${mirrorFile}`);
}

const DEV_LOADER = `// Written by \`npm run build:dev\`. Do not edit: the next build overwrites it.
// Home Assistant serves /local with a 31-day cache, so this loader never
// changes; build.json, fetched uncached, gives the bundle a new URL per build.
fetch(new URL('build.json', import.meta.url), { cache: 'no-store' })
  .then((response) => response.json())
  .then(({ build }) =>
    import(new URL(\`electrical-panel-card.bundle.js?v=\${build}\`, import.meta.url).href),
  )
  .catch((error) => console.error('[electrical-panel-card-dev] loader failed:', error));
`;

const devLoader = () => ({
  name: 'dev-loader',
  writeBundle(options, bundle) {
    if (!devTag || options.file !== mirrorFile) return;
    const chunk = Object.values(bundle).find((output) => output.type === 'chunk');
    const build = createHash('sha256').update(chunk.code).digest('hex').slice(0, 12);
    writeFileSync(`${haCardDir}/build.json`, `${JSON.stringify({ build })}\n`);
    writeFileSync(`${haCardDir}/electrical-panel-card.js`, DEV_LOADER);
    // eslint-disable-next-line no-console
    console.log(`[rollup] dev loader → electrical-panel-card.bundle.js?v=${build}`);
  },
});

const baseOutput = {
  format: 'es',
  inlineDynamicImports: true,
  sourcemap: dev,
};

export default {
  input: 'src/electrical-panel-card.ts',
  output: [
    { ...baseOutput, file: 'dist/electrical-panel-card.js' },
    ...(mirrorFile ? [{ ...baseOutput, file: mirrorFile }] : []),
  ],
  plugins: [
    devLoader(),
    // Ahead of typescript() so it rewrites the original .ts source.
    rewriteIdentity(),
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', sourceMap: dev, inlineSources: dev }),
    json(),
    !dev && terser({ format: { comments: false } }),
  ].filter(Boolean),
};
