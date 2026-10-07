import { z } from 'zod';
import { observationSchema } from '../../packages/core/schemas/observation.js';
import { fieldSchema } from '../../packages/core/redaction/dom.js';
export const reportSchema = z
  .object({ observation: observationSchema, fields: z.array(fieldSchema) })
  .strict();
export function renderReport(raw: unknown): string {
  const { observation } = reportSchema.parse(raw);
  const lines = [
    '# Application probe',
    '',
    'Temporal correlation only; no causal claim. URLs contain run-local aliases.',
    '',
  ];
  for (const step of observation.steps) {
    lines.push(
      `STEP ${String(step.sequence).padStart(2, '0')} ${step.action}${step.field ? ' ' + step.field : ''} (frame ${step.frame})`,
      step.timestamp,
    );
    const requests = observation.network.filter(
      (n) => n.step === step.sequence,
    );
    if (!requests.length)
      lines.push('network changes: none observed in this interval');
    for (const n of requests)
      lines.push(
        `#${n.sequence} ${n.method} ${n.url} status:${n.status ?? 'unknown'} ${n.state} ${n.timing.durationMs ?? '?'}ms`,
      );
    lines.push('');
  }
  const unattributed = observation.network.filter((n) => n.step === undefined);
  lines.push(
    `Requests before any step: ${unattributed.length}. Pending at stop: ${observation.network.filter((n) => n.state === 'pending').length}.`,
  );
  return lines.join('\n');
}
