import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'src/vendor');
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/utils/firebase_sdk_entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  minify: true,
  sourcemap: false,
  outfile: resolve(outDir, 'firebase-ai-bundle.js')
});

console.log('Built src/vendor/firebase-ai-bundle.js');
