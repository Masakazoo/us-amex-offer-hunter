/** Offline integration: external requests are aborted, never visits Amex. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Recorder } from '../tools/application-probe/recorder.js';
import {
  reportSchema,
  renderReport,
} from '../tools/application-probe/report.js';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PROBE_TEST_BROWSER === 'chromium'
    ? {}
    : {
        executablePath:
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      }),
});
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'fixture.invalid') return route.abort();
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><label for="business">Legal Business Name</label><input id="business" name="legal_business_name" required><button type="button">Neutral focus target</button><script>document.querySelector('input').addEventListener('blur',()=>fetch('/validation?secret=PRIVATE_SENTINEL',{method:'POST',body:'PRIVATE_SENTINEL'}));</script>`,
      });
    if (url.pathname === '/validation') {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({ status: 200, body: 'PRIVATE_SENTINEL' });
    }
    return route.abort();
  });
  const recorder = new Recorder();
  await recorder.attach(context);
  const page = await context.newPage();
  recorder.mark('open');
  await page.goto('https://fixture.invalid/');
  await page.locator('input').focus();
  await page.locator('input').fill('PRIVATE_SENTINEL');
  const done = page.waitForEvent(
    'requestfinished',
    (r) => r.method() === 'POST',
  );
  await page.locator('button').focus();
  await done;
  await recorder.inspect(context);
  const report = reportSchema.parse({
    observation: recorder.observation({
      browser: 'brave',
      session: 'fresh-context',
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'blocked',
    }),
    fields: recorder.safeFields(),
  });
  assert.ok(report.observation.steps.some((s) => s.action === 'focus'));
  assert.ok(report.observation.steps.some((s) => s.action === 'input'));
  const post = report.observation.network.find((n) => n.method === 'POST');
  assert.ok(post);
  assert.equal(post.status, 200);
  assert.equal(post.state, 'finished');
  assert.equal(
    report.observation.steps.find((s) => s.sequence === post.step)?.action,
    'blur',
  );
  assert.ok(
    report.fields.some(
      (f) =>
        f.semantic === 'Legal Business Name' &&
        f.networkSafety === 'requires-real-user-data',
    ),
  );
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
  assert.ok(!renderReport(report).includes('PRIVATE_SENTINEL'));
  await context.close();
  console.log(
    'PASS offline browser: input/focus/blur -> request attribution; safe DOM and report; no external access.',
  );
} finally {
  await browser.close();
}
