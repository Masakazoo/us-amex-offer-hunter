/** Real MV3 loading, storage and isolated-world fill. External network is aborted. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFixture } from '../tools/autofill-fixture/server.js';
import { runAutofill } from '../apps/extension/src/autofill.js';
import { fieldSpecs } from '../apps/extension/src/profile.js';

const server = await startFixture();
const extensionPath = resolve('dist/extension');
const context = await chromium.launchPersistentContext('', {
  headless: true,
  ...(process.env.PROBE_TEST_BROWSER === 'chromium'
    ? { channel: 'chromium' }
    : {
        executablePath:
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      }),
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
try {
  context.setDefaultTimeout(10000);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:4173' ||
      (url.protocol === 'chrome-extension:' && url.host === id)
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/autofill-fixture');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#save:enabled').waitFor();
  for (const [key] of fieldSpecs)
    await popup.locator(`[name="${key}"]`).fill('SENTINEL');
  await popup.locator('#save').click();
  await popup
    .getByText('この端末に保存しました。次回も読み込まれます。')
    .waitFor();
  await popup.close();
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${id}/popup.html`);
  await reopened.getByText('この端末の保存情報を読み込みました。').waitFor();
  for (const [key] of fieldSpecs)
    assert.equal(
      await reopened.locator(`[name="${key}"]`).inputValue(),
      'SENTINEL',
    );
  assert.equal(await reopened.locator('#fill').isDisabled(), true);

  // Make the target active while driving the real extension page controls.
  await page.bringToFront();
  await reopened.locator('#inspect').click();
  await reopened.locator('#fill:enabled').waitFor();
  assert.equal(await reopened.locator('#results li').count(), 7);
  await reopened.locator('#fill').click();
  await reopened
    .getByText('処理が終わりました。項目ごとの結果を確認してください。')
    .waitFor();
  for (const [key] of fieldSpecs)
    assert.equal(await page.locator(`#${key}`).inputValue(), 'SENTINEL');
  assert.equal(await page.locator('#ssn').inputValue(), '');
  assert.equal(await page.locator('#dateOfBirth').inputValue(), '');
  assert.equal(await reopened.locator('#fill').isDisabled(), true);
  assert.ok(
    !(await reopened.locator('#results').textContent())?.includes('SENTINEL'),
  );
  assert.equal(
    await page
      .evaluate(runAutofill, {
        action: 'fill',
        values: { firstName: 'REPLACE' },
      })
      .then((r) => r.fields.find((f) => f.field === 'firstName')?.status),
    'existing-value',
  );

  await reopened.locator('#delete').click();
  await reopened
    .getByText(
      '保存情報と入力欄を全削除しました。対象ページの既存値は変更しません。',
    )
    .waitFor();
  await reopened.reload();
  await reopened.locator('#save:enabled').waitFor();
  assert.equal(await reopened.locator('[name="firstName"]').inputValue(), '');
  assert.equal(
    await reopened.evaluate(
      async () => Object.keys(await chrome.storage.local.get(null)).length,
    ),
    0,
  );

  // The inspected document cannot be silently replaced between inspect and fill.
  await page.bringToFront();
  await reopened.locator('#inspect').click();
  await reopened.locator('#fill:enabled').waitFor();
  await reopened.locator('[name="firstName"]').fill('SENTINEL');
  await page.reload();
  await reopened.locator('#fill').click();
  await reopened
    .getByText(
      '操作できませんでした。模擬フォームと入力内容を確認して、再検出してください。',
    )
    .waitFor();
  assert.equal(await page.locator('#firstName').inputValue(), '');

  // Exercise conservative guards against changed, ambiguous and dynamic DOM.
  await page.reload();
  const sentinel = { firstName: 'SENTINEL' };
  const status = async () =>
    (
      await page.evaluate(runAutofill, { action: 'fill', values: sentinel })
    ).fields.find((f) => f.field === 'firstName')?.status;
  await page
    .locator('#firstName')
    .evaluate((el) => el.after(el.cloneNode(true)));
  assert.equal(await status(), 'ambiguous');
  await page.reload();
  await page
    .locator('#firstName')
    .evaluate((el) => el.setAttribute('name', 'other'));
  assert.equal(await status(), 'mismatch');
  await page.reload();
  await page
    .locator('label[for="firstName"]')
    .evaluate((el) => (el.textContent = 'Unreviewed'));
  assert.equal(await status(), 'mismatch');
  for (const attribute of ['disabled', 'readonly', 'hidden', 'inert']) {
    await page.reload();
    await page
      .locator('#firstName')
      .evaluate((el, attribute) => el.setAttribute(attribute, ''), attribute);
    assert.equal(await status(), 'unavailable');
  }
  await page.reload();
  await page
    .locator('#firstName')
    .evaluate((el) => el.setAttribute('style', 'opacity:0'));
  assert.equal(await status(), 'unavailable');
  await page.reload();
  await page
    .locator('#firstName')
    .evaluate((el) => el.setAttribute('maxlength', '2'));
  assert.equal(await status(), 'invalid-value');
  await page.reload();
  await page
    .locator('#firstName')
    .evaluate((el) => el.setAttribute('role', 'combobox'));
  assert.equal(await status(), 'mismatch');
  await page.reload();
  await page
    .locator('#firstName')
    .evaluate((el) =>
      el.addEventListener('input', () => el.replaceWith(el.cloneNode(true))),
    );
  assert.equal(await status(), 'changed');
  await page.reload();
  assert.equal(
    (
      await page.evaluate(runAutofill, {
        action: 'fill',
        values: { ssn: 'SENTINEL' },
      })
    ).state,
    'invalid-command',
  );
  await page.evaluate(() =>
    history.replaceState(null, '', '/autofill-fixture?unreviewed=1'),
  );
  assert.equal(
    (await page.evaluate(runAutofill, { action: 'fill', values: sentinel }))
      .state,
    'blocked',
  );
  assert.equal(await page.locator('#firstName').inputValue(), '');
  console.log(
    'PASS extension: real MV3 UI, persistent local profile/delete, isolated fill, conservative guards; external network blocked.',
  );
} finally {
  await context.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
