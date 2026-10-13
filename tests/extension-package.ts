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
  const cssCases = [
    'body { background: url(https://example.invalid/image); }',
    'body { background: URL( "http://example.invalid/image" ); }',
    "body { background: url('//example.invalid/image'); }",
    'body { background: url(data:image/svg+xml;base64,PHN2Zz4=); }',
    '@import "https://example.invalid/style.css";',
    "@IMPORT '//example.invalid/style.css' screen;",
    '@import url(https://example.invalid/style.css);',
    '@font-face { font-family: test; src: url(https://example.invalid/font.woff2); }',
    'body { background: image-set("https://example.invalid/image" 1x); }',
    'body { background: -webkit-image-set("//example.invalid/image" 2x); }',
    'body { background: src("https://example.invalid/image"); }',
    String.raw`body { background: u\72l(https://example.invalid/image); }`,
    String.raw`@im\70ort "https://example.invalid/style.css";`,
    '@import/**/"https://example.invalid/style.css";',
    'body { background: url/**/(https://example.invalid/image); }',
    'p::before { content: "/*"; } body { background: url(https://example.invalid/image); } p::after { content: "*/"; }',
    // Local resources are also outside the current eight-file package contract.
    'body { background: url(./unreviewed.svg); }',
  ];
  for (const stylesheet of ['popup.css', 'settings.css']) {
    const path = join(copy, stylesheet);
    const clean = await readFile(path, 'utf8');
    for (const css of cssCases) {
      await writeFile(path, `${clean}\n${css}`);
      await assert.rejects(auditExtension(copy), /PACKAGE_CSS_RESOURCE/);
    }
    await writeFile(
      path,
      `${clean}\n/* No resource dependencies in this stylesheet. */`,
    );
    await auditExtension(copy); // Ordinary CSS and comments remain allowed.
    await writeFile(path, clean);
  }
  manifest.permissions.push('nativeMessaging');
  await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(auditExtension(copy), /PACKAGE_PERMISSIONS/);
  console.log(
    'PASS extension package: exact assets, source graph, minimal permissions, CSP, legacy exclusion, fixture isolation; stale assets, extra permissions and CSS resource/escaped loading syntax rejected',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
