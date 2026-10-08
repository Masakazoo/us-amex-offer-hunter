import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BrowserContext, Frame, Request } from 'playwright';
import { installObserver } from './browser-script.js';
import { parseApplicationCode } from '../../packages/core/amex/url.js';
import {
  sanitizeField,
  type SafeField,
} from '../../packages/core/redaction/dom.js';
import { UrlRedactor } from '../../packages/core/redaction/url.js';
import {
  attributeRequests,
  normalizeNetwork,
} from '../../packages/core/redaction/network.js';
import {
  observationSchema,
  type Network,
  type Observation,
  type Step,
} from '../../packages/core/schemas/observation.js';
const browserEvent = z
  .object({
    action: z.enum(['focus', 'input', 'change', 'blur']),
    localId: z.number().int().positive(),
    epochMs: z.number().nonnegative(),
  })
  .strict();
const inspectionSchema = z
  .object({
    pages: z.number().int().nonnegative(),
    frames: z.array(
      z
        .object({
          page: z.number().int().nonnegative(),
          frame: z.number().int().nonnegative(),
          mainFrame: z.boolean(),
          applicationCodeRecognized: z.boolean(),
          state: z.enum([
            'ready',
            'observer-missing',
            'observer-failed',
            'evaluation-failed',
            'projection-failed',
          ]),
          failure: z
            .enum(['type', 'reference', 'security', 'eval', 'timeout', 'other'])
            .optional(),
          nativeControls: z.number().int().nonnegative().optional(),
          inspectedFields: z.number().int().nonnegative().optional(),
        })
        .strict(),
    ),
  })
  .strict();
type Inspection = z.infer<typeof inspectionSchema>;

export class Recorder {
  readonly steps: Step[] = [];
  readonly network: Network[] = [];
  readonly fields: SafeField[] = [];
  private requests = new Map<Request, Network>();
  private redactor = new UrlRedactor();
  private frames = new Map<Frame, number>();
  private documents = new Map<Frame, number>();
  private fieldIds = new Map<string, string>();
  private created = new Date().toISOString();
  private id = randomUUID();
  private inspection: Inspection = { pages: 0, frames: [] };
  inspectionSummary(): Inspection {
    return inspectionSchema.parse(this.inspection);
  }
  private frameId(frame: Frame) {
    if (!this.frames.has(frame)) this.frames.set(frame, this.frames.size);
    return this.frames.get(frame)!;
  }
  private fieldId(frame: Frame, localId: number) {
    const key = `${this.frameId(frame)}:${this.documents.get(frame) ?? 0}:${localId}`;
    if (!this.fieldIds.has(key))
      this.fieldIds.set(key, `field-${this.fieldIds.size + 1}`);
    return this.fieldIds.get(key)!;
  }
  mark(
    action: Step['action'],
    frame = 0,
    epochMs = Date.now(),
    field?: string,
  ) {
    this.steps.push({
      sequence: this.steps.length + 1,
      timestamp: new Date(epochMs).toISOString(),
      epochMs,
      action,
      frame,
      ...(field ? { field } : {}),
    });
  }
  async attach(context: BrowserContext) {
    await context.exposeBinding('__probeEvent', ({ frame }, raw: unknown) => {
      const result = browserEvent.safeParse(raw);
      if (!result.success) return;
      const event = result.data;
      // Prevent arbitrary epoch injection from creating malformed reports.
      if (Math.abs(event.epochMs - Date.now()) > 60_000) return;
      this.mark(
        event.action,
        this.frameId(frame),
        event.epochMs,
        this.fieldId(frame, event.localId),
      );
    });
    await context.addInitScript(installObserver);
    context.on('page', (page) => {
      page.on('framenavigated', (frame) => {
        this.documents.set(frame, (this.documents.get(frame) ?? 0) + 1);
        this.mark('navigation', this.frameId(frame));
      });
    });
    context.on('request', (request) => {
      const timing = request.timing();
      const row = normalizeNetwork(
        {
          sequence: this.network.length + 1,
          epochMs: timing.startTime > 0 ? timing.startTime : Date.now(),
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
        },
        this.redactor,
      );
      const previous = request.redirectedFrom();
      if (previous && this.requests.has(previous))
        row.redirectedFrom = this.requests.get(previous)!.sequence;
      this.requests.set(request, row);
      this.network.push(row);
    });
    context.on('response', (response) => {
      const row = this.requests.get(response.request());
      if (row && response.status() >= 100 && response.status() <= 599)
        row.status = response.status();
    });
    const complete = (request: Request, state: 'finished' | 'failed') => {
      const row = this.requests.get(request);
      if (!row) return;
      row.state = state;
      const timing = request.timing();
      // startTime can become available only later: correct before final attribution.
      if (timing.startTime > 0) {
        row.epochMs = timing.startTime;
        row.timestamp = new Date(timing.startTime).toISOString();
      }
      if (timing.responseEnd >= 0) row.timing.durationMs = timing.responseEnd;
      if (timing.responseStart >= 0)
        row.timing.responseMs = timing.responseStart;
    };
    context.on('requestfinished', (request) => complete(request, 'finished'));
    context.on('requestfailed', (request) => complete(request, 'failed'));
  }
  async inspect(context: BrowserContext) {
    this.mark('inspect');
    const pages = context.pages();
    this.inspection = { pages: pages.length, frames: [] };
    for (const [pageIndex, page] of pages.entries())
      for (const frame of page.frames()) {
        const summary: Inspection['frames'][number] = {
          page: pageIndex,
          frame: this.frameId(frame),
          mainFrame: frame === page.mainFrame(),
          // Only a boolean leaves memory: never export the URL or query value.
          applicationCodeRecognized:
            parseApplicationCode(frame.url()) !== undefined,
          state: 'evaluation-failed',
        };
        this.inspection.frames.push(summary);
        try {
          const snapshot = await frame.evaluate(() => {
            const observer = (
              window as unknown as {
                __probeInspect?: () => Record<string, unknown>[];
              }
            ).__probeInspect;
            const snapshot = {
              observerAvailable: typeof observer === 'function',
              nativeControls: document.querySelectorAll('input,select,textarea')
                .length,
              fields: [] as Record<string, unknown>[],
              failure: undefined as
                | 'type'
                | 'reference'
                | 'security'
                | 'eval'
                | 'other'
                | undefined,
            };
            try {
              if (typeof observer === 'function') snapshot.fields = observer();
            } catch (error) {
              const name = error instanceof Error ? error.name : '';
              snapshot.failure =
                name === 'TypeError'
                  ? 'type'
                  : name === 'ReferenceError'
                    ? 'reference'
                    : name === 'SecurityError'
                      ? 'security'
                      : name === 'EvalError'
                        ? 'eval'
                        : 'other';
            }
            return snapshot;
          });
          summary.state = snapshot.failure
            ? 'observer-failed'
            : snapshot.observerAvailable
              ? 'ready'
              : 'observer-missing';
          if (snapshot.failure) summary.failure = snapshot.failure;
          summary.nativeControls = snapshot.nativeControls;
          summary.inspectedFields = snapshot.fields.length;
          for (const item of snapshot.fields) {
            if (
              typeof item.localId !== 'number' ||
              !Number.isSafeInteger(item.localId) ||
              item.localId <= 0
            )
              continue;
            const safe = sanitizeField(
              item,
              this.fieldId(frame, item.localId),
              this.frameId(frame),
            );
            const previous = this.fields.findIndex(
              (f) => f.field === safe.field,
            );
            if (previous < 0) this.fields.push(safe);
            else this.fields[previous] = safe;
          }
        } catch (error) {
          if (summary.state === 'ready') summary.state = 'projection-failed';
          // Match only fixed error categories; never print message/stack or arbitrary names.
          const message = error instanceof Error ? error.message : '';
          summary.failure = /TypeError/.test(message)
            ? 'type'
            : /ReferenceError/.test(message)
              ? 'reference'
              : /SecurityError/.test(message)
                ? 'security'
                : /EvalError/.test(message)
                  ? 'eval'
                  : error instanceof Error && error.name === 'TimeoutError'
                    ? 'timeout'
                    : 'other';
        }
      }
    return this.safeFields();
  }
  safeFields() {
    const network = attributeRequests(this.network, this.steps);
    return this.fields.map((field) => ({
      ...field,
      networkSafety: this.steps.some(
        (step) =>
          step.field === field.field &&
          ['input', 'change', 'blur'].includes(step.action) &&
          network.some((n) => n.step === step.sequence),
      )
        ? ('requires-real-user-data' as const)
        : ('unknown' as const),
    }));
  }
  observation(
    environment: Observation['environment'],
    acquisition: Observation['acquisition'] = { source: 'unknown' },
  ): Observation {
    const steps = [...this.steps]
      .sort((a, b) => a.epochMs - b.epochMs || a.sequence - b.sequence)
      .map((step, index) => ({ ...step, sequence: index + 1 }));
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.id,
      timestamp: this.created,
      acquisition,
      environment,
      result: { accepted: false },
      steps,
      network: attributeRequests(this.network, steps),
    });
  }
}
