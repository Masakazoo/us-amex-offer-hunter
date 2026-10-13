import { build } from 'esbuild';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  rename,
} from 'node:fs/promises';
import { join, basename } from 'node:path';

export const productionHost =
  'https://www.americanexpress.com/en-us/credit-cards/apply/business/business-platinum-charge-card/*';
export const extensionFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'settings.html',
  'settings.css',
  'popup.js',
  'worker.js',
  'settings.js',
].sort();
export async function buildExtension(fixture = false) {
  const outdir = fixture ? 'dist/extension-fixture' : 'dist/extension';
  const result = await build({
    entryPoints: [
      'apps/extension/src/popup.ts',
      'apps/extension/src/worker.ts',
      'apps/extension/src/settings.ts',
    ],
    bundle: true,
    define: { __AUTOFILL_FIXTURE__: fixture ? 'true' : 'false' },
    format: 'esm',
    target: 'chrome121',
    outdir,
    sourcemap: false,
    write: false,
    metafile: true,
  });
  // Stage only reviewed assets, then replace this generated directory. A stale
  // development file must never be carried into the distributable directory.
  await mkdir('dist', { recursive: true });
  const staging = await mkdtemp('dist/.extension-build-');
  try {
    for (const output of result.outputFiles)
      await writeFile(join(staging, basename(output.path)), output.contents);
    for (const name of [
      'popup.html',
      'popup.css',
      'settings.html',
      'settings.css',
    ])
      await writeFile(
        join(staging, name),
        await readFile(`apps/extension/${name}`),
      );
    const manifest = JSON.parse(
      await readFile('apps/extension/manifest.json', 'utf8'),
    );
    if (fixture) {
      manifest.name = 'Amex Autofill — Synthetic test only';
      manifest.host_permissions = ['http://127.0.0.1/*'];
    }
    await writeFile(
      join(staging, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    await rm(outdir, { recursive: true, force: true });
    await rename(staging, outdir);
    await writeFile(
      `${outdir}-inputs.json`,
      JSON.stringify(Object.keys(result.metafile.inputs).sort(), null, 2),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return outdir;
}
