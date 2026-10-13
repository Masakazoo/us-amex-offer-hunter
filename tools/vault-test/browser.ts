/** Real MV3 with disposable profile and actual production storage/protocol code. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { fullSentinelProfile } from '../../tests/vault-fixture.js';
import { out } from './build.js';
const profile = await mkdtemp(join(tmpdir(), 'vault-test-'));
const extension = resolve(out);
const browser = process.env.VAULT_BROWSER ?? 'chromium';
const options = {
  headless: browser !== 'chrome',
  ignoreDefaultArgs: ['--disable-extensions'],
  ...(browser === 'chromium'
    ? { channel: 'chromium' }
    : {
        executablePath:
          browser === 'chrome'
            ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            : '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      }),
  args:
    browser === 'chrome'
      ? []
      : [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
};
let context = await chromium.launchPersistentContext(profile, options);
try {
  if (browser === 'chrome') {
    const manager = await context.newPage();
    await manager.goto('chrome://extensions/');
    console.log(
      `ACTION Load unpacked: ${extension}. Synthetic test only; waiting 120s.`,
    );
  }
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 120000 }));
  const id = new URL(worker.url()).host;
  assert.equal(
    await worker.evaluate(() => chrome.runtime.getManifest().name),
    'Synthetic production vault test',
  );
  const url = `chrome-extension://${id}/settings.html`;
  let page = await context.newPage();
  await page.goto(url);
  type Response = {
    boot: string;
    reply?: {
      ok: boolean;
      error?: string;
      revision?: string;
      status?: {
        registered: boolean;
        unlocked: boolean;
        revision: string;
        epoch: string;
      };
    };
    ok?: boolean;
  };
  const cmd = (c: Record<string, unknown>): Promise<Response> =>
    page.evaluate((c) => chrome.runtime.sendMessage(c), {
      channel: 'profile-vault-v1',
      ...c,
    });
  const password = 'synthetic browser password';

  const created = await cmd({
    op: 'create',
    profile: fullSentinelProfile(),
    password,
  });
  assert.equal(created.reply?.ok, true, created.reply?.error);
  const persisted = await page.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(Object.keys(persisted).sort(), [
    'encryptedProfileEpochV1',
    'encryptedProfileV1',
  ]);
  assert.ok(
    !/SENTINEL|synthetic browser password|"raw"/.test(
      JSON.stringify(persisted),
    ),
  );
  assert.deepEqual(
    await page.evaluate(() => chrome.storage.sync.get(null)),
    {},
  );
  const timing = Date.now();
  assert.equal(
    (await cmd({ op: 'unlock', password, keep: true })).reply?.ok,
    true,
  );
  console.log(`PASS real KDF+unlock ${Date.now() - timing}ms`);
  const before = await cmd({ op: 'status' });
  assert.equal(before.reply?.status?.unlocked, true);
  await page.close();
  page = await context.newPage();
  await page.goto(url);
  assert.equal((await cmd({ op: 'status' })).reply?.status?.unlocked, true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  const after = await cmd({ op: 'status' });
  assert.notEqual(after.boot, before.boot);
  assert.equal(after.reply?.status?.unlocked, true);
  assert.equal((await cmd({ op: 'synthetic-use' })).ok, true);
  console.log(
    'PASS document recreation + Worker restart + decrypted synthetic consumer',
  );
  assert.equal((await cmd({ op: 'lock' })).reply?.ok, true);
  assert.equal((await cmd({ op: 'synthetic-use' })).ok, false);
  await page.waitForTimeout(1000);
  assert.equal(
    (await cmd({ op: 'unlock', password, keep: false })).reply?.ok,
    true,
  );
  assert.equal((await cmd({ op: 'synthetic-use' })).ok, true);
  assert.equal((await cmd({ op: 'synthetic-use' })).ok, false);
  await page.waitForTimeout(1000);
  await cmd({ op: 'unlock', password, keep: true });
  const state = (await cmd({ op: 'status' })).reply!.status!;
  assert.equal(
    (
      await cmd({
        op: 'changePassword',
        revision: state.revision,
        epoch: state.epoch,
        password: 'replacement synthetic password',
      })
    ).reply?.ok,
    true,
  );
  await page.waitForTimeout(1000);
  assert.equal(
    (await cmd({ op: 'unlock', password, keep: true })).reply?.error,
    'AUTH_OR_CORRUPT',
  );
  await page.waitForTimeout(1000);
  assert.equal(
    (
      await cmd({
        op: 'unlock',
        password: 'replacement synthetic password',
        keep: true,
      })
    ).reply?.ok,
    true,
  );
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  page = await context.newPage();
  await page.goto(url);
  const restarted = (await cmd({ op: 'status' })).reply!.status!;
  assert.equal(restarted.registered, true);
  assert.equal(restarted.unlocked, false);
  console.log(
    'PASS same-profile browser restart retains ciphertext, clears session',
  );
  await page.evaluate(() =>
    chrome.storage.local.set({ unrelatedSynthetic: true }),
  );
  assert.equal((await cmd({ op: 'reset', confirmed: true })).reply?.ok, true);
  assert.equal((await cmd({ op: 'status' })).reply?.status?.registered, false);
  assert.equal(
    (await page.evaluate(() => chrome.storage.local.get('unrelatedSynthetic')))
      .unrelatedSynthetic,
    true,
  );
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const forbidden = await popup.evaluate(() =>
    chrome.runtime.sendMessage({
      channel: 'profile-vault-v1',
      op: 'reset',
      confirmed: true,
    }),
  );
  assert.equal(forbidden.reply.error, 'UNAUTHORIZED');
  console.log(
    'PASS one-shot, lock, password change, reset ownership and sender role; synthetic only',
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
