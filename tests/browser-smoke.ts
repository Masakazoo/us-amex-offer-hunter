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
  const initialInspection = recorder.inspectionSummary();
  assert.equal(initialInspection.pages, 1);
  assert.equal(initialInspection.frames[0]?.state, 'ready');
  assert.equal(initialInspection.frames[0]?.nativeControls, 1);
  assert.equal(initialInspection.frames[0]?.inspectedFields, 1);
  assert.equal(initialInspection.frames[0]?.applicationCodeRecognized, false);
  // A missing observer must not look like a successfully inspected empty form.
  await page.evaluate(() => {
    delete (window as unknown as { __probeInspect?: unknown }).__probeInspect;
  });
  await recorder.inspect(context);
  assert.equal(
    recorder.inspectionSummary().frames[0]?.state,
    'observer-missing',
  );
  assert.equal(recorder.inspectionSummary().frames[0]?.nativeControls, 1);
  assert.equal(recorder.inspectionSummary().frames[0]?.inspectedFields, 0);
  // Cumulative fields remain distinguishable from the current inspection.
  assert.equal(recorder.safeFields().length, 1);
  const popup = await context.newPage();
  await popup.goto('https://fixture.invalid/');
  await recorder.inspect(context);
  assert.equal(recorder.inspectionSummary().pages, 2);
  assert.equal(recorder.inspectionSummary().frames[1]?.state, 'ready');
  assert.ok(
    !JSON.stringify(recorder.inspectionSummary()).includes('PRIVATE_SENTINEL'),
  );
  assert.ok(
    !JSON.stringify(recorder.inspectionSummary()).includes('fixture.invalid'),
  );
  await popup.evaluate(() => {
    (window as unknown as { __probeInspect: () => never }).__probeInspect =
      () => {
        throw new TypeError('PRIVATE_SENTINEL');
      };
  });
  await recorder.inspect(context);
  assert.equal(
    recorder.inspectionSummary().frames[1]?.state,
    'observer-failed',
  );
  assert.equal(recorder.inspectionSummary().frames[1]?.failure, 'type');
  assert.equal(recorder.inspectionSummary().frames[1]?.nativeControls, 1);
  assert.ok(
    !JSON.stringify(recorder.inspectionSummary()).includes('PRIVATE_SENTINEL'),
  );
  await context.close();

  console.log(
    'PASS offline browser: request attribution; safe DOM/report/diagnostics; no external access.',
  );
} finally {
  await browser.close();
}
