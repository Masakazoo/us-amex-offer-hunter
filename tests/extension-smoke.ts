/** Real MV3 loading, storage and isolated-world fill. External network is aborted. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fullFixtureHtml, fullSentinelProfile } from './full-form-fixture.js';
import { runFullAutofill } from '../apps/extension/src/full-autofill.js';
import { fullFieldSpecs } from '../apps/extension/src/full-profile.js';
import { classifyTarget } from '../apps/extension/src/target.js';
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
  context.setDefaultTimeout(30000);
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
    .getByText(
      '処理が終わりました。項目ごとの結果と申込画面を確認してください。申込送信はしていません。',
    )
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
        source: 'local-test',
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
      '操作できませんでした。対象の申込ページまたは模擬フォームを開き、再検出してください。',
    )
    .waitFor();
  assert.equal(await page.locator('#firstName').inputValue(), '');

  // Exercise conservative guards against changed, ambiguous and dynamic DOM.
  await page.reload();
  const sentinel = { firstName: 'SENTINEL' };
  const status = async () =>
    (
      await page.evaluate(runAutofill, {
        action: 'fill',
        source: 'local-test',
        values: sentinel,
      })
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
        source: 'local-test',
        values: { ssn: 'SENTINEL' },
      })
    ).state,
    'invalid-command',
  );
  await page.evaluate(() =>
    history.replaceState(null, '', '/autofill-fixture?unreviewed=1'),
  );
  assert.equal(
    (
      await page.evaluate(runAutofill, {
        action: 'fill',
        source: 'local-test',
        values: sentinel,
      })
    ).state,
    'blocked',
  );
  assert.equal(await page.locator('#firstName').inputValue(), '');

  // Imported personal profiles stay in session memory and cannot reach fixtures/local storage.
  await page.goto('http://127.0.0.1:4173/autofill-fixture');
  const yaml = fieldSpecs
    .map(
      ([key]) =>
        `${key}: "${key === 'companyDBAName' ? '' : 'VAULT_SENTINEL'}"`,
    )
    .join('\n');
  await reopened.locator('#vault-file').setInputFiles({
    name: 'profile.yaml',
    mimeType: 'text/plain',
    buffer: Buffer.from(yaml),
  });
  await reopened
    .getByText(
      '申込情報をメモリに読み込みました。Amex申込ページでフォームを検出してください。',
    )
    .waitFor();
  assert.equal(await reopened.locator('#save').isDisabled(), true);
  await reopened
    .locator('#save')
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click')));
  await reopened
    .getByText(
      '操作できませんでした。対象の申込ページまたは模擬フォームを開き、再検出してください。',
    )
    .waitFor();

  assert.equal(
    await reopened.locator('[name="firstName"]').getAttribute('type'),
    'password',
  );
  assert.equal(
    await reopened.locator('[name="firstName"]').inputValue(),
    'VAULT_SENTINEL',
  );
  assert.equal(
    await reopened.locator('[name="companyDBAName"]').inputValue(),
    '',
  );
  assert.equal(
    await reopened.evaluate(
      async () => Object.keys(await chrome.storage.local.get(null)).length,
    ),
    0,
  );
  await reopened.reload();
  await reopened
    .getByText(
      'メモリの本人情報を再利用します。Amex申込ページでフォームを検出してください。',
    )
    .waitFor();
  await page.bringToFront();
  await reopened.locator('#inspect').click();
  await reopened
    .getByText('検出しました。本人情報は模擬フォームへ入力しません。')
    .waitFor();
  assert.equal(await reopened.locator('#fill').isDisabled(), true);
  // Even a programmatic click cannot bypass the imported-profile guard.
  await reopened
    .locator('#fill')
    .evaluate((el) => el.dispatchEvent(new MouseEvent('click')));
  await reopened
    .getByText(
      '操作できませんでした。対象の申込ページまたは模擬フォームを開き、再検出してください。',
    )
    .waitFor();
  assert.equal(await page.locator('#firstName').inputValue(), '');
  assert.ok(
    !(await reopened.locator('#message').textContent())?.includes(
      'VAULT_SENTINEL',
    ),
  );
  // Official-origin contract test: ALL requests are intercepted, no Amex network access.
  const amexUrl =
    'https://www.americanexpress.com/en-us/credit-cards/apply/business/business-platinum-charge-card/68443-9-0';
  const fixtureHtml = fullFixtureHtml();
  let officialRequestsFulfilled = 0;
  await context.route('https://www.americanexpress.com/**', async (route) => {
    assert.equal(route.request().resourceType(), 'document');
    officialRequestsFulfilled++;
    await route.fulfill({ contentType: 'text/html', body: fixtureHtml });
  });
  await page.goto(amexUrl + '?test=1');
  await page.bringToFront();
  await reopened.locator('#inspect').click();
  await reopened.locator('#fill:enabled').waitFor();
  await reopened.locator('#fill').click();
  await reopened
    .getByText(
      '保管庫の登録が不足、または形式が違います。登録画面で確認してください。',
    )
    .waitFor();
  const fullValues = fullSentinelProfile();
  fullValues.firstName = 'VAULT_SENTINEL';
  await reopened.locator('#vault-file').setInputFiles({
    name: 'profile.yaml',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      Object.entries(fullValues)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n'),
    ),
  });
  await reopened
    .getByText(
      '申込情報をメモリに読み込みました。Amex申込ページでフォームを検出してください。',
    )
    .waitFor();
  await page.bringToFront();
  await reopened.locator('#inspect').click();
  await reopened.locator('#fill:enabled').waitFor();
  await reopened.locator('#fill').click();
  await reopened
    .getByText(
      '処理が終わりました。項目ごとの結果と申込画面を確認してください。申込送信はしていません。',
    )
    .waitFor();
  assert.equal(await page.locator('#firstName').inputValue(), 'VAULT_SENTINEL');
  assert.equal(await page.locator('#companyDBAName').inputValue(), '');
  assert.equal(await page.locator('#ssn').inputValue(), '000-00-0000');
  assert.equal(await page.locator('#doingBusinessAs').isChecked(), true);
  assert.equal(await page.locator('#sameAddress').isChecked(), true);
  assert.equal(
    await page.locator('#companyStructure option:checked').textContent(),
    'Sole Proprietorship',
  );
  assert.equal(
    await page.locator('#businessPhoneNumber').inputValue(),
    '(000) 000-0000',
  );
  assert.equal(await page.evaluate('window.submissions'), 0);
  assert.ok(
    !(await reopened.locator('#results').textContent())?.includes(
      'VAULT_SENTINEL',
    ),
  );
  const fullBlocked = await page.evaluate(runFullAutofill, {
    command: {
      action: 'fill',
      source: 'local-test',
      expectedUrl: amexUrl + '?test=1',
      values: fullValues,
    },
    specs: fullFieldSpecs,
  });
  assert.equal(fullBlocked.state, 'blocked');
  const wrongUrl = await page.evaluate(runFullAutofill, {
    command: {
      action: 'fill',
      source: 'vault-file',
      expectedUrl: amexUrl,
      values: fullValues,
    },
    specs: fullFieldSpecs,
  });
  assert.equal(wrongUrl.state, 'blocked');
  // Layered source guard prevents test data on the real destination and vault data on fixtures.
  assert.equal(
    (
      await page.evaluate(runAutofill, {
        action: 'fill',
        source: 'local-test',
        values: sentinel,
      })
    ).state,
    'blocked',
  );
  await page.reload();
  await page.locator('#firstName').evaluate((el) =>
    el.addEventListener('input', () =>
      setTimeout(() => {
        (el as HTMLInputElement).value = '';
      }, 20),
    ),
  );
  assert.equal(
    (
      await page.evaluate(runAutofill, {
        action: 'fill',
        source: 'vault-file',
        expectedUrl: amexUrl,
        values: sentinel,
      })
    ).state,
    'blocked',
  );
  assert.equal(await page.locator('#firstName').inputValue(), '');
  const delayed = await page.evaluate(runAutofill, {
    action: 'fill',
    source: 'vault-file',
    expectedUrl: amexUrl + '?test=1',
    values: sentinel,
  });
  assert.equal(
    delayed.fields.find((f) => f.field === 'firstName')?.status,
    'changed',
  );
  await page.reload();
  await page
    .locator('#firstName')
    .evaluate((el) =>
      el.addEventListener('input', () =>
        el.setAttribute('aria-invalid', 'true'),
      ),
    );
  const invalid = await page.evaluate(runAutofill, {
    action: 'fill',
    source: 'vault-file',
    expectedUrl: amexUrl + '?test=1',
    values: sentinel,
  });
  assert.equal(
    invalid.fields.find((f) => f.field === 'firstName')?.status,
    'validation-error',
  );
  // Popup cannot use a stale inspected SPA URL, even if the document ID stays the same.
  await page.reload();
  await page.bringToFront();
  await reopened.locator('#inspect').click();
  await reopened.locator('#fill:enabled').waitFor();
  await page.evaluate(() => history.replaceState(null, '', '?changed=1'));
  await reopened.locator('#fill').click();
  await reopened
    .getByText(
      '操作できませんでした。対象の申込ページまたは模擬フォームを開き、再検出してください。',
    )
    .waitFor();
  assert.equal(await page.locator('#firstName').inputValue(), '');
  for (const suffix of ['../other-card/68443-9-0', '68443-9-0/extra', 'bad']) {
    const raw = new URL(suffix, amexUrl).href;
    assert.equal(classifyTarget(raw), undefined);
    await page.goto(raw);
    assert.equal(
      (await page.evaluate(runAutofill, { action: 'inspect' })).state,
      'blocked',
    );
  }
  assert.ok(officialRequestsFulfilled >= 7);
  await page.goto('http://127.0.0.1:4173/autofill-fixture');
  assert.equal(
    (
      await page.evaluate(runAutofill, {
        action: 'fill',
        source: 'vault-file',
        expectedUrl: amexUrl + '?test=1',
        values: sentinel,
      })
    ).state,
    'blocked',
  );
  const otherPopup = await context.newPage();
  await otherPopup.goto(`chrome-extension://${id}/popup.html`);
  await otherPopup
    .getByText(
      'メモリの本人情報を再利用します。Amex申込ページでフォームを検出してください。',
    )
    .waitFor();
  await reopened.locator('#lock').click();
  await reopened
    .getByText('メモリの本人情報を削除しました。暗号化ファイルは変更しません。')
    .waitFor();
  await otherPopup.waitForFunction(
    () =>
      (document.querySelector('[name="firstName"]') as HTMLInputElement)
        .value === '',
  );
  assert.equal(
    await reopened.evaluate(
      async () => Object.keys(await chrome.storage.session.get(null)).length,
    ),
    0,
  );
  await reopened.locator('#vault-file').setInputFiles({
    name: 'profile.yaml',
    mimeType: 'text/plain',
    buffer: Buffer.from(yaml),
  });
  await reopened
    .getByText(
      '申込情報をメモリに読み込みました。Amex申込ページでフォームを検出してください。',
    )
    .waitFor();
  await reopened.locator('#vault-file').setInputFiles({
    name: 'invalid.yaml',
    mimeType: 'text/plain',
    buffer: Buffer.from(yaml + '\nunknown: "DO_NOT_LOG"'),
  });
  await reopened
    .getByText(
      '読み込めません。保管庫の登録画面で保存したprofile.yamlを選択してください。値やファイル名は記録しません。',
    )
    .waitFor();
  assert.equal(await reopened.locator('[name="firstName"]').inputValue(), '');
  assert.equal(
    await reopened.evaluate(
      async () => Object.keys(await chrome.storage.session.get(null)).length,
    ),
    0,
  );
  assert.equal(
    await reopened.evaluate(
      async () => Object.keys(await chrome.storage.local.get(null)).length,
    ),
    0,
  );
  await otherPopup.close();
  console.log(
    'PASS extension: real MV3 UI, persistent local profile/delete, memory-only vault import/lock, fixture and Amex destination/source guards, isolated fill, delayed verification; external network blocked.',
  );
} finally {
  await context.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
