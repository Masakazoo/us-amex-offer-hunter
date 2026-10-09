import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeHostName } from '../../apps/extension/src/native-vault.js';

// Installs only non-secret code/configuration; never opens the user's vault.
const extensionId = process.argv[2];
if (
  process.platform !== 'darwin' ||
  !extensionId ||
  !/^[a-p]{32}$/.test(extensionId) ||
  process.argv.length > 4
) {
  console.error(
    'Usage: node --import tsx tools/native-vault/install.ts <Chrome extension ID> [Chrome user-data directory]',
  );
  process.exit(1);
}
const home = homedir();
async function ensureDirectory(path: string) {
  const parts = relative(home, path);
  if (parts.startsWith('..') || isAbsolute(parts))
    throw new Error('Invalid install path');
  let current = home;
  for (const part of parts.split('/')) {
    current = join(current, part);
    await mkdir(current, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST')
          throw new Error('Cannot create install directory');
      },
    );
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Unsafe install directory');
  }
}
async function installFile(
  directory: string,
  name: string,
  value: string | Buffer,
  mode: number,
) {
  const target = join(directory, name);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw new Error('Cannot inspect install file');
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw new Error('Unsafe install file');
  const temporary = join(directory, `.install-${randomUUID()}`);
  await writeFile(temporary, value, { mode, flag: 'wx' });
  await chmod(temporary, mode);
  await rename(temporary, target);
}
const directory = join(
  home,
  'Library/Application Support/us-amex-offer-hunter/NativeHost',
);
const chromeProfile = process.argv[3]
  ? resolve(process.argv[3])
  : join(home, 'Library/Application Support/Google/Chrome');
if (process.argv[3]) {
  const info = await lstat(chromeProfile);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Invalid Chrome user-data directory');
}
const manifests = join(chromeProfile, 'NativeMessagingHosts');
await ensureDirectory(directory);
await ensureDirectory(manifests);
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
await installFile(
  directory,
  'host.cjs',
  await readFile(resolve('dist/native-vault/host.cjs')),
  0o600,
);
await installFile(
  directory,
  'config.json',
  JSON.stringify({ extensionId }) + '\n',
  0o600,
);
await installFile(
  directory,
  'launch.sh',
  `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH\nexec ${shellQuote(process.execPath)} ${shellQuote(join(directory, 'host.cjs'))} "$@"\n`,
  0o700,
);
await installFile(
  manifests,
  `${nativeHostName}.json`,
  JSON.stringify(
    {
      name: nativeHostName,
      description: 'Amex Autofill encrypted profile reader',
      path: join(directory, 'launch.sh'),
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  ) + '\n',
  0o600,
);
console.log(
  'PASS installed native vault reader for the specified Chrome extension. Vault not opened.',
);
