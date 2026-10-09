import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadVault,
  VaultError,
  type VaultDriver,
} from '../tools/native-vault/load.js';
import { encodeFrame, readRequest } from '../tools/native-vault/protocol.js';
import { readRegularFile } from '../tools/native-vault/mac-vault.js';
import { fieldSpecs } from '../apps/extension/src/profile.js';
import { nativeResponseSchema } from '../apps/extension/src/native-vault.js';

const yaml = fieldSpecs.map(([key]) => `${key}: "SENTINEL"`).join('\n');
function fixture() {
  const calls: string[] = [];
  const password = Buffer.from('SECRET_SENTINEL');
  const raw = Buffer.from(yaml);
  const driver: VaultDriver = {
    async prepare() {
      calls.push('prepare');
    },
    async password() {
      calls.push('password');
      return password;
    },
    async unlock(value) {
      calls.push('unlock');
      expect(value.toString()).toBe('SECRET_SENTINEL');
    },
    async read() {
      calls.push('read');
      expect(password.every((b) => b === 0)).toBe(true);
      return raw;
    },
    async close() {
      calls.push('close');
    },
  };
  return { calls, password, raw, driver };
}
describe('native encrypted-vault boundary', () => {
  it('releases only validated values after close and clears secret buffers', async () => {
    const f = fixture();
    const result = await loadVault(f.driver);
    expect(f.calls).toEqual(['prepare', 'password', 'unlock', 'read', 'close']);
    expect(result.status).toBe('ok');
    expect(nativeResponseSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL');
    expect(f.password.every((b) => b === 0)).toBe(true);
    expect(f.raw.every((b) => b === 0)).toBe(true);
  });
  it.each(['prepare', 'password', 'unlock', 'read'] as const)(
    'redacts errors at %s and still closes',
    async (stage) => {
      const f = fixture();
      f.driver[stage] = async () => {
        throw new Error('PRIVATE_SENTINEL');
      };
      expect(await loadVault(f.driver)).toEqual({
        status: 'error',
        code: 'unavailable',
      });
      expect(f.calls.at(-1)).toBe('close');
      if (stage === 'unlock' || stage === 'read')
        expect(f.password.every((b) => b === 0)).toBe(true);
    },
  );
  it('returns a fixed cancellation code without attempting unlock', async () => {
    const f = fixture();
    f.driver.password = async () => {
      throw new VaultError('cancelled');
    };
    expect(await loadVault(f.driver)).toEqual({
      status: 'error',
      code: 'cancelled',
    });
    expect(f.calls).toEqual(['prepare', 'close']);
  });
  it('withholds an otherwise valid profile if detach fails', async () => {
    const f = fixture();
    f.driver.close = async () => {
      throw new Error('PRIVATE_SENTINEL');
    };
    expect(await loadVault(f.driver)).toEqual({
      status: 'error',
      code: 'close-failed',
    });
    expect(f.raw.every((b) => b === 0)).toBe(true);
  });
  it('rejects malformed profiles and closes before reporting failure', async () => {
    const f = fixture();
    const invalid = Buffer.from(yaml + '\nunknown: "PRIVATE_SENTINEL"');
    f.driver.read = async () => invalid;
    expect(await loadVault(f.driver)).toEqual({
      status: 'error',
      code: 'invalid-profile',
    });
    expect(f.calls.at(-1)).toBe('close');
    expect(invalid.every((b) => b === 0)).toBe(true);
  });
  it('refuses symlinks, oversized files and directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'amex-native-unit-'));
    try {
      const file = join(directory, 'sentinel.txt');
      const link = join(directory, 'link.txt');
      await writeFile(file, 'SENTINEL');
      await symlink(file, link);
      expect((await readRegularFile(file, 8)).toString()).toBe('SENTINEL');
      await expect(readRegularFile(link, 8)).rejects.toThrow();
      await expect(readRegularFile(file, 7)).rejects.toThrow();
      await expect(readRegularFile(directory, 1024)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([
    { status: 'ok', values: {}, password: 'PRIVATE_SENTINEL' },
    { status: 'error', code: 'unavailable', message: 'PRIVATE_SENTINEL' },
    { status: 'error', code: 'PRIVATE_SENTINEL' },
  ])('rejects extra host data and unreviewed error strings', (value) => {
    expect(nativeResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe('native framing and request allow-list', () => {
  async function accepts(parts: Buffer[]) {
    const input = new PassThrough();
    const result = readRequest(input);
    for (const part of parts) input.write(part);
    input.end();
    return result;
  }
  it('accepts a fragmented fixed request', async () => {
    const frame = encodeFrame({ action: 'read-profile' });
    expect(
      await accepts([
        frame.subarray(0, 2),
        frame.subarray(2, 7),
        frame.subarray(7),
      ]),
    ).toBe(true);
  });
  it.each([
    { action: 'submit' },
    { action: 'read-profile', path: '/SENTINEL' },
    { action: 'read-profile', password: 'SECRET_SENTINEL' },
    ['read-profile'],
    null,
    'read-profile',
  ])(
    'rejects unsupported requests before touching the vault',
    async (value) => {
      expect(await accepts([encodeFrame(value)])).toBe(false);
    },
  );
  it('rejects truncated, oversized, trailing, and invalid JSON data', async () => {
    const frame = encodeFrame({ action: 'read-profile' });
    expect(await accepts([frame.subarray(0, -1)])).toBe(false);
    expect(await accepts([Buffer.alloc(261)])).toBe(false);
    expect(await accepts([Buffer.concat([frame, Buffer.from([0])])])).toBe(
      false,
    );
    const invalid = Buffer.from(frame);
    invalid[4] = 0;
    expect(await accepts([invalid])).toBe(false);
  });
});
