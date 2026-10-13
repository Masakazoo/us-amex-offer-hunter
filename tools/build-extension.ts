import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/extension', { recursive: true });
await build({
  entryPoints: [
    'apps/extension/src/popup.ts',
    'apps/extension/src/worker.ts',
    'apps/extension/src/settings.ts',
  ],
  bundle: true,
  define: {
    __AUTOFILL_FIXTURE__:
      process.env.AUTOFILL_FIXTURE === '1' ? 'true' : 'false',
  },
  format: 'esm',
  target: 'chrome121',
  outdir: 'dist/extension',
  sourcemap: false,
});
for (const name of [
  'manifest.json',
  'popup.html',
  'popup.css',
  'settings.html',
  'settings.css',
]) {
  await copyFile(`apps/extension/${name}`, `dist/extension/${name}`);
}
console.log(
  'PASS extension build: dist/extension (encrypted settings + guarded autofill).',
);

if (process.env.AUTOFILL_FIXTURE !== '1') {
  const path = 'dist/extension/manifest.json';
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.host_permissions = manifest.host_permissions.filter(
    (host: string) => !host.startsWith('http://127.0.0.1'),
  );
  await writeFile(path, JSON.stringify(manifest, null, 2));
}
