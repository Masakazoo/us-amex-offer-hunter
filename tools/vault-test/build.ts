import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
export const out = 'dist/vault-test';
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['tools/vault-test/worker.ts'],
  outfile: `${out}/worker.js`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome121',
});
await writeFile(
  `${out}/manifest.json`,
  JSON.stringify({
    manifest_version: 3,
    name: 'Synthetic production vault test',
    version: '0.0.1',
    minimum_chrome_version: '121',
    incognito: 'not_allowed',
    permissions: ['storage'],
    background: { service_worker: 'worker.js', type: 'module' },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src 'none'",
    },
  }),
);
for (const page of ['settings', 'popup'])
  await writeFile(
    `${out}/${page}.html`,
    '<!doctype html><meta charset="utf-8"><title>Synthetic vault test</title><p>Synthetic data only. No personal data.</p>',
  );
