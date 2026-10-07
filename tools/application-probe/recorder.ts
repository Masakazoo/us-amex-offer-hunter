import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BrowserContext, Frame, Request } from 'playwright';
import { installObserver } from './browser-script.js';
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
    for (const page of context.pages())
      for (const frame of page.frames()) {
        try {
          const raw = await frame.evaluate(
            () =>
              (
                window as unknown as {
                  __probeInspect?: () => Record<string, unknown>[];
                }
              ).__probeInspect?.() ?? [],
          );
          for (const item of raw) {
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
        } catch {
          /* Navigated/detached frames are retried by the next explicit inspect. No raw errors. */
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
