import { expect, test } from 'vitest';
import {
  base64,
  derive,
  envelopeSchema,
  open,
  seal,
  unbase64,
} from '../tools/security-spike/crypto.js';

test('authenticated round trip, wrong password, ciphertext and metadata tampering', async () => {
  const e = await seal('SYNTHETIC test password');
  const raw = await derive('SYNTHETIC test password', e);
  const wrong = await derive('WRONG synthetic password', e);
  try {
    await expect(open(e, raw)).resolves.toBeUndefined();
    await expect(open(e, wrong)).rejects.toThrow('AUTH_OR_CORRUPT');
    const bytes = unbase64(e.ciphertext);
    bytes[0] = bytes[0]! ^ 1;
    await expect(
      open({ ...e, ciphertext: base64(bytes) }, raw),
    ).rejects.toThrow('AUTH_OR_CORRUPT');
    await expect(
      open({ ...e, revision: crypto.randomUUID() }, raw),
    ).rejects.toThrow('AUTH_OR_CORRUPT');
    expect(envelopeSchema.safeParse({ ...e, version: 2 }).success).toBe(false);
    expect(
      envelopeSchema.safeParse({ ...e, kdf: { ...e.kdf, iterations: 1 } })
        .success,
    ).toBe(false);
    expect(
      envelopeSchema.safeParse({ ...e, plaintext: 'not allowed' }).success,
    ).toBe(false);
  } finally {
    raw.fill(0);
    wrong.fill(0);
  }
});

test('fresh salt, IV and revision per write; password required', async () => {
  const a = await seal('SYNTHETIC test password');
  const b = await seal('SYNTHETIC test password');
  expect(a.kdf.salt).not.toBe(b.kdf.salt);
  expect(a.cipher.iv).not.toBe(b.cipher.iv);
  expect(a.revision).not.toBe(b.revision);
  await expect(seal('')).rejects.toThrow('INVALID_PASSWORD');
});
