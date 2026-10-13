/** Production extension UI, disposable profile, synthetic data only. No traces. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { type BrowserContext, type Page } from 'playwright';
import { launchSettingsBrowser } from './settings-browser.js';
import {
  fullFieldSpecs,
  type FullProfile,
} from '../apps/extension/src/full-profile.js';
import { fullSentinelProfile } from './vault-fixture.js';
const fixture: FullProfile = {
  ...fullSentinelProfile(),
  email: 'synthetic@example.invalid',
};
const password = 'synthetic settings password';
const nextPassword = 'replacement synthetic password';
const profile = await mkdtemp(join(tmpdir(), 'settings-ui-'));
const extension = resolve('dist/extension');
let browserSession = await launchSettingsBrowser(profile, extension);
let context = browserSession.context;
const messages: string[] = [];
let externalRequests = 0;
async function secureContext(ctx: BrowserContext) {
  await ctx.route('**/*', (route) => {
    if (new URL(route.request().url()).protocol === 'chrome-extension:')
      return route.continue();
    ++externalRequests;
    return route.abort();
  });
  ctx.on('page', (page) => {
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', () => messages.push('UNEXPECTED_PAGE_ERROR'));
  });
  ctx.setDefaultTimeout(10000);
}
const field = (page: Page, key: string) => page.locator(`#field-${key}`);
async function status(page: Page, text: string) {
  await page.waitForFunction(
    (text) => document.getElementById('vault-status')?.textContent === text,
    text,
  );
}
async function go(page: Page, section: string) {
  await page.locator(`#nav-${section}`).click();
}
// Hold a real request before dispatch, so the busy assertions cannot race a
// fast crypto operation. Release through the original API; do not fake success.
async function whileBusy(
  page: Page,
  op: string,
  trigger: () => Promise<unknown>,
) {
  await page.evaluate((op) => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const gate = window as typeof window & { releaseBusyRequest?: () => void };
    chrome.runtime.sendMessage = (async (
      message: Record<string, unknown>,
    ): Promise<unknown> => {
      if (message.op === op) {
        chrome.runtime.sendMessage = original;
        await new Promise<void>((resolve) => {
          gate.releaseBusyRequest = resolve;
        });
      }
      return original(message);
    }) as typeof chrome.runtime.sendMessage;
  }, op);
  try {
    await trigger();
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { releaseBusyRequest?: () => void })
          .releaseBusyRequest === 'function',
    );
    assert.equal(
      await page.locator('#profile-form').getAttribute('aria-busy'),
      'true',
    );
    const visible = page.locator('input,select').filter({ visible: true });
    if (op === 'unlock')
      assert.ok(await visible.count(), 'unlock must exercise visible controls');
    assert.deepEqual(
      await visible.evaluateAll((nodes) =>
        nodes
          .filter(
            (node) => !(node as HTMLInputElement | HTMLSelectElement).disabled,
          )
          .map((node) => node.id),
      ),
      [],
      `${op}: visible controls must be disabled`,
    );
    // The profile is concealed during some operations. Its conditional fields
    // must also stay disabled, ready for any render while the request is pending.
    assert.equal(
      await page
        .locator('#profile-form input:enabled, #profile-form select:enabled')
        .count(),
      0,
    );
    // A disabled text field cannot accept focus or keyboard edits.
    const text = page
      .locator('input[type="password"]')
      .filter({ visible: true })
      .first();
    if (await text.count()) {
      const before = await text.inputValue();
      await text.focus();
      assert.equal(
        await text.evaluate((node) => node === document.activeElement),
        false,
      );
      await page.keyboard.type('SHOULD-NOT-BE-ENTERED');
      assert.equal(await text.inputValue(), before);
    }
  } finally {
    await page.evaluate(() => {
      const gate = window as typeof window & {
        releaseBusyRequest?: () => void;
      };
      gate.releaseBusyRequest?.();
      delete gate.releaseBusyRequest;
    });
  }
}
async function conditionsRestored(page: Page) {
  await page.waitForFunction(
    () =>
      document.getElementById('profile-form')?.getAttribute('aria-busy') ===
      'false',
  );
  assert.deepEqual(
    await page.locator('.field').evaluateAll((fields) =>
      fields.flatMap((wrapper) =>
        Array.from(
          wrapper.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            'input,select',
          ),
        )
          .filter(
            (control) => control.disabled !== (wrapper as HTMLElement).hidden,
          )
          .map((control) => control.id),
      ),
    ),
    [],
    'idle: only conditionally inactive profile fields remain disabled',
  );
}
async function unlock(page: Page, pw = password, keep = true) {
  await page.waitForTimeout(1100);
  await page.locator('#unlock-password').fill(pw);
  await page.locator('#keep-unlocked').setChecked(keep);
  await whileBusy(page, 'unlock', () => page.locator('#unlock-submit').click());
  await page.locator('#profile-form:not([hidden])').waitFor();
  await status(page, '解除済み');
  await conditionsRestored(page);
}
async function fillAll(page: Page) {
  for (const section of ['business', 'personal', 'design']) {
    await go(page, section);
    for (const spec of fullFieldSpecs.filter((s) => s.section === section)) {
      const control = field(page, spec.key);
      if (!(await control.isVisible())) continue;
      const value = fixture[spec.key] ?? '';
      if (spec.kind === 'checkbox') await control.setChecked(value === 'yes');
      else if (spec.kind === 'select') await control.selectOption(value);
      else if (spec.kind === 'radio')
        await page
          .locator(`input[name="${spec.key}"]`)
          .filter({ visible: true })
          .evaluateAll((nodes, value) => {
            const node = nodes.find(
              (n) => (n as HTMLInputElement).value === value,
            ) as HTMLInputElement;
            node.click();
          }, value);
      else await control.fill(value);
    }
  }
}
async function savedSnapshot(page: Page) {
  return page.evaluate(async () =>
    JSON.stringify(
      (await chrome.storage.local.get('encryptedProfileV1')).encryptedProfileV1,
    ),
  );
}
async function screenshot(page: Page, name: string) {
  if (!process.env.SETTINGS_SCREENSHOTS) return;
  await mkdir(process.env.SETTINGS_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: join(process.env.SETTINGS_SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}
try {
  await secureContext(context);
  const worker =
    context
      .serviceWorkers()
      .find((worker) => worker.url().endsWith('/worker.js')) ??
    (await context.waitForEvent('serviceworker', {
      predicate: (worker) => worker.url().endsWith('/worker.js'),
    }));
  assert.deepEqual(
    await worker.evaluate(() => chrome.runtime.getManifest().options_ui),
    { open_in_tab: true, page: 'settings.html' },
  );
  const id = new URL(worker.url()).host;
  const url = `chrome-extension://${id}/settings.html`;
  let page = await context.newPage();
  await page.setViewportSize({ width: 1360, height: 950 });
  await page.goto(url);
  await status(page, '未登録');
  await page.locator('#profile-form:not([hidden])').waitFor();
  assert.equal(await page.locator('.field').count(), 36);
  assert.equal(await page.locator('.unverified').count(), 6);
  for (const spec of fullFieldSpecs)
    assert.ok(
      (
        await page
          .locator(`[data-field="${spec.key}"] label`)
          .first()
          .textContent()
      )?.includes(spec.label),
    );
  await screenshot(page, '01-business');
  await page.setViewportSize({ width: 600, height: 850 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await screenshot(page, '01-mobile');
  await page.setViewportSize({ width: 1360, height: 950 });
  await page.locator('#save-profile').click();
  await page.locator('#error-summary:not([hidden])').waitFor();
  assert.ok((await page.locator('#error-summary button').count()) > 0);
  await fillAll(page);
  await go(page, 'business');
  assert.equal(await field(page, 'companyDBAName').isVisible(), false);
  assert.equal(await field(page, 'federalTaxId').isVisible(), false);
  await field(page, 'doingBusinessAs').uncheck();
  assert.equal(await field(page, 'companyDBAName').isVisible(), true);
  assert.equal(
    await field(page, 'companyDBAName').getAttribute('required'),
    '',
  );
  await conditionsRestored(page);
  await field(page, 'doingBusinessAs').check();
  await conditionsRestored(page);
  await field(page, 'companyStructure').selectOption('Corporation');
  assert.equal(await field(page, 'federalTaxId').isVisible(), true);
  await conditionsRestored(page);
  await field(page, 'companyStructure').selectOption('Sole Proprietorship');
  await conditionsRestored(page);
  await go(page, 'personal');
  assert.equal(await field(page, 'addressLine1').isVisible(), false);
  await field(page, 'sameAddress').uncheck();
  assert.equal(await field(page, 'addressLine1').isVisible(), true);
  await conditionsRestored(page);
  await field(page, 'sameAddress').check();
  await conditionsRestored(page);
  assert.equal(await field(page, 'ssn').getAttribute('type'), 'password');
  assert.equal(
    await field(page, 'dateOfBirth').getAttribute('type'),
    'password',
  );
  await page.locator('[data-for="field-ssn"]').click();
  assert.equal(await field(page, 'ssn').getAttribute('type'), 'text');
  await page.locator('[data-for="field-ssn"]').click();
  await screenshot(page, '02-personal');
  await go(page, 'security');
  await page.locator('#new-password').fill('short');
  await page.locator('#confirm-password').fill('short');
  await page.locator('#save-profile').click();
  await page
    .getByText('パスワードは12文字以上、1024文字以内で入力してください。', {
      exact: true,
    })
    .waitFor();
  await page.locator('#new-password').fill(password);
  await page.locator('#confirm-password').fill('different synthetic password');
  await page.locator('#save-profile').click();
  await page
    .getByText('確認用パスワードが一致しません。', { exact: true })
    .waitFor();
  await page.locator('#confirm-password').fill(password);
  await whileBusy(page, 'create', () => page.locator('#save-profile').click());
  await page
    .getByText('暗号化して保存しました。ロックされています。', { exact: true })
    .waitFor();
  await status(page, 'ロック中');
  for (const key of ['new-password', 'confirm-password', 'unlock-password'])
    assert.equal(await page.locator(`#${key}`).inputValue(), '');
  assert.equal(await field(page, 'firstName').inputValue(), '');
  const local = await page.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(Object.keys(local).sort(), [
    'encryptedProfileEpochV1',
    'encryptedProfileV1',
  ]);
  assert.ok(
    !/SENTINEL|synthetic settings|synthetic@example|000000000/.test(
      JSON.stringify(local),
    ),
  );
  assert.deepEqual(
    await page.evaluate(() => chrome.storage.sync.get(null)),
    {},
  );
  await screenshot(page, '03-locked');
  console.log(
    'PASS settings: 36 bilingual fields, provenance, conditional fields, masking, validation and encrypted create',
  );
  await browserSession.close();
  browserSession = await launchSettingsBrowser(profile, extension);
  context = browserSession.context;
  await secureContext(context);
  page = await context.newPage();
  await page.goto(url);
  await status(page, 'ロック中');
  await page.locator('#unlock-password').fill('wrong synthetic password');
  await page.locator('#unlock-submit').click();
  await page
    .locator('#unlock-error')
    .filter({ hasText: 'パスワードが違うか' })
    .waitFor();
  assert.equal(await field(page, 'firstName').inputValue(), '');
  await unlock(page);
  await go(page, 'personal');
  assert.equal(await field(page, 'firstName').inputValue(), 'SENTINEL');
  assert.equal(await field(page, 'addressLine1').inputValue(), '');
  await field(page, 'firstName').fill('EDITED');
  await page.getByText('未保存の変更があります', { exact: true }).waitFor();
  await page.locator('[data-for="field-ssn"]').click();
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden);
  await page.bringToFront();
  await page.locator('#profile-form:not([hidden])').waitFor();
  assert.equal(await field(page, 'firstName').inputValue(), 'EDITED');
  assert.equal(await field(page, 'ssn').getAttribute('type'), 'password');
  await go(page, 'security');
  assert.equal(
    await page.locator('#change-password-submit').isDisabled(),
    true,
  );
  await whileBusy(page, 'update', () => page.locator('#save-profile').click());
  await status(page, 'ロック中');
  await unlock(page);
  await go(page, 'personal');
  assert.equal(await field(page, 'firstName').inputValue(), 'EDITED');
  // Only the settings document can receive editing plaintext.
  const current = await page.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({
          channel: 'profile-vault-v1',
          op: 'status',
        })
      ).status,
  );
  await other.goto(`chrome-extension://${id}/popup.html`);
  assert.deepEqual(
    await other.evaluate(
      async (c) =>
        chrome.runtime.sendMessage({
          channel: 'profile-vault-v1',
          op: 'readForEditing',
          revision: c.revision,
          epoch: c.epoch,
        }),
      current,
    ),
    { ok: false, error: 'UNAUTHORIZED' },
  );
  // An external lock clears a retained background draft as well as visible values.
  await other.goto(url);
  await other.bringToFront();
  await status(other, '解除済み');
  await other.locator('#lock').click();
  await status(other, 'ロック中');
  await page.bringToFront();
  await status(page, 'ロック中');
  assert.equal(await field(page, 'firstName').inputValue(), '');
  // Delay only the editing response to reproduce a lock after decryption but
  // before delivery. The UI must discard that stale plaintext reply.
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (async (message: Record<string, unknown>) => {
      const reply = await original(message);
      if (message.op === 'readForEditing')
        await new Promise<void>((resolve) => {
          (
            window as typeof window & { releaseEditingReply?: () => void }
          ).releaseEditingReply = resolve;
        });
      return reply;
    }) as typeof chrome.runtime.sendMessage;
  });
  await page.waitForTimeout(1100);
  await page.locator('#unlock-password').fill(password);
  await page.locator('#unlock-submit').click();
  await page.waitForFunction(
    () =>
      typeof (window as typeof window & { releaseEditingReply?: () => void })
        .releaseEditingReply === 'function',
  );
  await other.bringToFront();
  await status(other, '解除済み');
  await other.locator('#lock').click();
  await status(other, 'ロック中');
  await page.evaluate(() =>
    (
      window as typeof window & { releaseEditingReply?: () => void }
    ).releaseEditingReply?.(),
  );
  await page.bringToFront();
  await status(page, 'ロック中');
  assert.equal(await field(page, 'firstName').inputValue(), '');
  await page.reload();
  await status(page, 'ロック中');
  await unlock(page);
  await go(page, 'security');
  await page.locator('#change-password').fill(nextPassword);
  await page.locator('#change-confirm').fill(nextPassword);
  await whileBusy(page, 'changePassword', () =>
    page.locator('#change-password-submit').click(),
  );
  await page
    .getByText(
      'パスワードを変更しました。新しいパスワードで解除してください。',
      { exact: true },
    )
    .waitFor();
  await status(page, 'ロック中');
  await page.waitForTimeout(1100);
  await page.locator('#unlock-password').fill(password);
  await page.locator('#unlock-submit').click();
  await page
    .locator('#unlock-error')
    .filter({ hasText: 'パスワードが違うか' })
    .waitFor();
  await unlock(page, nextPassword);
  console.log(
    'PASS settings: browser restart, wrong password, edit/save, background draft, cross-tab lock, password change, busy controls and idle conditional restoration',
  );
  // Fixed UI fault response: existing ciphertext stays intact and no success appears.
  await go(page, 'personal');
  await field(page, 'firstName').fill('UNCOMMITTED');
  const before = await savedSnapshot(page);
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: Record<string, unknown>) =>
      message.op === 'update'
        ? Promise.resolve({ ok: false, error: 'COMMIT_UNKNOWN' })
        : original(message)) as typeof chrome.runtime.sendMessage;
  });
  await page.locator('#save-profile').click();
  await page
    .locator('#notice[data-tone="error"]')
    .filter({ hasText: '結果を確認できません' })
    .waitFor();
  assert.equal(await savedSnapshot(page), before);
  assert.equal(await field(page, 'firstName').inputValue(), '');
  await page.reload();
  await status(page, '解除済み');
  await page.locator('#open-editor').click();
  await page.locator('#profile-form:not([hidden])').waitFor();
  await go(page, 'personal');
  assert.equal(await field(page, 'firstName').inputValue(), 'EDITED');
  // Explicit irreversible confirmation is required; cancellation preserves the vault.
  await go(page, 'security');
  await page.locator('#reset-profile').click();
  assert.equal(await page.locator('#confirm-reset').isDisabled(), true);
  await screenshot(page, '04-reset-confirmation');
  await page.locator('#cancel-reset').click();
  assert.equal(await savedSnapshot(page), before);
  await page.evaluate(() =>
    chrome.storage.local.set({ unrelatedSynthetic: true }),
  );
  await page.locator('#reset-profile').click();
  await page.locator('#reset-acknowledge').check();
  await page.locator('#confirm-reset').click();
  await status(page, '未登録');
  assert.equal(await savedSnapshot(page), undefined);
  assert.equal(
    (await page.evaluate(() => chrome.storage.local.get('unrelatedSynthetic')))
      .unrelatedSynthetic,
    true,
  );
  // Unknown future versions are never silently overwritten and still permit confirmed reset.
  await page.evaluate(() =>
    chrome.storage.local.set({ encryptedProfileV1: { version: 999 } }),
  );
  await page.locator('#unavailable-panel:not([hidden])').waitFor();
  await go(page, 'security');
  await page.locator('#reset-profile').click();
  await page.locator('#reset-acknowledge').check();
  await page.locator('#confirm-reset').click();
  await status(page, '未登録');
  await page.evaluate(() =>
    chrome.storage.local.set({
      encryptedProfileV1: {
        version: 1,
        payloadVersion: 1,
        ciphertext: 'BROKEN',
      },
    }),
  );
  await page.reload();
  await page.locator('#unavailable-panel:not([hidden])').waitFor();
  await go(page, 'security');
  await page.locator('#reset-profile').click();
  await page.locator('#reset-acknowledge').check();
  await page.locator('#confirm-reset').click();
  await status(page, '未登録');
  // Lock cleanup failure must ask for extension reload, not claim success.
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: Record<string, unknown>) =>
      message.op === 'create'
        ? Promise.resolve({ ok: false, error: 'STORAGE_WRITE' })
        : original(message)) as typeof chrome.runtime.sendMessage;
  });
  await fillAll(page);
  await go(page, 'security');
  await page.locator('#new-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await whileBusy(page, 'create', () => page.locator('#save-profile').click());
  await page.locator('#recovery:not([hidden])').waitFor();
  assert.equal(await field(page, 'firstName').inputValue(), '');
  assert.equal(await page.locator('#reload-extension').isVisible(), true);
  assert.equal(
    messages.some(
      (text) =>
        text === 'UNEXPECTED_PAGE_ERROR' ||
        /SENTINEL|settings password|000000000|synthetic@example/.test(text),
    ),
    false,
  );
  assert.equal(externalRequests, 0);
  console.log(
    'PASS settings: uncertain saves, reset confirmation/cancel, unknown version, cleanup recovery, no secret logs or external requests',
  );
} finally {
  await browserSession.close();
  await rm(profile, { recursive: true, force: true });
}
