import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadVault } from './load.js';
import { createMacVaultDriver, readRegularFile } from './mac-vault.js';
import { encodeFrame, readRequest } from './protocol.js';
import type { NativeResponse } from '../../apps/extension/src/native-vault.js';

process.umask(0o077);
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
process.on('SIGHUP', () => controller.abort());
process.stdin.on('end', () => controller.abort());
process.stdin.on('error', () => controller.abort());
process.stdout.on('error', () => controller.abort());

async function main(): Promise<NativeResponse> {
  // Installed configuration is non-secret. The caller cannot supply paths or commands.
  const config: unknown = JSON.parse(
    (
      await readRegularFile(
        join(dirname(process.argv[1]!), 'config.json'),
        1024,
      )
    ).toString('utf8'),
  );
  if (
    typeof config !== 'object' ||
    config === null ||
    Array.isArray(config) ||
    Object.keys(config).length !== 1 ||
    !('extensionId' in config) ||
    typeof config.extensionId !== 'string' ||
    !/^[a-p]{32}$/.test(config.extensionId) ||
    process.argv[2] !== `chrome-extension://${config.extensionId}/` ||
    process.platform !== 'darwin'
  )
    return { status: 'error', code: 'unavailable' };
  if (!(await readRequest(process.stdin)) || controller.signal.aborted)
    return { status: 'error', code: 'unavailable' };
  return loadVault(
    createMacVaultDriver(
      join(homedir(), 'Library/Application Support/us-amex-offer-hunter'),
      controller.signal,
    ),
  );
}

void main()
  .catch((): NativeResponse => ({ status: 'error', code: 'unavailable' }))
  .then((response) => {
    if (controller.signal.aborted) process.exit(0);
    const frame = encodeFrame(response);
    process.stdout.write(frame, () => {
      frame.fill(0);
      process.exit(0);
    });
  });
