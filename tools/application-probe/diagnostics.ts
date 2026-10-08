import { z } from 'zod';
import type { BrowserContext } from 'playwright';

const stageNames = [
  'literal',
  'function',
  'document',
  'controls',
  'observer',
  'observer-count',
] as const;
const stageSchema = z
  .object({
    stage: z.enum(stageNames),
    state: z.enum(['ok', 'failed', 'timeout', 'invalid-result']),
    value: z
      .union([
        z.boolean(),
        z.number().int().nonnegative().max(1000000),
        z.enum(['loading', 'interactive', 'complete']),
      ])
      .optional(),
  })
  .strict();
export const diagnosticSchema = z
  .object({
    frames: z.array(
      z
        .object({
          page: z.number().int().nonnegative(),
          frame: z.number().int().nonnegative(),
          mainFrame: z.boolean(),
          detached: z.boolean(),
          stages: z.array(stageSchema),
        })
        .strict(),
    ),
  })
  .strict();

/** Explicit, read-only ladder. No exception text, URL, DOM text or field values. */
export async function diagnose(context: BrowserContext) {
  const result: z.infer<typeof diagnosticSchema> = { frames: [] };
  const expressions = [
    'true',
    '(() => true)()',
    'document.readyState',
    'document.querySelectorAll("input,select,textarea").length',
    'typeof window.__probeInspect === "function"',
    'typeof window.__probeInspect === "function" ? window.__probeInspect().length : false',
  ];
  for (const [pageIndex, page] of context.pages().entries()) {
    for (const [frameIndex, frame] of page.frames().entries()) {
      const row: z.infer<typeof diagnosticSchema>['frames'][number] = {
        page: pageIndex,
        frame: frameIndex,
        mainFrame: frame === page.mainFrame(),
        detached: frame.isDetached(),
        stages: [],
      };
      result.frames.push(row);
      for (const [index, stage] of stageNames.entries()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            frame
              .evaluate(expressions[index]!)
              .then((value) => ({ kind: 'value' as const, value })),
            new Promise<{ kind: 'timeout' }>((resolve) => {
              timer = setTimeout(() => resolve({ kind: 'timeout' }), 3000);
            }),
          ]);
          if (outcome.kind === 'timeout') {
            row.stages.push({ stage, state: 'timeout' });
            // evaluate cannot be cancelled here; do not pile up retries on this frame.
            break;
          }
          const parsed = stageSchema.safeParse({
            stage,
            state: 'ok',
            value: outcome.value,
          });
          row.stages.push(
            parsed.success ? parsed.data : { stage, state: 'invalid-result' },
          );
        } catch {
          row.stages.push({ stage, state: 'failed' });
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    }
  }
  return diagnosticSchema.parse(result);
}
