/** Product lifecycle QA. Only fresh owned profiles, synthetic fields, loopback routes.
 * Chrome installs once through its UI; restart MUST NOT reinstall the extension. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  fullFieldSpecs,
  type FullProfile,
} from '../apps/extension/src/full-profile.js';
import { fullSentinelProfile } from './vault-fixture.js';
import { fullFixtureHtml } from './full-form-fixture.js';
import { buildExtension } from '../tools/extension-build.js';

await buildExtension(true);
const root = await mkdtemp(join(tmpdir(), 'autofill-release-'));
const extension = join(root, 'extension-fixture');
const profile = join(root, 'browser-profile');
await cp(resolve('dist/extension-fixture'), extension, { recursive: true });
const chromeMode = process.env.PROBE_TEST_BROWSER === 'chrome';
const fixture: FullProfile = {
  ...fullSentinelProfile(),
  email: 'synthetic@example.invalid',
};
const password = 'synthetic release passphrase';
const base = 'http://127.0.0.1:4173/autofill-fixture';
const legacy = {
  version: 1,
  values: { email: 'legacy-synthetic@example.invalid' },
};
let context: BrowserContext | undefined;
let installed = false;
let externalRequests = 0;
const messages: string[] = [];
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    ignoreDefaultArgs: ['--disable-extensions'],
    headless: false,
    ...(chromeMode ? { channel: 'chrome' } : { channel: 'chromium' }),
    args: chromeMode
      ? []
      : [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
  });
  // tsx's serialized nested functions use a naming helper; Object returns the function unchanged.
  await context.addInitScript(
    "Object.defineProperty(globalThis, '__name', { value: Object, configurable: true })",
  );
  context.setDefaultTimeout(15000);
  context.on('page', (page) => {
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', () => messages.push('PAGE_ERROR'));
  });
  await context.route('**/*', (route) => {
    if (route.request().url() === base)
      return route.fulfill({
        contentType: 'text/html',
        body: fullFixtureHtml(),
      });
    if (route.request().url().startsWith('chrome-extension:'))
      return route.continue();
    ++externalRequests;
    return route.abort();
  });
  if (chromeMode && !installed) {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    console.log(
      `ACTION synthetic Chrome only: Developer mode > Load unpacked > ${extension}`,
    );
    await context.waitForEvent('serviceworker', {
      predicate: (worker) => worker.url().endsWith('/worker.js'),
      timeout: 600000,
    });
    installed = true;
    await manager.close();
  }
  const worker =
    context
      .serviceWorkers()
      .find((worker) => worker.url().endsWith('/worker.js')) ??
    (await context.waitForEvent('serviceworker', {
      predicate: (worker) => worker.url().endsWith('/worker.js'),
    }));
  assert.equal(
    await worker.evaluate(() => chrome.runtime.getManifest().name),
    'Amex Autofill — Synthetic test only',
  );
  return { context, id: new URL(worker.url()).host };
}
async function eventually(check: () => Promise<unknown>) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('SYNTHETIC_LIFECYCLE_CONDITION_TIMEOUT');
}
async function state(page: Page, id: string, text: string) {
  await page.waitForFunction(
    ({ id, text }) => document.getElementById(id)?.textContent === text,
    { id, text },
  );
}
async function createProfile(settings: Page) {
  for (const section of ['business', 'personal', 'design']) {
    await settings.locator(`#nav-${section}`).click();
    for (const spec of fullFieldSpecs.filter(
      (spec) => spec.section === section,
    )) {
      const control = settings.locator(`#field-${spec.key}`);
      if (!(await control.isVisible())) continue;
      const value = fixture[spec.key] ?? '';
      if (spec.kind === 'checkbox') await control.setChecked(value === 'yes');
      else if (spec.kind === 'select') await control.selectOption(value);
      else if (spec.kind === 'radio')
        await settings
          .locator(`input[name="${spec.key}"]`)
          .evaluateAll((nodes, value) => {
            (
              nodes.find(
                (node) => (node as HTMLInputElement).value === value,
              ) as HTMLInputElement
            ).click();
          }, value);
      else await control.fill(value);
    }
  }
  await settings.locator('#nav-security').click();
  await settings.locator('#new-password').fill(password);
  await settings.locator('#confirm-password').fill(password);
  await settings.locator('#save-profile').click();
  await state(settings, 'vault-status', 'ロック中');
}
async function unlock(popup: Page, keep = true) {
  await popup.locator('#password').fill(password);
  await popup.locator('#keep').setChecked(keep);
  await popup.locator('#unlock').click();
  await state(popup, 'vault-state', '解除済み');
}
async function waitTarget(popup: Page) {
  await popup
    .getByText('対応する申込フォームを検出しました', { exact: true })
    .waitFor();
  await popup.locator('#fill:visible:enabled').waitFor();
}
async function fill(popup: Page) {
  await waitTarget(popup);
  await popup.locator('#fill').click();
  await state(popup, 'phase', '処理が完了しました');
}
async function noSubmit(page: Page) {
  assert.equal(
    await page.evaluate(
      () => (window as typeof window & { submissions: number }).submissions,
    ),
    0,
  );
}
async function legacyUnchanged(settings: Page) {
  assert.deepEqual(
    await settings.evaluate(
      async () =>
        (await chrome.storage.local.get('autofillProfileV1')).autofillProfileV1,
    ),
    legacy,
  );
}

try {
  let { context: ctx, id } = await launch();
  console.log(
    `ENV ${process.platform} Chrome ${ctx.browser()?.version()} mode=${chromeMode ? 'normal-Chrome-UI-installed' : 'Chromium-command-line'}`,
  );
  let settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.evaluate(
    (legacy) => chrome.storage.local.set({ autofillProfileV1: legacy }),
    legacy,
  );
  await settings.reload();
  await state(settings, 'vault-status', '未登録');
  assert.equal(await settings.locator('#field-email').inputValue(), '');
  await createProfile(settings);
  await legacyUnchanged(settings);
  const ciphertext = await settings.evaluate(async () =>
    JSON.stringify(
      (await chrome.storage.local.get('encryptedProfileV1')).encryptedProfileV1,
    ),
  );
  assert.ok(!/SENTINEL|synthetic|000000000|passphrase/.test(ciphertext));
  // End Chrome while unlocked, not merely already locked, to test session expiry.
  await settings.locator('#unlock-password').fill(password);
  await settings.locator('#unlock-submit').click();
  await state(settings, 'vault-status', '解除済み');
  await ctx.close();
  ({ context: ctx, id } = await launch());
  settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await state(settings, 'vault-status', 'ロック中');
  assert.equal(
    await settings.evaluate(async () =>
      JSON.stringify(
        (await chrome.storage.local.get('encryptedProfileV1'))
          .encryptedProfileV1,
      ),
    ),
    ciphertext,
  );
  await legacyUnchanged(settings);
  console.log(
    'PASS release: settings registration, legacy record ignored/preserved, encrypted persistence and locked restart without Chrome reinstall',
  );
  let target = await ctx.newPage();
  await target.goto(base);
  let popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await target.bringToFront();
  await state(popup, 'vault-state', 'ロック中');
  assert.equal(await popup.locator('#keep').isChecked(), true);
  await popup.locator('#password').fill('incorrect synthetic password');
  await popup.locator('#unlock').click();
  await popup
    .getByText('パスワードが違うか、登録情報を開けません。', { exact: true })
    .waitFor();
  await popup.waitForTimeout(1100);
  const started = performance.now();
  await unlock(popup);
  console.log(
    `MEASURE synthetic unlock roundtrip milliseconds=${Math.round(performance.now() - started)} (single machine; not a low-end benchmark)`,
  );
  assert.equal(await target.locator('#email').inputValue(), '');
  await fill(popup);
  await noSubmit(target);
  assert.match(await popup.locator('#summary').innerText(), /入力済み [1-9]/);
  await fill(popup);
  assert.match(await popup.locator('#summary').innerText(), /一致済み [1-9]/);
  await noSubmit(target);
  // Cross-window stale start must not silently retarget or inject into either page.
  await target.reload();
  await target.bringToFront();
  await waitTarget(popup);
  const beforeWindow = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ channel: 'autofill-v1', op: 'view' }),
  );
  const firstWindowId = await settings.evaluate(
    async (tabId) => (await chrome.tabs.get(tabId)).windowId,
    beforeWindow.view.target.tabId,
  );
  const createdPage = ctx.waitForEvent('page');
  const secondWindow = await settings.evaluate(
    (url) => chrome.windows.create({ url, focused: true }),
    base,
  );
  const other = await createdPage;
  await other.waitForURL(base);
  await other.locator('#email').waitFor();
  await other.bringToFront();
  assert.deepEqual(
    await popup.evaluate(
      (view) =>
        chrome.runtime.sendMessage({
          channel: 'autofill-v1',
          op: 'start',
          ...view.target,
          revision: view.status.revision,
          epoch: view.status.epoch,
          operationId: crypto.randomUUID(),
        }),
      beforeWindow.view,
    ),
    { ok: false, error: 'CANCELLED' },
  );
  assert.equal(await target.locator('#email').inputValue(), '');
  assert.equal(await other.locator('#email').inputValue(), '');
  // Pause the real isolated-world guard after email. Background-window scheduling
  // must not turn this test into a race where all fields finish before focus changes.
  const otherTabId = secondWindow!.tabs![0]!.id!;
  await settings.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        Object.defineProperty(globalThis, '__name', {
          value: Object,
          configurable: true,
        });
      },
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const gate = globalThis as typeof globalThis & {
          releaseFocusGate?: () => void;
          focusGateReached?: boolean;
          focusGuardRejected?: boolean;
        };
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = (async (message: {
          op?: string;
          fields?: { field: string; status: string }[];
        }) => {
          let held = false;
          if (
            message.op === 'guard' &&
            message.fields?.some(
              (field) => field.field === 'email' && field.status === 'filled',
            ) &&
            !gate.focusGateReached
          ) {
            held = true;
            await new Promise<void>((resolve) => {
              gate.releaseFocusGate = resolve;
              gate.focusGateReached = true;
            });
          }
          const reply = await original(message);
          if (held) gate.focusGuardRejected = reply?.ok === false;
          return reply;
        }) as typeof chrome.runtime.sendMessage;
      },
    });
  }, otherTabId);
  await waitTarget(popup);
  await popup.locator('#fill').click();
  await eventually(() =>
    settings.evaluate(async (tabId) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () =>
          !!(globalThis as typeof globalThis & { focusGateReached?: boolean })
            .focusGateReached,
      });
      return result?.result;
    }, otherTabId),
  );
  assert.equal(await other.locator('#email').inputValue(), fixture.email);

  const controlsBeforeFocus = await other
    .locator('input,select')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.id,
        value: (node as HTMLInputElement).value,
        checked: (node as HTMLInputElement).checked,
      })),
    );
  await target.bringToFront();
  await settings.evaluate(
    (windowId) => chrome.windows.update(windowId, { focused: true }),
    firstWindowId,
  );
  await eventually(() =>
    settings.evaluate(
      async (windowId) =>
        (await chrome.windows.getLastFocused()).id === windowId,
      firstWindowId,
    ),
  );
  await settings.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () =>
        (
          globalThis as typeof globalThis & { releaseFocusGate?: () => void }
        ).releaseFocusGate?.(),
    });
  }, otherTabId);
  await eventually(() =>
    settings.evaluate(async (tabId) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () =>
          !!(globalThis as typeof globalThis & { focusGuardRejected?: boolean })
            .focusGuardRejected,
      });
      return result?.result;
    }, otherTabId),
  );
  await popup.waitForFunction(
    () =>
      !document.getElementById('cancel') ||
      (document.getElementById('cancel') as HTMLElement).hidden,
  );
  assert.equal(await target.locator('#email').inputValue(), '');
  assert.equal(await other.locator('#ssn').inputValue(), '');
  assert.deepEqual(
    await other.locator('input,select').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.id,
        value: (node as HTMLInputElement).value,
        checked: (node as HTMLInputElement).checked,
      })),
    ),
    controlsBeforeFocus,
  );
  await noSubmit(other);
  await noSubmit(target);
  assert.equal(await popup.locator('#outcome').isVisible(), false);
  await settings.evaluate(
    (windowId) => chrome.windows.remove(windowId),
    secondWindow!.id!,
  );
  console.log(
    'PASS release: stale cross-window start rejected, focus change stops remaining input, no result crossover and no submit',
  );
  await target.bringToFront();
  await popup.locator('#lock:visible').click();
  await state(popup, 'vault-state', 'ロック中');
  await unlock(popup, false);
  await fill(popup);
  await state(popup, 'vault-state', 'ロック中');
  await noSubmit(target);
  // Unpacked distribution update at the same path/id, preserving ciphertext.
  await unlock(popup);
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  manifest.version = '0.4.1';
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  if (chromeMode) {
    const oldWorker = ctx
      .serviceWorkers()
      .find((worker) => worker.url().endsWith('/worker.js'))!;
    const replaced = ctx.waitForEvent('serviceworker', {
      predicate: (worker) =>
        worker !== oldWorker && worker.url().endsWith('/worker.js'),
    });
    await settings.evaluate(() => {
      setTimeout(() => chrome.runtime.reload(), 100);
    });
    const newWorker = await replaced;
    assert.equal(
      await newWorker.evaluate(() => chrome.runtime.getManifest().version),
      '0.4.1',
    );
  } else {
    // Command-line-loaded Chromium extensions can become blocked on runtime.reload.
    // This branch tests a versioned restart, not a UI-installed Chrome reload.
    const previousId = id;
    await ctx.close();
    ({ context: ctx, id } = await launch());
    assert.equal(id, previousId);
    const updatedWorker = ctx
      .serviceWorkers()
      .find((worker) => worker.url().endsWith('/worker.js'))!;
    assert.equal(
      await updatedWorker.evaluate(() => chrome.runtime.getManifest().version),
      '0.4.1',
    );
    target = await ctx.newPage();
    await target.goto(base);
  }
  // Extension-owned tabs may be closed or invalidated by reload; create new documents.
  settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await state(settings, 'vault-status', 'ロック中');
  await legacyUnchanged(settings);
  assert.equal(
    await settings.evaluate(async () =>
      JSON.stringify(
        (await chrome.storage.local.get('encryptedProfileV1'))
          .encryptedProfileV1,
      ),
    ),
    ciphertext,
  );
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await target.bringToFront();
  await state(popup, 'vault-state', 'ロック中');
  await unlock(popup);
  await target.reload();
  await popup.reload();
  await target.bringToFront();
  await fill(popup);
  await noSubmit(target);
  console.log(
    `PASS release: keep OFF consumes unlock; versioned ${chromeMode ? 'Chrome runtime reload' : 'Chromium browser restart (not runtime reload)'} preserves ciphertext, expires session, requires password and remains usable`,
  );
  // Product reset affects its own vault only. The seeded legacy record is not migrated/deleted.
  await settings.bringToFront();
  await state(settings, 'vault-status', '解除済み');
  await settings.locator('#open-editor').click();
  await settings.locator('#nav-security').click();
  await settings.locator('#reset-profile').click();
  assert.equal(await settings.locator('#confirm-reset').isDisabled(), true);
  await settings.locator('#cancel-reset').click();
  assert.equal(
    await settings.evaluate(async () =>
      JSON.stringify(
        (await chrome.storage.local.get('encryptedProfileV1'))
          .encryptedProfileV1,
      ),
    ),
    ciphertext,
  );
  await settings.locator('#reset-profile').click();
  await settings.locator('#reset-acknowledge').check();
  await settings.locator('#confirm-reset').click();
  await state(settings, 'vault-status', '未登録');
  await legacyUnchanged(settings);
  const stored = await settings.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    delete local.autofillProfileV1; // Only this test's intentionally seeded legacy record is plaintext.
    return {
      local,
      session: await chrome.storage.session.get(null),
      sync: await chrome.storage.sync.get(null),
    };
  });
  assert.deepEqual(stored.sync, {});
  assert.ok(
    !/SENTINEL|synthetic|000000000|passphrase/.test(JSON.stringify(stored)),
  );
  assert.ok(
    !messages.some((message) =>
      /PAGE_ERROR|SENTINEL|synthetic@example|000000000|passphrase/.test(
        message,
      ),
    ),
  );
  assert.equal(externalRequests, 0);
  console.log(
    'PASS release: reset confirmation/cancel; only new vault reset; synthetic legacy remains; no secret logs or external page requests',
  );
} finally {
  await context?.close();
  await rm(root, { recursive: true, force: true });
}
