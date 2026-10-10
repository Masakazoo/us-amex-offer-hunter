/** Real MV3, fresh disposable profile. Prints fixed assertions/timings only. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import './build.js';

const profile = await mkdtemp(join(tmpdir(), 'security-spike-'));
const extension = resolve('dist/security-spike');
const password = 'SYNTHETIC test password';
const browser = process.env.SECURITY_BROWSER ?? 'brave';
const options = {
  ignoreDefaultArgs: ['--disable-extensions'],
  headless: process.env.SECURITY_HEADED !== '1',
  ...(browser === 'chromium'
    ? { channel: 'chromium' }
    : {
        executablePath:
          browser === 'chrome'
            ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            : '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      }),
  args: [
    ...(browser === 'chrome' ? ['--enable-unsafe-extension-debugging'] : []),
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
};
async function launch() {
  const ctx = await chromium.launchPersistentContext(profile, options);
  if (browser === 'chrome') {
    const probe = await ctx.newPage();
    const cdp = await ctx.newCDPSession(probe);
    try {
      await cdp.send('Extensions.loadUnpacked', { path: extension });
    } catch (error) {
      await ctx.close();
      await rm(profile, { recursive: true, force: true });
      throw error;
    }
    await cdp.detach();
    await probe.close();
  }
  return ctx;
}
let context = await launch();
type Reply = {
  ok: boolean;
  code?: string;
  unlocked?: boolean;
  registered?: boolean;
  revision?: string;
  boot?: string;
};
const send = (page: Page, command: Record<string, unknown>): Promise<Reply> =>
  page.evaluate((c) => chrome.runtime.sendMessage(c), command);
const pass = (label: string) => console.log(`PASS ${label}`);
try {
  context.setDefaultTimeout(10000);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const url = `chrome-extension://${id}/harness.html`;
  let page = await context.newPage();
  await page.goto(url);
  console.log(
    JSON.stringify({
      browser,
      userAgent: await page.evaluate(() => navigator.userAgent),
      headless: options.headless,
    }),
  );
  const cmd = (c: Record<string, unknown>) => send(page, c);
  assert.equal((await cmd({ op: 'create', password })).ok, true);
  const original = await page.evaluate(async () =>
    JSON.stringify(await chrome.storage.local.get(null)),
  );
  assert.ok(
    !original.includes(password) &&
      !original.includes('SYNTHETIC-ONLY') &&
      !original.includes('raw'),
  );
  assert.deepEqual(
    await page.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)),
    ),
    ['vault'],
  );
  assert.deepEqual(
    await page.evaluate(async () =>
      Object.keys(await chrome.storage.sync.get(null)),
    ),
    [],
  );
  pass('ciphertext-only local; sync empty');
  assert.equal(
    (await cmd({ op: 'unlock', password: 'WRONG' })).code,
    'AUTH_OR_CORRUPT',
  );
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    assert.equal((await cmd({ op: 'unlock', password })).ok, true);
    times.push(Math.round(performance.now() - start));
  }
  console.log(JSON.stringify({ unlockMilliseconds: times }));
  const status = await cmd({ op: 'status' });
  assert.equal(status.unlocked, true);
  assert.equal((await cmd({ op: 'use', expected: status.revision })).ok, true);
  pass('wrong password rejected; unlock default ON; explicit synthetic use');
  // CryptoKey is structured-cloneable, but Chrome storage uses JSON serialization.
  const keyResult = await page.evaluate(async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    try {
      await chrome.storage.session.set({ keyProbe: key });
      const restored = (await chrome.storage.session.get('keyProbe')).keyProbe;
      return {
        usable: restored instanceof CryptoKey,
        keys: Object.keys(restored ?? {}),
      };
    } catch {
      return { usable: false, rejected: true };
    } finally {
      await chrome.storage.session.remove('keyProbe');
    }
  });
  assert.equal(keyResult.usable, false);
  console.log(JSON.stringify({ cryptoKeyStorage: keyResult }));
  await page.close();
  page = await context.newPage();
  await page.goto(url);
  assert.equal((await cmd({ op: 'status' })).unlocked, true);
  await page.goto('about:blank');
  await page.goto(url);
  assert.equal((await cmd({ op: 'status' })).unlocked, true);
  pass('extension document destruction/recreation and tab navigation');
  // Stop via CDP, without extension reload or browser restart. Verify new boot ID.
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  const restarted = await cmd({ op: 'status' });
  assert.notEqual(restarted.boot, status.boot);
  assert.equal(restarted.unlocked, true);
  assert.equal(
    (await cmd({ op: 'use', expected: restarted.revision })).ok,
    true,
  );
  pass('forced MV3 worker termination; new worker restores usable session');
  await cmd({ op: 'lock' });
  assert.equal(
    (await cmd({ op: 'use', expected: status.revision })).code,
    'LOCKED',
  );
  await cmd({ op: 'unlock', password, keep: false });
  const oneShots = await Promise.all([
    cmd({ op: 'use', expected: status.revision }),
    cmd({ op: 'use', expected: status.revision }),
  ]);
  assert.equal(oneShots.filter((r) => r.ok).length, 1);
  assert.equal((await cmd({ op: 'status' })).unlocked, false);
  pass('manual lock; concurrent one-shot use admits exactly one');
  await cmd({ op: 'unlock', password });
  assert.equal(
    (
      await cmd({
        op: 'change',
        password: 'SYNTHETIC changed',
        expected: status.revision,
        failBeforeCommit: true,
      })
    ).code,
    'STORAGE_WRITE',
  );
  assert.equal(
    await page.evaluate(async () =>
      JSON.stringify(await chrome.storage.local.get(null)),
    ),
    original,
  );
  assert.equal((await cmd({ op: 'unlock', password })).ok, true);
  pass('injected pre-commit failure retains exact old record and password');
  const otherWindow = await page.evaluate(
    async (url) => (await chrome.windows.create({ url, type: 'normal' }))?.id,
    url,
  );
  assert.ok(otherWindow !== undefined);
  const second =
    context.pages().find((p) => p !== page && p.url() === url) ??
    (await context.waitForEvent('page'));
  await second.waitForLoadState();
  const changes = await Promise.all([
    cmd({
      op: 'change',
      password: 'SYNTHETIC changed',
      expected: status.revision,
    }),
    send(second, {
      op: 'change',
      password: 'SYNTHETIC changed',
      expected: status.revision,
    }),
  ]);
  assert.equal(changes.filter((r) => r.ok).length, 1);
  assert.equal((await send(second, { op: 'status' })).unlocked, false);
  assert.equal((await cmd({ op: 'unlock', password })).code, 'AUTH_OR_CORRUPT');
  assert.equal(
    (await cmd({ op: 'unlock', password: 'SYNTHETIC changed' })).ok,
    true,
  );
  assert.equal(
    (await cmd({ op: 'use', expected: status.revision })).code,
    'CONFLICT',
  );
  pass(
    'two windows serialize changes; old password/session/revision invalidated',
  );
  // Graceful browser process exit, same disk profile, persistent ciphertext remains.
  await context.close();
  context = await launch();
  page = await context.newPage();
  await page.goto(url);
  const afterBrowser = await cmd({ op: 'status' });
  assert.equal(afterBrowser.registered, true);
  assert.equal(afterBrowser.unlocked, false);
  assert.equal(
    (await cmd({ op: 'unlock', password: 'SYNTHETIC changed' })).ok,
    true,
  );
  pass('browser process close/relaunch with same profile requires password');
  await page.evaluate(async () => {
    const data = await chrome.storage.local.get('vault');
    const e = data.vault as { ciphertext: string };
    e.ciphertext =
      (e.ciphertext[0] === 'A' ? 'B' : 'A') + e.ciphertext.slice(1);
    await chrome.storage.local.set(data);
  });
  assert.equal(
    (await cmd({ op: 'unlock', password: 'SYNTHETIC changed' })).code,
    'AUTH_OR_CORRUPT',
  );
  assert.equal((await cmd({ op: 'delete' })).ok, true);
  assert.equal((await cmd({ op: 'status' })).registered, false);
  assert.deepEqual(
    await page.evaluate(async () =>
      Object.keys(await chrome.storage.session.get(null)),
    ),
    [],
  );
  pass('tamper rejected; deletion clears vault and session');
  // Reset remains available even when the stored schema cannot be parsed.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ vault: { version: 999 } });
  });
  assert.equal((await cmd({ op: 'lock' })).ok, true);
  assert.equal((await cmd({ op: 'delete' })).ok, true);
  pass('corrupt-schema lock/reset');
  await cmd({ op: 'create', password });
  await cmd({ op: 'unlock', password });
  const closed = page.waitForEvent('close');
  await page.evaluate(() => {
    setTimeout(() => chrome.runtime.reload(), 100);
  });
  await closed;
  page = await context.newPage();
  let loaded = false;
  for (let attempt = 0; attempt < 10 && !loaded; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await page.goto(url);
      loaded = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('ERR_BLOCKED_BY_CLIENT')
      )
        throw error;
    }
  }
  if (loaded) {
    assert.equal((await cmd({ op: 'status' })).unlocked, false);
    pass('extension reload requires password');
  } else {
    console.log(
      'UNKNOWN extension reload: command-line-loaded extension page blocked; manual Chrome check required',
    );
    if (process.env.SECURITY_REQUIRE_RELOAD === '1')
      throw new Error('RELOAD_UNVERIFIED');
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
