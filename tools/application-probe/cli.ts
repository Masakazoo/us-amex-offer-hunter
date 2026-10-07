import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';
import { Recorder } from './recorder.js';
import { reportSchema, renderReport } from './report.js';
import type { Observation } from '../../packages/core/schemas/observation.js';

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'PROBE_URL=<public HTTPS URL> npm run probe\nOptional: PROBE_BROWSER=brave|chrome|chromium; PROBE_EXECUTABLE=<path>\nCommands: inspect, idle, finish. All browser interactions are manual. Never submit or accept.',
    );
    return;
  }
  const rawUrl = process.env.PROBE_URL;
  if (!rawUrl) throw new Error();
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hostname !== 'www.americanexpress.com'
  )
    throw new Error();
  const browserName = process.env.PROBE_BROWSER ?? 'brave';
  if (!['brave', 'chrome', 'chromium'].includes(browserName)) throw new Error();
  const executablePath =
    process.env.PROBE_EXECUTABLE ??
    (browserName === 'brave' && process.platform === 'darwin'
      ? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
      : undefined);
  if (browserName === 'brave' && !executablePath) throw new Error();
  const browser = await chromium.launch({
    headless: false,
    ...(executablePath
      ? { executablePath }
      : browserName === 'chrome'
        ? { channel: 'chrome' }
        : {}),
  });
  const rl = createInterface({ input: stdin, output: stdout });
  let stopping = false;
  const interrupt = () => {
    stopping = true;
    rl.close();
  };
  process.once('SIGINT', interrupt);
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'allow',
      acceptDownloads: false,
    });
    const recorder = new Recorder();
    await recorder.attach(context);
    const page = await context.newPage();
    recorder.mark('open');
    console.log(
      'Manual observation only. Do not type dummy data. Never Submit Application / Accept Card. Stop at CAPTCHA.',
    );
    try {
      await page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch {
      console.log(
        'Navigation did not complete. No raw error was logged; inspect the browser.',
      );
    }
    console.log(
      'Commands: inspect (safe DOM metadata), idle (start baseline interval), finish (save and close).',
    );
    while (!stopping) {
      let command: string;
      try {
        command = (await rl.question('probe> ')).trim();
      } catch {
        break;
      }
      if (command === 'finish') break;
      if (command === 'inspect')
        console.log(JSON.stringify(await recorder.inspect(context), null, 2));
      else if (command === 'idle') recorder.mark('idle');
      else
        console.log(
          'Use inspect, idle, or finish. Do not enter personal data here.',
        );
    }
    // Close before export so failed/pending request states reflect browser shutdown.
    await context.close();
    const environment: Observation['environment'] = {
      browser: browserName as Observation['environment']['browser'],
      session: 'fresh-context',
      ...(/^\d+(?:\.\d+){1,3}$/.test(browser.version())
        ? { browserVersion: browser.version() }
        : {}),
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'allowed',
    };
    const report = reportSchema.parse({
      observation: recorder.observation(environment),
      fields: recorder.safeFields(),
    });
    const directory = resolve('runs', `probe-${report.observation.id}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [name, content] of [
      ['observation.json', JSON.stringify(report, null, 2)],
      ['steps.md', renderReport(report)],
    ]) {
      const file = await open(resolve(directory, name!), 'wx', 0o600);
      try {
        await file.writeFile(content!);
      } finally {
        await file.close();
      }
    }
    console.log(`Saved safe report: ${directory}`);
  } finally {
    rl.close();
    process.removeListener('SIGINT', interrupt);
    await browser.close();
  }
}
// Playwright and validation errors can contain URLs/DOM/values; never print them.
main().catch(() => {
  console.error(
    'Probe stopped. Check public PROBE_URL, browser availability, and output permissions. Raw diagnostics suppressed.',
  );
  process.exitCode = 1;
});
