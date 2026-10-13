import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionFiles, productionHost } from './extension-build.js';

/** Fail closed on package/permission drift. Never prints a matching file body. */
export async function auditExtension(directory = 'dist/extension') {
  const entries = await readdir(directory, { withFileTypes: true });
  assert.ok(
    entries.every((entry) => entry.isFile()),
    'PACKAGE_NON_FILE',
  );
  assert.deepEqual(
    entries.map((entry) => entry.name).sort(),
    extensionFiles,
    'PACKAGE_FILES',
  );
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(
    manifest.permissions,
    ['storage', 'scripting'],
    'PACKAGE_PERMISSIONS',
  );
  assert.deepEqual(
    manifest.host_permissions,
    [productionHost],
    'PACKAGE_HOSTS',
  );
  assert.equal(manifest.incognito, 'not_allowed', 'PACKAGE_INCOGNITO');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '121');
  assert.deepEqual(manifest.background, {
    service_worker: 'worker.js',
    type: 'module',
  });
  assert.deepEqual(manifest.action, { default_popup: 'popup.html' });
  assert.deepEqual(manifest.options_ui, {
    page: 'settings.html',
    open_in_tab: true,
  });
  assert.deepEqual(
    manifest.content_security_policy,
    {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src 'none'",
    },
    'PACKAGE_CSP',
  );
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [
      'manifest_version',
      'minimum_chrome_version',
      'name',
      'version',
      'description',
      'permissions',
      'background',
      'host_permissions',
      'action',
      'content_security_policy',
      'incognito',
      'options_ui',
    ].sort(),
    'PACKAGE_MANIFEST_KEYS',
  );
  const inputs: string[] = JSON.parse(
    await readFile(`${directory}-inputs.json`, 'utf8'),
  );
  assert.ok(inputs.length > 0);
  for (const input of inputs) {
    assert.ok(
      input.startsWith('apps/extension/src/') ||
        input.startsWith('node_modules/zod/'),
      'PACKAGE_UNREVIEWED_SOURCE',
    );
    assert.ok(
      !/^apps\/extension\/src\/(profile|autofill)\.ts$/.test(input),
      'PACKAGE_LEGACY_SOURCE',
    );
  }
  for (const name of extensionFiles.filter(
    (name) => name !== 'manifest.json',
  )) {
    const source = await readFile(join(directory, name), 'utf8');
    assert.ok(
      !/autofillProfileV1|sendNativeMessage|connectNative|SENTINEL|PRIVATE_SENTINEL|synthetic@example|sourceMappingURL/.test(
        source,
      ),
      'PACKAGE_FORBIDDEN_CONTENT',
    );
    if (name.endsWith('.html'))
      assert.ok(
        !/(?:src|href)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(source),
        'PACKAGE_REMOTE_ASSET',
      );
  }
}
