import {
  networkSchema,
  type Network,
  type Step,
} from '../schemas/observation.js';
import { UrlRedactor } from './url.js';
/** Only these properties are read; bodies, headers, errors and unknown keys are never copied. */
export function normalizeNetwork(
  input: {
    sequence: number;
    epochMs: number;
    url: string;
    method: string;
    resourceType: string;
  },
  redactor: UrlRedactor,
): Network {
  const method = networkSchema.shape.method.safeParse(input.method);
  const resource = networkSchema.shape.resourceType.safeParse(
    input.resourceType,
  );
  return networkSchema.parse({
    sequence: input.sequence,
    timestamp: new Date(input.epochMs).toISOString(),
    epochMs: input.epochMs,
    ...redactor.sanitize(input.url),
    method: method.success ? method.data : 'OTHER',
    resourceType: resource.success ? resource.data : 'other',
    state: 'pending',
    attribution: 'temporal-only',
    initiator: 'not-collected',
    timing: {},
  });
}
/** Recompute at export so delayed binding delivery cannot change request-start attribution. */
export function attributeRequests(
  network: Network[],
  steps: Step[],
): Network[] {
  const ordered = [...steps].sort(
    (a, b) => a.epochMs - b.epochMs || a.sequence - b.sequence,
  );
  return network.map((request) => {
    const step = ordered.findLast((s) => s.epochMs <= request.epochMs);
    const { step: _old, ...rest } = request;
    void _old;
    return networkSchema.parse({
      ...rest,
      ...(step ? { step: step.sequence } : {}),
    });
  });
}
