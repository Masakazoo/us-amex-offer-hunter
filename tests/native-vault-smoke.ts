/** macOS disk-image integration using disposable markers only. Never opens the user's vault. */
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  lstat,
  realpath,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMacVaultDriver,
  runPrivate,
} from '../tools/native-vault/mac-vault.js';
import { loadVault, VaultError } from '../tools/native-vault/load.js';
import { fullSentinelProfile } from './full-form-fixture.js';

if (process.platform !== 'darwin')
  throw new Error('This integration test requires macOS');
const directory = await mkdtemp(
  join(await realpath(tmpdir()), 'amex-native-dmg-test-'),
);
const markerPassword = 'ENCRYPTION_TEST_SENTINEL';
const values = fullSentinelProfile();
const staging = join(directory, 'staging');
const base = join(directory, 'vault test');
const controller = new AbortController();
await mkdir(staging, { mode: 0o700 });
await mkdir(base, { mode: 0o700 });
await writeFile(
  join(staging, 'profile.yaml'),
  Object.entries(values)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n'),
  { mode: 0o600 },
);
try {
  const input = Buffer.from(markerPassword + '\0');
  try {
    await runPrivate(
      '/usr/bin/hdiutil',
      [
        'create',
        '-srcfolder',
        staging,
        '-encryption',
        'AES-256',
        '-format',
        'UDRW',
        '-volname',
        'AmexNativeTest',
        '-stdinpass',
        join(base, 'ProfileVault.dmg'),
      ],
      { input, timeout: 60000 },
    );
  } finally {
    input.fill(0);
  }
  const driver = createMacVaultDriver(base, controller.signal);
  // Replace only the GUI prompt in this synthetic test; exercise real encryption/read/detach.
  driver.password = async () => Buffer.from(markerPassword);
  const read = driver.read;
  driver.read = async () => {
    const mounts = (await runPrivate('/sbin/mount', [])).toString();
    assert.ok(
      mounts
        .split('\n')
        .some(
          (line) =>
            line.includes(` on ${join(base, 'NativeRead')} (`) &&
            line.includes('read-only'),
        ),
    );
    return read();
  };
  assert.deepEqual(await loadVault(driver), { status: 'ok', values });
  assert.ok(
    !(await runPrivate('/sbin/mount', [])).toString().includes(` on ${base}/`),
  );
  assert.equal(
    await lstat(join(base, 'NativeRead.lock'))
      .then(() => true)
      .catch(() => false),
    false,
  );

  const wrong = createMacVaultDriver(base, controller.signal);
  wrong.password = async () => Buffer.from('WRONG_SENTINEL');
  assert.deepEqual(await loadVault(wrong), {
    status: 'error',
    code: 'unlock-failed',
  });
  assert.ok(
    !(await runPrivate('/sbin/mount', [])).toString().includes(` on ${base}/`),
  );

  const cancelled = createMacVaultDriver(base, controller.signal);
  cancelled.password = async () => {
    throw new VaultError('cancelled');
  };
  assert.deepEqual(await loadVault(cancelled), {
    status: 'error',
    code: 'cancelled',
  });
  assert.equal(
    await lstat(join(base, 'NativeRead.lock'))
      .then(() => true)
      .catch(() => false),
    false,
  );
  console.log(
    'PASS native macOS vault: encrypted synthetic DMG, read-only attach, validated load, automatic detach, wrong-password and cancellation cleanup. No personal vault accessed.',
  );
} finally {
  // This exact mount belongs only to this freshly-created test directory.
  const mounted = (await runPrivate('/sbin/mount', []))
    .toString()
    .includes(` on ${join(base, 'NativeRead')} (`);
  if (mounted)
    await runPrivate('/usr/bin/hdiutil', [
      'detach',
      join(base, 'NativeRead'),
      '-quiet',
    ]);
  await rm(directory, { recursive: true, force: true });
}
