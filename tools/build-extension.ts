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
await build({
  entryPoints: ['tools/profile-editor/editor.ts'],
  bundle: true,
  format: 'esm',
  target: 'chrome121',
  outdir: 'dist/profile-editor',
  sourcemap: false,
});
await build({
  entryPoints: ['tools/native-vault/host.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: 'dist/native-vault/host.cjs',
  sourcemap: false,
});
console.log(
  'PASS extension build: dist/extension (Business Platinum + local fixture).',
);
