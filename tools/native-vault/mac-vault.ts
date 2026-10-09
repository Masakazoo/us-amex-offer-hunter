import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { maxProfileBytes } from '../../apps/extension/src/vault-profile.js';
import { VaultError, type VaultDriver } from './load.js';

// No shell, no inherited debug logging, no password in argv/environment/files.
export async function runPrivate(
  executable: string,
  args: string[],
  options: { input?: Buffer; signal?: AbortSignal; timeout?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    let killTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      failed = true;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const timer = setTimeout(abort, options.timeout ?? 30000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin.on('error', () => {
      failed = true;
    });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        chunk.fill(0);
        abort();
      } else chunks.push(chunk);
    });
    child.on('error', () => {
      failed = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      if (failed || code !== 0) {
        chunks.forEach((chunk) => chunk.fill(0));
        reject(new VaultError('unavailable'));
      } else {
        const result = Buffer.concat(chunks);
        chunks.forEach((chunk) => chunk.fill(0));
        resolve(result);
      }
    });
    child.stdin.end(options.input);
  });
}

export async function readRegularFile(path: string, maxBytes: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes)
      throw new VaultError('invalid-profile');
    const result = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(result, 0, result.length, 0);
    if (bytesRead > maxBytes) {
      result.fill(0);
      throw new VaultError('invalid-profile');
    }
    return result.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export function createMacVaultDriver(
  base: string,
  signal: AbortSignal,
): VaultDriver {
  let image = join(base, 'ProfileVault.dmg');
  let mount = join(base, 'NativeRead');
  let lock = join(base, 'NativeRead.lock');
  let ownedLock = false;
  let attemptedAttach = false;
  const checkCancelled = () => {
    if (signal.aborted) throw new VaultError('cancelled');
  };
  const mounts = async () =>
    (await runPrivate('/sbin/mount', [])).toString('utf8');
  const mountedAt = (list: string, name: string) =>
    list.includes(` on ${join(base, name)} (`);
  return {
    async prepare() {
      checkCancelled();
      const baseInfo = await lstat(base).catch(() => undefined);
      const info = await lstat(image).catch(() => undefined);
      if (
        !baseInfo?.isDirectory() ||
        baseInfo.isSymbolicLink() ||
        !info?.isFile() ||
        info.isSymbolicLink()
      )
        throw new VaultError('vault-missing');
      base = await realpath(base);
      image = join(base, 'ProfileVault.dmg');
      mount = join(base, 'NativeRead');
      lock = join(base, 'NativeRead.lock');
      try {
        await mkdir(lock, { mode: 0o700 });
        ownedLock = true;
      } catch {
        throw new VaultError('vault-busy');
      }
      const list = await mounts();
      if (
        ['Unlocked', 'Editing', 'NativeRead'].some((name) =>
          mountedAt(list, name),
        )
      )
        throw new VaultError('vault-busy');
      const encrypted = await runPrivate(
        '/usr/bin/hdiutil',
        ['isencrypted', '-plist', image],
        { signal },
      );
      const flag = await runPrivate(
        '/usr/bin/plutil',
        ['-extract', 'encrypted', 'raw', '-o', '-', '-'],
        { input: encrypted, signal },
      );
      if (flag.toString('utf8').trim() !== 'true')
        throw new VaultError('not-encrypted');
      await mkdir(mount, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw new VaultError('unavailable');
        },
      );
      const mountInfo = await lstat(mount);
      if (!mountInfo.isDirectory() || mountInfo.isSymbolicLink())
        throw new VaultError('unavailable');
      checkCancelled();
    },
    async password() {
      checkCancelled();
      // The user types into a macOS secure field. Only the helper receives the answer.
      const script = [
        'activate',
        'set reply to display dialog "暗号化保管庫のパスワードを入力してください。読み込み後、保管庫は自動で閉じます。" default answer "" with hidden answer buttons {"キャンセル", "読み込む"} default button "読み込む" cancel button "キャンセル" with title "Amex Autofill" giving up after 120',
        'if gave up of reply then error number -128',
        'return text returned of reply',
      ].join('\n');
      let answer: Buffer;
      try {
        answer = await runPrivate('/usr/bin/osascript', ['-e', script], {
          signal,
          timeout: 125000,
        });
      } catch {
        throw new VaultError('cancelled');
      }
      // osascript appends one newline. Do not trim spaces from passwords.
      const result = answer.subarray(
        0,
        answer.at(-1) === 10 ? answer.length - 1 : answer.length,
      );
      if (!result.length || result.length > 4096 || result.includes(0)) {
        answer.fill(0);
        throw new VaultError('cancelled');
      }
      return result;
    },
    async unlock(password) {
      checkCancelled();
      const input = Buffer.concat([password, Buffer.from([0])]);
      attemptedAttach = true;
      try {
        await runPrivate(
          '/usr/bin/hdiutil',
          [
            'attach',
            image,
            '-stdinpass',
            '-readonly',
            '-mountpoint',
            mount,
            '-nobrowse',
            '-quiet',
          ],
          { input, signal },
        );
        if (!mountedAt(await mounts(), 'NativeRead'))
          throw new VaultError('unlock-failed');
        checkCancelled();
      } catch {
        throw new VaultError(signal.aborted ? 'cancelled' : 'unlock-failed');
      } finally {
        input.fill(0);
      }
    },
    async read() {
      checkCancelled();
      try {
        return await readRegularFile(
          join(mount, 'profile.yaml'),
          maxProfileBytes,
        );
      } catch {
        throw new VaultError('invalid-profile');
      }
    },
    async close() {
      try {
        // Also checks for a mount left by an interrupted/failed attach.
        if (attemptedAttach && mountedAt(await mounts(), 'NativeRead')) {
          await runPrivate('/usr/bin/hdiutil', ['detach', mount, '-quiet']);
          if (mountedAt(await mounts(), 'NativeRead'))
            throw new VaultError('close-failed');
        }
      } finally {
        if (ownedLock) await rmdir(lock);
      }
    },
  };
}
