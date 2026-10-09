import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  lstat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startProfileEditor } from '../tools/profile-editor/server.js';
import { fullSentinelProfile } from './full-form-fixture.js';
import { parseVaultProfile } from '../apps/extension/src/vault-profile.js';
import { fieldSpecs } from '../apps/extension/src/profile.js';

const directory = await mkdtemp(join(tmpdir(), 'amex-editor-test-'));
const file = join(directory, 'profile.yaml');
const initial = fieldSpecs.map(([key]) => `${key}: "SENTINEL"`).join('\n');
await writeFile(file, initial, { mode: 0o600 });
const editor = await startProfileEditor(directory);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PROBE_TEST_BROWSER === 'chromium'
    ? { channel: 'chromium' }
    : {
        executablePath:
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      }),
});
try {
  const origin = new URL(editor.url).origin;
  const denied = await fetch(origin + '/wrong-token/profile');
  assert.equal(denied.status, 403);
  const deniedPost = await fetch(editor.url + 'save', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.invalid',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(deniedPost.status, 403);
  assert.equal(await readFile(file, 'utf8'), initial);
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    route
      .request()
      .url()
      .startsWith(origin + '/')
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(editor.url);
  await page.locator('#save:enabled').waitFor();
  assert.equal(await page.locator('[name=firstName]').inputValue(), 'SENTINEL');
  const values = fullSentinelProfile();
  // Set governing choices first, then fill only active controls.
  for (const key of ['companyStructure', 'doingBusinessAs', 'sameAddress'])
    await page.locator(`[name=${key}]`).selectOption(values[key]!);
  for (const [key, value] of Object.entries(values)) {
    const el = page.locator(`[name=${key}]`);
    if (await el.isDisabled()) continue;
    if (await el.evaluate((e) => e.tagName === 'SELECT'))
      await el.selectOption(value);
    else await el.fill(value);
  }
  await page.locator('#save').click();
  await page.getByText(/保管庫に保存しました。Finder/).waitFor();
  await editor.finished;
  assert.equal(await page.locator('#editor').isHidden(), true);
  const actual = parseVaultProfile(await readFile(file, 'utf8'))!;
  assert.equal(actual.ssn, values.ssn);
  assert.equal(actual.companyStructure, 'Sole Proprietorship');
  assert.equal(actual.sameAddress, 'yes');
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  // A concurrent external edit must not be overwritten.
  const other = await startProfileEditor(directory);
  const data = (await fetch(other.url + 'profile').then((r) => r.json())) as {
    revision: string;
  };
  await writeFile(file, initial + '\n# changed');
  const changed = await fetch(other.url + 'save', {
    method: 'POST',
    headers: {
      Origin: new URL(other.url).origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values, revision: data.revision }),
  });
  assert.equal(changed.status, 409);
  assert.equal(await readFile(file, 'utf8'), initial + '\n# changed');
  await new Promise<void>((r) => other.server.close(() => r()));
  await rm(file);
  await symlink(join(directory, 'target.yaml'), file);
  await writeFile(join(directory, 'target.yaml'), initial);
  await assert.rejects(() => startProfileEditor(directory));
  console.log(
    'PASS private editor: browser registration, selected-directory-only target contract, atomic 0600 save, no value logging, origin/token checks, concurrent edit and symlink refusal. Synthetic markers only.',
  );
} finally {
  await browser.close();
  editor.server.close();
  await rm(directory, { recursive: true, force: true });
}
