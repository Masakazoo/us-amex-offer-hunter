import { z } from 'zod';
export const hostSchema = z
  .string()
  .regex(/^(www\.americanexpress\.com|host-[1-9]\d*|redacted)$/);
export const pathSchema = z.string().regex(/^\/(route-[1-9]\d*|redacted)?$/);
export const urlSchema = z
  .string()
  .regex(
    /^(redacted|https?:\/\/(www\.americanexpress\.com|host-[1-9]\d*)(\/(route-[1-9]\d*)?)?)$/,
  );
export const actionSchema = z.enum([
  'open',
  'focus',
  'input',
  'change',
  'blur',
  'inspect',
  'idle',
  'navigation',
]);
export const stepSchema = z
  .object({
    sequence: z.number().int().positive(),
    timestamp: z.iso.datetime(),
    epochMs: z.number().nonnegative(),
    action: actionSchema,
    field: z
      .string()
      .regex(/^field-[1-9]\d*$/)
      .optional(),
    frame: z.number().int().nonnegative(),
  })
  .strict();
export type Step = z.infer<typeof stepSchema>;
export const networkSchema = z
  .object({
    sequence: z.number().int().positive(),
    timestamp: z.iso.datetime(),
    epochMs: z.number().nonnegative(),
    url: urlSchema,
    host: hostSchema,
    path: pathSchema,
    method: z.enum([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
      'OTHER',
    ]),
    resourceType: z.enum([
      'document',
      'stylesheet',
      'image',
      'media',
      'font',
      'script',
      'texttrack',
      'xhr',
      'fetch',
      'eventsource',
      'websocket',
      'manifest',
      'other',
    ]),
    status: z.number().int().min(100).max(599).optional(),
    state: z.enum(['pending', 'finished', 'failed']),
    step: z.number().int().positive().optional(),
    attribution: z.literal('temporal-only'),
    initiator: z.literal('not-collected'),
    timing: z
      .object({
        durationMs: z.number().nonnegative().optional(),
        responseMs: z.number().nonnegative().optional(),
      })
      .strict(),
    redirectedFrom: z.number().int().positive().optional(),
  })
  .strict();
export type Network = z.infer<typeof networkSchema>;
export const observationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    timestamp: z.iso.datetime(),
    acquisition: z
      .object({
        product: z.enum(['business-platinum', 'unknown']).optional(),
        applicationCode: z
          .string()
          .regex(/^\d{5}-\d-\d$/)
          .optional(),
        source: z.enum([
          'public',
          'referral',
          'targeted',
          'logged-in',
          'unknown',
        ]),
        referringUrl: urlSchema.optional(),
      })
      .strict(),
    environment: z
      .object({
        authenticated: z.boolean().optional(),
        session: z.enum(['fresh-context', 'unknown']),
        browser: z.enum(['brave', 'chrome', 'chromium']),
        browserVersion: z
          .string()
          .regex(/^\d+(?:\.\d+){1,3}$/)
          .optional(),
        viewport: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .strict(),
        serviceWorkers: z.enum(['allowed', 'blocked']),
      })
      .strict(),
    result: z
      .object({
        displayedOfferPoints: z.number().int().min(0).max(1_000_000).optional(),
        eligibilityResult: z
          .enum(['eligible', 'not-eligible', 'unknown'])
          .optional(),
        pujObserved: z.boolean().optional(),
        approvalReached: z.boolean().optional(),
        accepted: z.literal(false),
      })
      .strict(),
    steps: z.array(stepSchema),
    network: z.array(networkSchema),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
