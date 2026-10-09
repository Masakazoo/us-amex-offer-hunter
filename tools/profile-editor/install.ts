import { readFile, mkdir, lstat, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
const directory = join(
  homedir(),
  'Library/Application Support/us-amex-offer-hunter',
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const target = join(directory, 'Edit Full Profile.command');
const info = await lstat(target).catch(() => undefined);
if (info && (!info.isFile() || info.isSymbolicLink()))
  throw new Error('Refusing non-regular launcher');
const quote = (s: string) => s.replace(/[\\"$`]/g, '\\$&');
const source = (
  await readFile(
    resolve('tools/profile-vault/Edit Full Profile.command'),
    'utf8',
  )
)
  .replace('__REPOSITORY__', quote(resolve('.')))
  .replace('__NODE__', quote(process.execPath));
await writeFile(target, source, { mode: 0o700 });
await chmod(target, 0o700);
console.log('PASS installed full-profile editor launcher. Vault not read.');
