import { z } from 'zod';
import { fullProfileSchema, type FullProfile } from '../full-profile.js';

export type ErrorCode =
  | 'NOT_REGISTERED'
  | 'LOCKED'
  | 'AUTH_OR_CORRUPT'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_VERSION'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'STORAGE_READ'
  | 'STORAGE_WRITE'
  | 'COMMIT_UNKNOWN'
  | 'CANCELLED'
  | 'RATE_LIMITED';
export class VaultError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
export function fail(code: ErrorCode): never {
  throw new VaultError(code);
}
export const ITERATIONS = 600_000;
export function base64(bytes: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...bytes));
}
export function unbase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export const fixedBase64 = (length: number) =>
  z
    .string()
    .length(Math.ceil(length / 3) * 4)
    .refine((value) => {
      try {
        const bytes = unbase64(value);
        return bytes.length === length && base64(bytes) === value;
      } catch {
        return false;
      }
    });
export const envelopeSchema = z
  .object({
    version: z.literal(1),
    payloadVersion: z.literal(1),
    revision: z.uuid(),
    kdf: z
      .object({
        name: z.literal('PBKDF2'),
        hash: z.literal('SHA-256'),
        iterations: z.literal(ITERATIONS),
        salt: fixedBase64(16),
      })
      .strict(),
    cipher: z
      .object({
        name: z.literal('AES-GCM'),
        iv: fixedBase64(12),
        tagLength: z.literal(128),
      })
      .strict(),
    ciphertext: z
      .string()
      .min(24)
      .max(65_536)
      .refine((value) => {
        try {
          const bytes = unbase64(value);
          return bytes.length >= 16 && base64(bytes) === value;
        } catch {
          return false;
        }
      }),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export function parseEnvelope(value: unknown): Envelope {
  if (
    value &&
    typeof value === 'object' &&
    (('version' in value && value.version !== 1) ||
      ('payloadVersion' in value && value.payloadVersion !== 1))
  )
    fail('UNSUPPORTED_VERSION');
  const result = envelopeSchema.safeParse(value);
  return result.success ? result.data : fail('AUTH_OR_CORRUPT');
}
export function parseProfile(value: unknown): FullProfile {
  const result = fullProfileSchema.safeParse(value);
  if (!result.success) fail('INVALID_INPUT');
  return result.data;
}
export function passwordValid(
  value: unknown,
  creating: boolean,
): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 1024 &&
    Array.from(value).length >= (creating ? 12 : 1) &&
    !Array.from(value).some((c) => c.length === 1 && /[\uD800-\uDFFF]/.test(c))
  );
}
function aad(e: Envelope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      e.version,
      e.payloadVersion,
      e.revision,
      e.kdf.name,
      e.kdf.hash,
      e.kdf.iterations,
      e.kdf.salt,
      e.cipher.name,
      e.cipher.iv,
      e.cipher.tagLength,
    ]),
  );
}
export async function derive(
  password: string,
  e: Pick<Envelope, 'kdf'>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!passwordValid(password, false)) fail('INVALID_INPUT');
  // Only fixed, schema-checked KDF parameters reach Web Crypto.
  const bytes = new TextEncoder().encode(password);
  try {
    const key = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, [
      'deriveBits',
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: ITERATIONS,
          salt: unbase64(e.kdf.salt),
        },
        key,
        256,
      ),
    );
  } finally {
    bytes.fill(0);
  }
}
async function importKey(raw: Uint8Array<ArrayBuffer>) {
  if (raw.length !== 32) fail('LOCKED');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function encrypt(
  profile: unknown,
  raw: Uint8Array<ArrayBuffer>,
  kdf: Envelope['kdf'],
  previousIv?: string,
): Promise<Envelope> {
  const iv = base64(crypto.getRandomValues(new Uint8Array(12)));
  if (iv === previousIv) fail('CANCELLED');
  const e: Envelope = {
    version: 1,
    payloadVersion: 1,
    revision: crypto.randomUUID(),
    kdf,
    cipher: { name: 'AES-GCM', iv, tagLength: 128 },
    ciphertext: '',
  };
  const bytes = new TextEncoder().encode(JSON.stringify(parseProfile(profile)));
  try {
    e.ciphertext = base64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: unbase64(iv),
            additionalData: aad(e),
            tagLength: 128,
          },
          await importKey(raw),
          bytes,
        ),
      ),
    );
    return parseEnvelope(e);
  } finally {
    bytes.fill(0);
  }
}
export async function seal(
  profile: unknown,
  password: string,
): Promise<Envelope> {
  if (!passwordValid(password, true)) fail('INVALID_INPUT');
  const kdf: Envelope['kdf'] = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ITERATIONS,
    salt: base64(crypto.getRandomValues(new Uint8Array(16))),
  };
  const raw = await derive(password, { kdf });
  try {
    return await encrypt(profile, raw, kdf);
  } finally {
    raw.fill(0);
  }
}
export async function open(
  envelope: unknown,
  raw: Uint8Array<ArrayBuffer>,
): Promise<FullProfile> {
  const e = parseEnvelope(envelope);
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: unbase64(e.cipher.iv),
          additionalData: aad(e),
          tagLength: 128,
        },
        await importKey(raw),
        unbase64(e.ciphertext),
      ),
    );
    return parseProfile(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
  } catch {
    return fail('AUTH_OR_CORRUPT');
  } finally {
    bytes?.fill(0);
  }
}
