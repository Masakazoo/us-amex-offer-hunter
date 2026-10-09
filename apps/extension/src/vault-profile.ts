import { z } from 'zod';
import { fullFieldSpecs, fullProfileSchema } from './full-profile.js';

export const sessionProfileKey = 'vaultProfileSessionV1';
export const maxProfileBytes = 8192;
export const sessionProfileSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('vault-file'),
    values: fullProfileSchema,
  })
  .strict();

// Deliberately accepts only the flat, double-quoted template format.
// No YAML tags, aliases, implicit types, duplicate keys or extra fields.
export function parseVaultProfile(source: string) {
  try {
    if (new TextEncoder().encode(source).length > maxProfileBytes)
      return undefined;
    const values: Record<string, unknown> = Object.create(null);
    for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      if (/^\s*(?:#.*)?$/.test(line)) continue;
      const match =
        /^([A-Za-z][A-Za-z0-9]*):[ \t]*("(?:[^"\\\r\n]|\\.)*")[ \t]*$/.exec(
          line,
        );
      if (!match) return undefined;
      const key = match[1]!;
      if (
        !fullFieldSpecs.some((field) => field.key === key) ||
        Object.hasOwn(values, key)
      )
        return undefined;
      values[key] = JSON.parse(match[2]!);
    }
    const parsed = fullProfileSchema.safeParse(values);
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Never expose parser errors: they can include the source value.
    return undefined;
  }
}
