/** Real build checks plus negative permission/stale-file cases. No browser/data access. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExtension } from '../tools/extension-build.js';
import { auditExtension } from '../tools/extension-audit.js';
const production = await buildExtension();
await auditExtension(production);
const original = await readFile(`${production}/worker.js`);
await buildExtension(true);
assert.deepEqual(
  await readFile(`${production}/worker.js`),
  original,
  'FIXTURE_OVERWROTE_PRODUCTION',
);
const root = await mkdtemp(join(tmpdir(), 'extension-package-'));
const copy = join(root, 'extension');
try {
  await cp(production, copy, { recursive: true });
  await cp(`${production}-inputs.json`, `${copy}-inputs.json`);
  await writeFile(join(copy, 'unexpected.txt'), 'synthetic stale asset');
  await assert.rejects(auditExtension(copy), /PACKAGE_FILES/);
  await rm(join(copy, 'unexpected.txt'));
  const manifest = JSON.parse(
    await readFile(join(copy, 'manifest.json'), 'utf8'),
  );
  manifest.permissions.push('nativeMessaging');
  await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(auditExtension(copy), /PACKAGE_PERMISSIONS/);
  console.log(
    'PASS extension package: exact assets, source graph, minimal permissions, CSP, legacy exclusion, fixture isolation; stale assets and extra permissions rejected',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
