import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fullFixtureHtml, fullSentinelProfile } from './full-form-fixture.js';
import { fullFieldSpecs } from '../apps/extension/src/full-profile.js';
import { runFullAutofill } from '../apps/extension/src/full-autofill.js';
const url =
  'https://www.americanexpress.com/en-us/credit-cards/apply/business/business-platinum-charge-card/68443-9-0';
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
  const context = await browser.newContext();
  await context.route('**/*', (r) =>
    r.request().url() === url
      ? r.fulfill({ contentType: 'text/html', body: fullFixtureHtml() })
      : r.abort(),
  );
  const page = await context.newPage();
  const values = fullSentinelProfile();
  values.companyStructure = 'Corporation';
  values.doingBusinessAs = 'no';
  values.sameAddress = 'no';
  values.companyDBAName = 'SENTINEL';
  values.cardDesign = 'Mirror';
  values.cardMaterial = '85% Recycled Plastic';
  await page.goto(url);
  const run = () =>
    page.evaluate(runFullAutofill, {
      command: {
        action: 'fill',
        source: 'vault-file',
        expectedUrl: url,
        values,
      },
      specs: fullFieldSpecs,
    });
  const result = await run();
  assert.equal(result.state, 'ok');
  assert.ok(
    result.fields.every((f) => ['filled', 'matched'].includes(f.status)),
    JSON.stringify(result),
  );
  assert.equal(await page.locator('#federalTaxId').inputValue(), '000000000');
  assert.equal(await page.locator('#addressLine1').inputValue(), 'SENTINEL');
  assert.equal(await page.locator('#cardDesign-1').isChecked(), true);
  assert.equal(await page.locator('#cardMaterial-1').isChecked(), true);
  assert.equal(await page.evaluate('window.submissions'), 0);
  const again = await run();
  assert.ok(
    again.fields.every((f) => f.status === 'matched'),
    JSON.stringify(again),
  );
  await page.reload();
  await page.locator('#firstName').fill('KEEP');
  await page
    .locator('#lastName')
    .evaluate((e) => e.setAttribute('name', 'unreviewed'));
  await page.locator('#roleInCompany').evaluate((e) => {
    const s = e as HTMLSelectElement;
    s.append(s.options[1]!.cloneNode(true));
  });
  values.roleInCompany = 'General Manager';
  await page.locator('#businessPhoneNumber').evaluate((e) =>
    e.addEventListener('input', () =>
      setTimeout(() => {
        (e as HTMLInputElement).value = '';
      }, 20),
    ),
  );
  await page
    .locator('#ssn')
    .evaluate((e) =>
      e.addEventListener('input', () => e.setAttribute('aria-invalid', 'true')),
    );
  const guarded = await run();
  const status = (key: string) =>
    guarded.fields.find((f) => f.field === key)?.status;
  assert.equal(status('firstName'), 'existing-value');
  assert.equal(await page.locator('#firstName').inputValue(), 'KEEP');
  assert.equal(status('lastName'), 'mismatch');
  assert.equal(status('roleInCompany'), 'ambiguous');
  assert.equal(status('businessPhoneNumber'), 'changed');
  assert.equal(status('ssn'), 'validation-error');
  assert.equal(await page.evaluate('window.submissions'), 0);
  await page.reload();
  await page.locator('#businessAddressLine1').evaluate((e) =>
    e.addEventListener('input', () => {
      const list = document.createElement('div');
      list.id = 'address-list';
      for (const text of ['DIFFERENT 00000', 'SENTINEL 11111']) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        list.append(option);
      }
      document.body.append(list);
    }),
  );
  const address = await run();
  assert.equal(
    address.fields.find((f) => f.field === 'businessAddressLine1')?.status,
    'address-review',
  );
  console.log(
    'PASS full autofill: corporation/separate address, radio groups, idempotency, masks, existing values, ambiguous choices, label/name guards, async changes, address ambiguity, no submission; external network blocked.',
  );
} finally {
  await browser.close();
}
