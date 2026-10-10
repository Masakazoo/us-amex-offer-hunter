/** Synthetic-only spike. No production profile dependency. */
import { z } from 'zod';

export const ITERATIONS = 600_000;
const b64 = (length: number) =>
  z.string().refine((value) => {
    try {
      return (
        unbase64(value).length === length && base64(unbase64(value)) === value
      );
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
        salt: b64(16),
      })
      .strict(),
    cipher: z
      .object({
        name: z.literal('AES-GCM'),
        iv: b64(12),
        tagLength: z.literal(128),
      })
      .strict(),
    ciphertext: z
      .string()
      .min(24)
      .max(100_000)
      .refine((value) => {
        try {
          return (
            unbase64(value).length >= 16 && base64(unbase64(value)) === value
          );
        } catch {
          return false;
        }
      }),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export const synthetic = {
  marker: 'SYNTHETIC-ONLY-NOT-A-PERSON',
  field: 'FIXTURE',
};
const payloadSchema = z
  .object({
    marker: z.literal(synthetic.marker),
    field: z.literal(synthetic.field),
  })
  .strict();
export function base64(bytes: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...bytes));
}
export function unbase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function aad(envelope: Envelope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      envelope.version,
      envelope.payloadVersion,
      envelope.revision,
      envelope.kdf.name,
      envelope.kdf.hash,
      envelope.kdf.iterations,
      envelope.kdf.salt,
      envelope.cipher.name,
      envelope.cipher.iv,
      envelope.cipher.tagLength,
    ]),
  );
}
export async function derive(
  password: string,
  envelope: Envelope,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!password || password.length > 1024) throw new Error('INVALID_PASSWORD');
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
          iterations: envelope.kdf.iterations,
          salt: unbase64(envelope.kdf.salt),
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
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function seal(password: string): Promise<Envelope> {
  const envelope: Envelope = {
    version: 1,
    payloadVersion: 1,
    revision: crypto.randomUUID(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: ITERATIONS,
      salt: base64(crypto.getRandomValues(new Uint8Array(16))),
    },
    cipher: {
      name: 'AES-GCM',
      iv: base64(crypto.getRandomValues(new Uint8Array(12))),
      tagLength: 128,
    },
    ciphertext: '',
  };
  const raw = await derive(password, envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(synthetic));
  try {
    envelope.ciphertext = base64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: unbase64(envelope.cipher.iv),
            additionalData: aad(envelope),
            tagLength: 128,
          },
          await importKey(raw),
          bytes,
        ),
      ),
    );
    return envelope;
  } finally {
    raw.fill(0);
    bytes.fill(0);
  }
}
export async function open(
  envelope: Envelope,
  raw: Uint8Array<ArrayBuffer>,
): Promise<void> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: unbase64(envelope.cipher.iv),
          additionalData: aad(envelope),
          tagLength: 128,
        },
        await importKey(raw),
        unbase64(envelope.ciphertext),
      ),
    );
    payloadSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('AUTH_OR_CORRUPT');
  } finally {
    bytes?.fill(0);
  }
}
