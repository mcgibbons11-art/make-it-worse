// Build the corridor harness into a caller-supplied directory.
//
// Deliberately never portals/dist: a build into that directory under a running
// preview server serves a half-written bundle. Vite lives in portals/node_modules,
// so this is invoked from there.
//
// usage: node build.mjs <outDir>
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
// Node resolves a bare specifier from the importing FILE's directory, and vite is
// installed in the portals workspace rather than at the root, so a plain
// `import 'vite'` here fails wherever it is run from.
const fromPortals = createRequire(path.join(REPO, 'portals', 'package.json'));
const { build } = await import(pathToFileURL(fromPortals.resolve('vite')).href);
const react = (await import(pathToFileURL(fromPortals.resolve('@vitejs/plugin-react')).href)).default;
const outDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node build.mjs <outDir>');
  process.exit(2);
}

await build({
  configFile: false,
  root: HERE,
  base: './',
  cacheDir: path.join(os.tmpdir(), 'miw-corridor-harness-vite'),
  publicDir: path.join(REPO, 'public'),
  define: { 'process.env.NEXT_PUBLIC_ASSET_BASE': JSON.stringify('./') },
  plugins: [react()],
  resolve: {
    alias: { '@': REPO },
    // Two copies of three or of the reconciler in one bundle make R3F render
    // nothing at all, with no error.
    dedupe: ['three', '@react-three/fiber', '@react-three/drei', '@react-three/rapier', 'react', 'react-dom'],
  },
  build: { target: 'es2022', outDir, assetsDir: 'assets', emptyOutDir: true },
  logLevel: 'warn',
});
console.log('built', outDir);
