/** Genuine MV3 -> native host -> session -> isolated fill, with synthetic data and no external requests. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import {
  nativeHostName,
  nativeStateKey,
} from '../apps/extension/src/native-vault.js';
import { fullFixtureHtml, fullSentinelProfile } from './full-form-fixture.js';

const directory = await mkdtemp(join(tmpdir(), 'amex-native-browser-test-'));
const browserProfile = join(directory, 'browser');
await mkdir(browserProfile);
const extension = join(directory, 'extension');
await cp(resolve('dist/extension'), extension, { recursive: true });
const testHostName = `${nativeHostName}.synthetic_${randomUUID().replaceAll('-', '')}`;
const workerPath = join(extension, 'worker.js');
await writeFile(
  workerPath,
  (await readFile(workerPath, 'utf8')).replaceAll(nativeHostName, testHostName),
);
// Chrome for Testing 146+ supports native hosts under the disposable user-data dir.
// No registration is made in the user's Chrome/Brave settings.
const manifestDir = join(browserProfile, 'NativeMessagingHosts');
await mkdir(manifestDir, { recursive: true });
const manifestPath = join(manifestDir, `${testHostName}.json`);
const context = await chromium.launchPersistentContext(browserProfile, {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  // The test host has no disk-image logic, home-directory access, password prompt, or network.
  const host = join(directory, 'sentinel-host.cjs');
  const launcher = join(directory, 'launch.sh');
  const scenario = join(directory, 'scenario.json');
  await writeFile(
    scenario,
    JSON.stringify({ status: 'ok', values: fullSentinelProfile() }),
  );
  await writeFile(
    host,
    `const fs = require('node:fs');
process.stdin.once('data', () => {
  setTimeout(() => {
    const body = fs.readFileSync(${JSON.stringify(scenario)});
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
  }, 500);
});
`,
  );
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  await writeFile(
    launcher,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(host)} "$@"\n`,
    { mode: 0o700 },
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: testHostName,
      description: 'Synthetic integration only',
      path: launcher,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`],
    }),
    { mode: 0o600, flag: 'wx' },
  );
  const url =
    'https://www.americanexpress.com/en-us/credit-cards/apply/business/business-platinum-charge-card/00000-0-0';
  let requests = 0;
  await context.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.protocol === 'chrome-extension:' && target.host === id)
      return route.continue();
    if (target.href === url && route.request().resourceType() === 'document') {
      requests++;
      return route.fulfill({
        contentType: 'text/html',
        body: fullFixtureHtml(),
      });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(url);
  let popup = await context.newPage();
  const openPopup = async () => {
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('#unlock-vault:enabled').waitFor();
    await page.bringToFront();
  };
  await popup.close();
  await openPopup();
  await popup.locator('#unlock-vault').click();
  // Simulate the popup closing as the password dialog takes focus.
  await popup.close();
  await worker.evaluate(async (key: string) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = (await chrome.storage.session.get(key))[key] as
        { status?: string } | undefined;
      if (state?.status === 'loaded') return;
      if (state?.status && state.status !== 'loading')
        throw new Error(`Synthetic native test: ${state.status}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Synthetic native test timed out');
  }, nativeStateKey);
  await openPopup();
  await popup
    .getByText(
      '申込情報を読み込み、保管庫を閉じました。フォームを検出してください。',
    )
    .waitFor();
  assert.equal(
    await popup.evaluate(
      async () => Object.keys(await chrome.storage.local.get(null)).length,
    ),
    0,
  );
  await popup.locator('#inspect').click();
  await popup.locator('#fill:enabled').waitFor();
  await popup.locator('#fill').click();
  await popup
    .getByText(
      '処理が終わりました。項目ごとの結果と申込画面を確認してください。申込送信はしていません。',
    )
    .waitFor();
  assert.equal(await page.locator('#ssn').inputValue(), '000-00-0000');
  assert.equal(await page.evaluate('window.submissions'), 0);
  await popup.locator('#lock').click();
  await popup
    .getByText('メモリの本人情報を削除しました。暗号化ファイルは変更しません。')
    .waitFor();
  await writeFile(
    scenario,
    JSON.stringify({ status: 'error', code: 'cancelled' }),
  );
  await popup.locator('#unlock-vault').click();
  await popup
    .getByText(
      '読み込みをキャンセルしました。「保管庫から読み込む」で再開できます。',
    )
    .waitFor();
  assert.equal(await popup.locator('[name="firstName"]').inputValue(), '');
  assert.equal(await page.evaluate('window.submissions'), 0);
  assert.equal(requests, 1);
  console.log(
    'PASS native extension: real browser-to-native connection, popup closure, trusted session only, autofill, cancellation and no submit. Synthetic host and intercepted documents only.',
  );
} catch (error) {
  const worker = context.serviceWorkers()[0];
  if (worker) {
    const diagnostic = await worker.evaluate(async (name: string) => {
      return new Promise<string>((resolve) => {
        const port = chrome.runtime.connectNative(name);
        port.onDisconnect.addListener(() =>
          resolve(chrome.runtime.lastError?.message ?? 'No diagnostic'),
        );
        port.onMessage.addListener(() => {
          resolve('Synthetic host replied');
          port.disconnect();
        });
        port.postMessage({ action: 'read-profile' });
      });
    }, testHostName);
    console.error(`Synthetic native connection diagnostic: ${diagnostic}`);
  }
  throw error;
} finally {
  await context.close();
  await rm(manifestPath, { force: true });
  await rm(directory, { recursive: true, force: true });
}
