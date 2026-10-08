import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/extension', { recursive: true });
await build({
  entryPoints: ['apps/extension/src/popup.ts', 'apps/extension/src/worker.ts'],
  bundle: true,
  format: 'esm',
  target: 'chrome121',
  outdir: 'dist/extension',
  sourcemap: false,
});
for (const name of ['manifest.json', 'popup.html', 'popup.css']) {
  await copyFile(`apps/extension/${name}`, `dist/extension/${name}`);
}
console.log('PASS extension build: dist/extension (local fixture only).');
