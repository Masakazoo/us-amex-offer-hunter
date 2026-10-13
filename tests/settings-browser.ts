/** Owned disposable browser. noDefaults avoids Playwright's forced visibility,
 * so background-tab and focus tests exercise actual lifecycle events. */
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
export async function launchSettingsBrowser(
  profile: string,
  extension: string,
) {
  const chromiumMode = process.env.PROBE_TEST_BROWSER === 'chromium';
  const executable = chromiumMode
    ? chromium.executablePath()
    : '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  await rm(join(profile, 'DevToolsActivePort'), { force: true });
  const processHandle = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      // Match Playwright's sandbox setting in the disposable Linux CI browser.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ...(process.env.SETTINGS_HEADED === '1' ? [] : ['--headless=new']),
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let launchFailed = false;
  processHandle.on('error', () => {
    launchFailed = true;
  });
  const exited = new Promise<void>((resolve) =>
    processHandle.once('exit', () => resolve()),
  );
  try {
    let endpoint = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchFailed || processHandle.exitCode !== null)
        throw Error('SYNTHETIC_BROWSER_START_FAILED');
      try {
        const [port, path] = (
          await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
        )
          .trim()
          .split('\n');
        if (port && path) {
          endpoint = `ws://127.0.0.1:${port}${path}`;
          break;
        }
      } catch {
        /* Wait for this owned browser's readiness file. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!endpoint) throw Error('SYNTHETIC_BROWSER_START_TIMEOUT');
    const browser = await chromium.connectOverCDP(endpoint, {
      noDefaults: true,
    });
    const context = browser.contexts()[0]!;
    const close = async () => {
      try {
        const cdp = await browser.newBrowserCDPSession();
        await cdp.send('Browser.close');
      } catch {
        /* It may have already exited. */
      }
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
      await browser.close();
    };
    return { context, close };
  } catch (error) {
    processHandle.kill('SIGTERM');
    throw error;
  }
}
