import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
const out = 'dist/security-spike';
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['tools/security-spike/worker.ts'],
  outfile: `${out}/worker.js`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
});
await writeFile(
  `${out}/manifest.json`,
  JSON.stringify({
    manifest_version: 3,
    name: 'Synthetic security spike — never enter personal data',
    version: '0.0.1',
    minimum_chrome_version: '120',
    permissions: ['storage'],
    background: { service_worker: 'worker.js', type: 'module' },
    action: { default_popup: 'harness.html' },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src 'none'",
    },
  }),
);
await writeFile(
  `${out}/harness.html`,
  '<!doctype html><meta charset="utf-8"><title>Synthetic security harness</title><p>Automated synthetic tests only. No profile input.</p>',
);
