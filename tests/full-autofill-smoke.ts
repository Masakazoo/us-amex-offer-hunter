/** DOM race regression, synthetic page only; the separate MV3 suite tests real guards. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fullFixtureHtml } from './full-form-fixture.js';
import { fullFieldSpecs } from '../apps/extension/src/full-profile.js';
import { runFullAutofill } from '../apps/extension/src/full-autofill.js';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  // tsx names nested callbacks during serialization; this test-only identity
  // helper has no application behavior. Production uses the esbuild bundle.
  await page.addInitScript('window.__name = (fn) => fn');
  const url = 'http://127.0.0.1:4173/autofill-fixture';
  await page.route('**/*', (route) =>
    route.request().url() === url
      ? route.fulfill({ contentType: 'text/html', body: fullFixtureHtml() })
      : route.abort(),
  );
  async function reset() {
    await page.goto(url);
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        chrome: typeof chrome;
        fault?: () => void;
        clicks: number;
      };
      testWindow.clicks = 0;
      testWindow.chrome = {
        runtime: {
          sendMessage: async (message: {
            fields: { field: string; status: string }[];
          }) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (
              message.fields.some(
                (f) =>
                  f.status === 'ready' &&
                  ![
                    'businessZipCode',
                    'businessAddressLine2',
                    'businessCity',
                    'businessState',
                  ].includes(f.field),
              )
            )
              testWindow.fault?.();
            return { ok: true };
          },
        },
      } as unknown as typeof chrome;
    });
  }
  async function run(
    key: string,
    value: string,
    extra: Record<string, string> = {},
  ) {
    const result = await page.evaluate(runFullAutofill, {
      allowFixture: true,
      specs: fullFieldSpecs.filter((s) => s.key === key || s.key in extra),
      command: {
        action: 'fill',
        source: 'encrypted-vault',
        expectedUrl: url,
        operationId: '00000000-0000-4000-8000-000000000001',
        values: { [key]: value, ...extra },
      },
    });
    return { ...result, fields: result.fields.filter((f) => f.field === key) };
  }
  await reset();
  await page.locator('#sameAddress').check();
  await page.evaluate(() => {
    for (const key of ['zipCode', 'city', 'state']) {
      const el = document.getElementById(key) as
        HTMLInputElement | HTMLSelectElement;
      el.disabled = false;
      el.required = true;
    }
  });
  for (const [key, value] of [
    ['zipCode', '00000'],
    ['city', 'TEST CITY'],
    ['state', 'NY'],
  ]) {
    const result = await run(key!, value!);
    assert.equal(result.fields[0]!.status, 'address-review');
    assert.equal(await page.locator(`#${key}`).inputValue(), '');
  }
  await reset();
  const draftResult = await page.evaluate(runFullAutofill, {
    allowFixture: true,
    specs: fullFieldSpecs,
    command: {
      action: 'fill',
      source: 'encrypted-vault',
      expectedUrl: url,
      operationId: '00000000-0000-4000-8000-000000000001',
      values: { firstName: 'SENTINEL' },
      invalidFields: ['businessPhoneNumber', 'dateOfBirth', 'email'],
    },
  });
  for (const key of ['businessPhoneNumber', 'dateOfBirth', 'email']) {
    assert.equal(
      draftResult.fields.find((f) => f.field === key)?.status,
      'invalid-value',
    );
    assert.equal(await page.locator(`#${key}`).inputValue(), '');
  }
  assert.equal(await page.locator('#firstName').inputValue(), 'SENTINEL');
  // Observed live markup: telephone widgets add an empty second label.
  for (const key of ['businessZipCode', 'businessPhoneNumber', 'cellPhone']) {
    for (const labelText of ['', 'Other field']) {
      await reset();
      await page.evaluate(
        ({ key, labelText }) => {
          const label = document.createElement('label');
          label.htmlFor = key;
          label.textContent = labelText;
          document.getElementById(key)!.after(label);
        },
        { key, labelText },
      );
      const value = key === 'businessZipCode' ? '00000' : '0000000000';
      const result = await run(key, value);
      assert.equal(result.fields[0]!.status, labelText ? 'mismatch' : 'filled');
      assert.equal(
        (await page.locator(`#${key}`).inputValue()).replace(/[ ()-]/g, ''),
        labelText ? '' : value,
      );
    }
  }
  await reset();
  await page.locator('#sameAddress').check();
  for (const [key, value] of [
    ['zipCode', '00000'],
    ['city', 'TEST CITY'],
    ['state', 'NY'],
  ]) {
    const result = await run(key!, value!);
    assert.equal(result.fields[0]!.status, 'address-review');
    assert.equal(await page.locator(`#${key}`).inputValue(), '');
    assert.equal(await page.locator(`#${key}`).isDisabled(), true);
  }
  for (const kind of ['value', 'readonly', 'label', 'duplicate', 'focus']) {
    await reset();
    await page.evaluate((kind) => {
      const e = document.getElementById('firstName') as HTMLInputElement;
      const mutate = () => {
        if (kind === 'value' || kind === 'focus') e.value = 'LATE-EXISTING';
        if (kind === 'readonly') e.readOnly = true;
        if (kind === 'label') e.labels![0]!.textContent = 'Other field';
        if (kind === 'duplicate') e.after(e.cloneNode());
      };
      if (kind === 'focus') e.addEventListener('focus', mutate, { once: true });
      else (window as typeof window & { fault?: () => void }).fault = mutate;
    }, kind);
    const result = await run('firstName', 'SENTINEL');
    assert.ok(['changed', 'existing-value'].includes(result.fields[0]!.status));
    assert.notEqual(
      await page.locator('#firstName').first().inputValue(),
      'SENTINEL',
    );
  }
  await reset();
  await page.evaluate(() => {
    (window as typeof window & { fault?: () => void }).fault = () => {
      const e = document.getElementById(
        'companyStructure',
      ) as HTMLSelectElement;
      e.selectedIndex = 2;
    };
  });
  assert.equal(
    (
      await run(
        'companyStructure',
        fullFieldSpecs.find((s) => s.key === 'companyStructure')!.options![0]!,
      )
    ).fields[0]!.status,
    'existing-value',
  );
  await reset();
  await page.evaluate(() => {
    (window as typeof window & { fault?: () => void }).fault = () => {
      (document.getElementById('doingBusinessAs') as HTMLInputElement).checked =
        true;
    };
  });
  assert.equal(
    (await run('doingBusinessAs', 'yes')).fields[0]!.status,
    'matched',
  );
  assert.equal(await page.locator('#doingBusinessAs').isChecked(), true);
  await reset();
  await page.evaluate(() => {
    for (const e of document.querySelectorAll<HTMLInputElement>(
      'input[type=radio]',
    ))
      e.checked = false;
    (window as typeof window & { fault?: () => void }).fault = () => {
      (document.getElementById('cardDesign-1') as HTMLInputElement).checked =
        true;
    };
  });
  assert.equal(
    (
      await run(
        'cardDesign',
        fullFieldSpecs.find((s) => s.key === 'cardDesign')!.options![0]!,
      )
    ).fields[0]!.status,
    'existing-value',
  );
  for (const kind of [
    'exact',
    'prefix',
    'unit',
    'submit',
    'link',
    'late',
    'edit',
  ]) {
    await reset();
    await page.evaluate((kind) => {
      const list = document.createElement('div');
      list.id = 'address-list';
      const option = document.createElement(
        kind === 'submit' ? 'button' : kind === 'link' ? 'a' : 'div',
      );
      option.setAttribute('role', 'option');
      option.textContent =
        kind === 'prefix'
          ? '112 TEST ST UNIT A TEST CITY NY 00000'
          : kind === 'unit'
            ? '12 TEST ST UNIT B TEST CITY NY 00000'
            : '12 TEST ST UNIT A TEST CITY NY 00000';
      if (option instanceof HTMLButtonElement) option.type = 'submit';
      if (option instanceof HTMLAnchorElement)
        option.href = 'https://example.invalid/forbidden';
      option.onclick = () => {
        (window as typeof window & { clicks: number }).clicks++;
      };
      list.append(option);
      document.querySelector('form')!.append(list);
      if (kind === 'late' || kind === 'edit') {
        let count = 0;
        (window as typeof window & { fault?: () => void }).fault = () => {
          if (++count === 2) {
            if (kind === 'late')
              option.textContent = '112 TEST ST UNIT A TEST CITY NY 00000';
            else
              (
                document.getElementById(
                  'businessAddressLine1',
                ) as HTMLInputElement
              ).value = 'USER-EDITED';
          }
        };
      }
    }, kind);
    const r = await run('businessAddressLine1', '12 TEST ST', {
      businessAddressLine2: 'UNIT A',
      businessCity: 'TEST CITY',
      businessState: 'NY',
      businessZipCode: '00000',
    });
    assert.equal(
      await page.evaluate(
        () => (window as typeof window & { clicks: number }).clicks,
      ),
      kind === 'exact' ? 1 : 0,
      kind,
    );
    assert.equal(
      r.fields[0]!.status,
      kind === 'exact' ? 'filled' : 'address-review',
      kind,
    );
    assert.equal(
      await page.evaluate(
        () => (window as typeof window & { submissions: number }).submissions,
      ),
      0,
    );
  }
  console.log(
    'PASS autofill DOM: guard/focus races, existing text/select/checkbox/radio, exact address only, ambiguous/unsafe/changed suggestions rejected, submit zero',
  );
} finally {
  await browser.close();
}
