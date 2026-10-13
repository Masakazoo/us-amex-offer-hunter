/** Real MV3 popup + encrypted vault + isolated-world full-form integration.
 * Synthetic data in an owned disposable profile. No actual Amex requests. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { fullFixtureHtml } from './full-form-fixture.js';
import { fullSentinelProfile } from './vault-fixture.js';
const pw = '合成のみのパスフレーズ Synthetic password'.repeat(20);
const fixture = {
  ...fullSentinelProfile(),
  email: 'synthetic@example.invalid',
  legalBusinessName: 'SENTINEL'.repeat(10),
};
const base = 'http://127.0.0.1:4173/autofill-fixture';
const chromeMode = process.env.PROBE_TEST_BROWSER === 'chrome';
const context = await chromium.launchPersistentContext('', {
  ignoreDefaultArgs: ['--disable-extensions'],
  headless: !chromeMode && process.env.POPUP_HEADED !== '1',
  ...(chromeMode
    ? { channel: 'chrome' }
    : process.env.PROBE_TEST_BROWSER === 'chromium'
      ? { channel: 'chromium' }
      : {
          executablePath:
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        }),
  args: chromeMode
    ? ['--enable-unsafe-extension-debugging']
    : [
        `--disable-extensions-except=${resolve('dist/extension-fixture')}`,
        `--load-extension=${resolve('dist/extension-fixture')}`,
      ],
});
const logs: string[] = [];
let unexpectedRequests = 0;
try {
  context.setDefaultTimeout(15000);
  context.on('page', (p) => {
    p.on('console', (m) => logs.push(m.text()));
    p.on('pageerror', () => logs.push('PAGE_ERROR'));
  });
  await context.route('**/*', (route) => {
    if (route.request().url() === base)
      return route.fulfill({
        contentType: 'text/html',
        body: fullFixtureHtml(),
      });
    if (route.request().url().startsWith('chrome-extension:'))
      return route.continue();
    ++unexpectedRequests;
    return route.abort();
  });
  if (chromeMode) {
    const cdp = await context.browser()!.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', {
      path: resolve('dist/extension-fixture'),
    });
  }
  let worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const target = await context.newPage();
  await target.goto(base);
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  let popup!: Page;
  async function openPopup() {
    // A popup document test tab must not steal the active target during a run.
    await target.bringToFront();
    const opened = context.waitForEvent('page');
    await settings.evaluate(
      (url) => chrome.tabs.create({ url, active: false }),
      `chrome-extension://${id}/popup.html`,
    );
    popup = await opened;
    await popup.waitForURL(`chrome-extension://${id}/popup.html`);
    await popup
      .getByText('対応する申込フォームを検出しました', { exact: true })
      .waitFor();
  }
  async function vaultState(text: string) {
    await popup.waitForFunction(
      (text) => document.getElementById('vault-state')?.textContent === text,
      text,
    );
  }
  async function unlock(keep = true) {
    await popup.locator('#password').fill(pw);
    await popup.locator('#keep').setChecked(keep);
    await popup.locator('#unlock').click();
    await vaultState('解除済み');
  }
  async function completed() {
    await popup.waitForFunction(
      () =>
        document.getElementById('phase')?.textContent === '処理が完了しました',
      undefined,
      { timeout: 30000 },
    );
  }
  async function resetPage() {
    await target.reload();
    await target.bringToFront();
    await popup
      .getByText('対応する申込フォームを検出しました', { exact: true })
      .waitFor();
    await popup.waitForTimeout(600);
  }
  await openPopup();
  await vaultState('未登録');
  await target.goto('about:blank');
  await popup
    .getByText('対応するAmex申込ページで使用してください', { exact: true })
    .waitFor();
  assert.equal(await popup.locator('#fill').isVisible(), false);
  await target.goto(base);
  await target.bringToFront();
  assert.equal(await popup.locator('#register').isVisible(), true);
  const created = await settings.evaluate(
    async ({ fixture, pw }) =>
      chrome.runtime.sendMessage({
        channel: 'profile-vault-v1',
        op: 'create',
        profile: fixture,
        password: pw,
      }),
    { fixture, pw },
  );
  assert.equal(created.ok, true);
  await vaultState('ロック中');
  await popup.locator('#password').fill('WRONG SYNTHETIC PASSWORD');
  await popup.locator('#unlock').click();
  await popup
    .getByText('パスワードが違うか、登録情報を開けません。', { exact: true })
    .waitFor();
  await popup.waitForTimeout(1100);
  // Composition must not submit an incomplete passphrase.
  await popup.locator('#password').fill(pw);
  await popup.locator('#password').dispatchEvent('compositionstart');
  await popup.locator('#unlock-form').dispatchEvent('submit');
  await vaultState('ロック中');
  await popup.locator('#password').dispatchEvent('compositionend');
  await unlock();
  assert.equal(await target.locator('#firstName').inputValue(), '');
  assert.equal(await popup.locator('#password').inputValue(), '');
  await popup.locator('#fill').click();
  await target.waitForFunction(
    () => !!(document.getElementById('email') as HTMLInputElement).value,
  );
  const duplicate = await popup.evaluate(async () => {
    const { view } = await chrome.runtime.sendMessage({
      channel: 'autofill-v1',
      op: 'view',
    });
    return chrome.runtime.sendMessage({
      channel: 'autofill-v1',
      op: 'start',
      ...view.target,
      operationId: crypto.randomUUID(),
      revision: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
    });
  });
  assert.equal(duplicate.ok, false);
  await popup.close();
  await openPopup();
  await completed();
  assert.equal(await target.locator('#firstName').inputValue(), 'SENTINEL');
  assert.equal(
    await target.evaluate(
      () => (window as typeof window & { submissions: number }).submissions,
    ),
    0,
  );
  assert.equal(await popup.locator('#results li').count(), 36);
  assert.ok(!(await popup.locator('body').innerText()).includes('SENTINEL'));
  assert.ok(!(await popup.locator('body').innerText()).includes('000000000'));
  // Preserve mismatched dropdown/radio/text choices, and report partial failures.
  await resetPage();
  await target.locator('#firstName').fill('EXISTING');
  await target
    .locator('#companyStructure')
    .selectOption({ label: 'Corporation' });
  await target
    .locator('#lastName')
    .evaluate((e) => e.setAttribute('disabled', ''));
  await popup.locator('#fill').click();
  await completed();
  assert.equal(await target.locator('#firstName').inputValue(), 'EXISTING');
  assert.equal(
    await target.locator('#companyStructure option:checked').textContent(),
    'Corporation',
  );
  assert.ok(
    (await popup.locator('#results').textContent())?.includes('既存値を保持'),
    (await popup.locator('#results').textContent()) ?? '',
  );
  assert.ok(
    (await popup.locator('#results').textContent())?.includes('非表示・無効'),
  );
  // Stop a long-running fill through the popup. No later fields may be written.
  await resetPage();
  await popup.locator('#fill').click();
  await target.waitForFunction(
    () => !!(document.getElementById('email') as HTMLInputElement).value,
  );
  await popup.locator('#cancel').click();
  await popup.getByText('入力を停止しました', { exact: true }).waitFor();
  assert.equal(await target.locator('#ssn').inputValue(), '');
  // A manual lock from settings invalidates the running consumer, not only its UI.
  await resetPage();
  await popup.locator('#fill').click();
  await target.waitForFunction(
    () => !!(document.getElementById('email') as HTMLInputElement).value,
  );
  await settings.evaluate(async () =>
    chrome.runtime.sendMessage({ channel: 'profile-vault-v1', op: 'lock' }),
  );
  await vaultState('ロック中');
  assert.equal(await target.locator('#ssn').inputValue(), '');
  // A stale inspection cannot start on a replacement document.
  const oldView = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ channel: 'autofill-v1', op: 'view' }))
        .view,
  );
  await target.reload();
  const rejected = await popup.evaluate(
    async (v) =>
      chrome.runtime.sendMessage({
        channel: 'autofill-v1',
        op: 'start',
        ...v.target,
        revision: crypto.randomUUID(),
        epoch: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
      }),
    oldView,
  );
  assert.equal(rejected.ok, false);
  await popup.waitForTimeout(1100);
  await unlock(false);
  await resetPage();
  await popup.locator('#fill').click();
  await completed();
  await vaultState('ロック中');
  // Document navigation invalidates an inspected target. Old results never cross documents.
  await popup.waitForTimeout(1100);
  await unlock();
  await resetPage();
  await popup.locator('#fill').click();
  await target.waitForFunction(
    () => !!(document.getElementById('email') as HTMLInputElement).value,
  );
  await target.reload();
  await popup.waitForTimeout(1000);
  assert.equal(await target.locator('#firstName').inputValue(), '');
  assert.equal(await popup.locator('#outcome').isVisible(), false);
  // Hold and fail final result persistence: no overlapping run and no false success.
  await resetPage();
  worker = context
    .serviceWorkers()
    .find((w) => w.url().endsWith('/worker.js'))!;
  await worker.evaluate(() => {
    const original = chrome.storage.session.set.bind(chrome.storage.session);
    chrome.storage.session.set = (async (items: Record<string, unknown>) => {
      if (
        (items.autofillResultV1 as { phase?: string } | undefined)?.phase ===
        'completed'
      ) {
        chrome.storage.session.set = original;
        await new Promise<void>((_resolve, reject) => {
          (
            globalThis as typeof globalThis & { releaseFinal?: () => void }
          ).releaseFinal = () => reject(new Error('SYNTHETIC_STORAGE_FAILURE'));
        });
      }
      return original(items);
    }) as typeof chrome.storage.session.set;
  });
  await popup.locator('#fill').click();
  await worker.evaluate(async () => {
    while (
      typeof (globalThis as typeof globalThis & { releaseFinal?: () => void })
        .releaseFinal !== 'function'
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const held = await popup.evaluate(async () => {
    const { view } = await chrome.runtime.sendMessage({
      channel: 'autofill-v1',
      op: 'view',
    });
    const reply = await chrome.runtime.sendMessage({
      channel: 'autofill-v1',
      op: 'start',
      ...view.target,
      revision: crypto.randomUUID(),
      epoch: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
    });
    return { view, reply };
  });
  assert.equal(held.view.busy, true);
  assert.equal(held.view.run.phase, 'running');
  assert.equal(held.reply.ok, false);
  await worker.evaluate(() =>
    (
      globalThis as typeof globalThis & { releaseFinal?: () => void }
    ).releaseFinal?.(),
  );
  await popup
    .getByText(
      '入力結果を保存できませんでした。ページの内容を確認してください。',
      { exact: true },
    )
    .waitFor();
  await vaultState('解除済み');
  await resetPage();
  // Forced worker restart must mark an unfinished operation interrupted, never replay it.
  await popup.locator('#fill:visible:enabled').waitFor();
  await popup.locator('#fill').click();
  await target.waitForFunction(
    () => !!(document.getElementById('email') as HTMLInputElement).value,
  );
  const cdp = await context.newCDPSession(target);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await popup.waitForFunction(
    () =>
      document.getElementById('phase')?.textContent?.includes('中断されました'),
    undefined,
    { timeout: 20000 },
  );
  const stopSnapshot = await target.locator('#ssn').inputValue();
  assert.equal(stopSnapshot, '');
  await popup.waitForTimeout(700);
  assert.equal(await target.locator('#ssn').inputValue(), stopSnapshot);
  if (process.env.POPUP_SCREENSHOT) {
    await popup.setViewportSize({ width: 370, height: 740 });
    await popup.screenshot({
      path: process.env.POPUP_SCREENSHOT,
      fullPage: true,
    });
  }
  if (chromeMode) {
    // Exercise the browser's actual action popup, not only its HTML in a test tab.
    await popup.close();
    await target.reload();
    await target.bringToFront();
    await settings.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      await chrome.windows.update(tab!.windowId, { focused: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await chrome.action.openPopup({ windowId: tab!.windowId });
    });
    await settings.waitForFunction(
      () =>
        chrome.extension
          .getViews({ type: 'popup' })[0]
          ?.document.getElementById('vault-state')?.textContent === '解除済み',
    );
    await settings.evaluate(() =>
      (
        chrome.extension
          .getViews({ type: 'popup' })[0]!
          .document.getElementById('lock') as HTMLButtonElement
      ).click(),
    );
    await settings.waitForFunction(
      () =>
        chrome.extension
          .getViews({ type: 'popup' })[0]
          ?.document.getElementById('vault-state')?.textContent === 'ロック中',
    );
    await settings.evaluate((pw) => {
      const doc = chrome.extension.getViews({ type: 'popup' })[0]!.document;
      (doc.getElementById('password') as HTMLInputElement).value = pw;
      (doc.getElementById('unlock-form') as HTMLFormElement).requestSubmit();
    }, pw);
    await settings.waitForFunction(
      () =>
        chrome.extension
          .getViews({ type: 'popup' })[0]
          ?.document.getElementById('vault-state')?.textContent === '解除済み',
    );
    assert.equal(await target.locator('#email').inputValue(), '');
    await settings.evaluate(() =>
      (
        chrome.extension
          .getViews({ type: 'popup' })[0]!
          .document.getElementById('fill') as HTMLButtonElement
      ).click(),
    );
    await target.waitForFunction(
      () => !!(document.getElementById('email') as HTMLInputElement).value,
    );
    await settings.evaluate(() =>
      chrome.extension.getViews({ type: 'popup' })[0]!.close(),
    );
    await target.waitForFunction(
      () => !!(document.getElementById('ssn') as HTMLInputElement).value,
      undefined,
      { timeout: 30000 },
    );
    await settings.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      await chrome.windows.update(tab!.windowId, { focused: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await chrome.action.openPopup({ windowId: tab!.windowId });
    });
    await settings.waitForFunction(
      () =>
        chrome.extension
          .getViews({ type: 'popup' })[0]
          ?.document.getElementById('phase')?.textContent ===
        '処理が完了しました',
    );
    await settings.evaluate(() =>
      chrome.extension.getViews({ type: 'popup' })[0]!.close(),
    );
    console.log(
      'PASS normal Chrome: native action popup explicit fill, close during fill, reopen result',
    );
  }
  worker =
    context.serviceWorkers().find((w) => w.url().endsWith('/worker.js')) ??
    (await context.waitForEvent('serviceworker'));
  const stored = await settings.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    result: (await chrome.storage.session.get('autofillResultV1'))
      .autofillResultV1,
    sync: await chrome.storage.sync.get(null),
  }));
  assert.ok(
    !/SENTINEL|synthetic@example|000000000|Synthetic password/.test(
      JSON.stringify(stored),
    ),
  );
  assert.deepEqual(stored.sync, {});
  assert.equal(
    logs.some((s) =>
      /PAGE_ERROR|SENTINEL|000000000|Synthetic password/.test(s),
    ),
    false,
  );
  assert.equal(
    await target.evaluate(
      () => (window as typeof window & { submissions: number }).submissions,
    ),
    0,
  );
  assert.equal(unexpectedRequests, 0);
  console.log(
    'PASS popup: registration, IME/wrong password, explicit full fill, no submit, popup reopen, duplicate refusal, existing values, partial result, cancel/lock, keep OFF, navigation, worker interruption, no secret output',
  );
} finally {
  await context.close();
}
