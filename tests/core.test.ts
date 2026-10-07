import { describe, expect, it } from 'vitest';
import { parseApplicationCode } from '../packages/core/amex/url.js';
import { identifyField } from '../packages/core/amex/fields.js';
import { UrlRedactor } from '../packages/core/redaction/url.js';
import {
  normalizeNetwork,
  attributeRequests,
} from '../packages/core/redaction/network.js';
import { sanitizeField } from '../packages/core/redaction/dom.js';
import {
  observationSchema,
  type Step,
} from '../packages/core/schemas/observation.js';
import {
  reportSchema,
  renderReport,
} from '../tools/application-probe/report.js';
const epochMs = 1800000000000;
const request = () =>
  normalizeNetwork(
    {
      sequence: 1,
      epochMs,
      url: 'https://www.americanexpress.com/private-path?unknown=PRIVATE_SENTINEL',
      method: 'POST',
      resourceType: 'fetch',
    },
    new UrlRedactor(),
  );
const observation = () => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  timestamp: new Date(epochMs).toISOString(),
  acquisition: { source: 'unknown' },
  environment: {
    session: 'fresh-context',
    browser: 'brave',
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'blocked',
  },
  result: { accepted: false },
  steps: [],
  network: [request()],
});
describe('application code', () => {
  it('accepts a single explicit code on the exact Amex HTTPS host', () =>
    expect(
      parseApplicationCode(
        'https://www.americanexpress.com/?applicationCode=68443-9-0',
      ),
    ).toBe('68443-9-0'));
  it.each([
    'https://evil.example/?applicationCode=68443-9-0',
    'http://www.americanexpress.com/?applicationCode=68443-9-0',
    'https://www.americanexpress.com/?applicationCode=68443-9-0&applicationCode=12345-1-1',
    'https://www.americanexpress.com/?token=68443-9-0',
    'https://www.americanexpress.com/?applicationCode=PRIVATE_SENTINEL',
    'invalid',
  ])('rejects ambiguous or unapproved location %s', (url) =>
    expect(parseApplicationCode(url)).toBeUndefined(),
  );
});
describe('allow-list redaction', () => {
  it('drops credentials, query, fragment, sensitive host/path; aliases consistently within run', () => {
    const redactor = new UrlRedactor();
    const first = redactor.sanitize(
      'https://PRIVATE_SENTINEL:PRIVATE_SENTINEL@private-sentinel.example/private-sentinel?email=PRIVATE_SENTINEL#PRIVATE_SENTINEL',
    );
    expect(first).toEqual({
      url: 'https://host-1/route-1',
      host: 'host-1',
      path: '/route-1',
    });
    expect(
      redactor.sanitize(
        'https://private-sentinel.example/private-sentinel?another=value',
      ),
    ).toEqual(first);
    expect(redactor.sanitize('data:text/plain,PRIVATE_SENTINEL')).toEqual({
      url: 'redacted',
      host: 'redacted',
      path: '/redacted',
    });
  });
  it('projects metadata rather than recursively filtering unknown bodies and headers', () => {
    const raw = {
      sequence: 1,
      epochMs,
      url: 'https://www.americanexpress.com/?token=PRIVATE_SENTINEL',
      method: 'GET',
      resourceType: 'fetch',
      headers: { Authorization: 'PRIVATE_SENTINEL' },
      body: 'PRIVATE_SENTINEL',
      cookie: 'PRIVATE_SENTINEL',
    };
    expect(
      JSON.stringify(normalizeNetwork(raw, new UrlRedactor())),
    ).not.toContain('PRIVATE_SENTINEL');
    expect(
      normalizeNetwork(
        {
          ...raw,
          method: 'PRIVATE_SENTINEL',
          resourceType: 'PRIVATE_SENTINEL',
        },
        new UrlRedactor(),
      ).method,
    ).toBe('OTHER');
  });
  it('never exports values, unknown DOM attributes, validation messages or patterns', () => {
    const field = sanitizeField(
      {
        element: 'input',
        type: 'text',
        name: 'PRIVATE_SENTINEL',
        id: 'PRIVATE_SENTINEL',
        value: 'PRIVATE_SENTINEL',
        label: 'Email Address',
        placeholder: 'PRIVATE_SENTINEL',
        pattern: 'PRIVATE_SENTINEL',
        validationMessage: 'PRIVATE_SENTINEL',
      },
      'field-1',
      0,
    );
    expect(field.semantic).toBe('Email Address');
    expect(JSON.stringify(field)).not.toContain('PRIVATE_SENTINEL');
    expect(field.attributes.find((a) => a.attribute === 'id')).toEqual({
      attribute: 'id',
      present: true,
    });
  });
  it('uses multiple semantic signals and abstains on ambiguity', () => {
    expect(identifyField(['legal_business_name'])).toBe('Legal Business Name');
    expect(identifyField(['First Name', 'Last Name'])).toBe('ambiguous');
    expect(identifyField(['unrecognized'])).toBe('unknown');
  });
});
describe('observation boundary', () => {
  it('accepts a minimal observation with genuinely unknown results', () =>
    expect(observationSchema.safeParse(observation()).success).toBe(true));
  it.each([
    'ssn',
    'itin',
    'federalTaxId',
    'dateOfBirth',
    'name',
    'address',
    'phone',
    'email',
    'income',
    'businessRevenue',
    'cookie',
    'authorization',
    'accessToken',
    'sessionToken',
    'applicantRequestToken',
    'requestBody',
    'responseBody',
  ])('rejects unexpected %s at all object boundaries', (key) => {
    const value = observation();
    expect(
      observationSchema.safeParse({ ...value, [key]: 'PRIVATE_SENTINEL' })
        .success,
    ).toBe(false);
    for (const section of ['acquisition', 'environment', 'result'] as const)
      expect(
        observationSchema.safeParse({
          ...value,
          [section]: { ...value[section], [key]: 'PRIVATE_SENTINEL' },
        }).success,
      ).toBe(false);
    expect(
      observationSchema.safeParse({
        ...value,
        network: [{ ...request(), [key]: 'PRIVATE_SENTINEL' }],
      }).success,
    ).toBe(false);
  });
  it('rejects raw URLs, acceptance, unconstrained result text, and raw paths', () => {
    const value = observation();
    expect(
      observationSchema.safeParse({ ...value, result: { accepted: true } })
        .success,
    ).toBe(false);
    expect(
      observationSchema.safeParse({
        ...value,
        result: { accepted: false, eligibilityResult: 'PRIVATE_SENTINEL' },
      }).success,
    ).toBe(false);
    expect(
      observationSchema.safeParse({
        ...value,
        network: [{ ...request(), path: '/PRIVATE_SENTINEL' }],
      }).success,
    ).toBe(false);
    expect(
      observationSchema.safeParse({
        ...value,
        acquisition: {
          source: 'public',
          referringUrl:
            'https://www.americanexpress.com/?token=PRIVATE_SENTINEL',
        },
      }).success,
    ).toBe(false);
  });
});
describe('network attribution', () => {
  it('uses request start, not finish or event arrival order; earlier requests remain unassigned', () => {
    const steps: Step[] = [
      {
        sequence: 2,
        epochMs: epochMs + 5,
        timestamp: new Date(epochMs + 5).toISOString(),
        action: 'blur',
        frame: 0,
      },
      {
        sequence: 1,
        epochMs: epochMs - 1,
        timestamp: new Date(epochMs - 1).toISOString(),
        action: 'focus',
        frame: 0,
      },
    ];
    expect(
      attributeRequests(
        [{ ...request(), state: 'finished', timing: { durationMs: 900 } }],
        steps,
      )[0]?.step,
    ).toBe(1);
    expect(
      attributeRequests(
        [{ ...request(), epochMs: epochMs - 100, step: 2 }],
        steps,
      )[0]?.step,
    ).toBeUndefined();
  });
  it('renders an explicit no-network interval, and refuses unsafe reports', () => {
    const value = observationSchema.parse({
      ...observation(),
      steps: [
        {
          sequence: 1,
          epochMs: epochMs + 100,
          timestamp: new Date(epochMs + 100).toISOString(),
          action: 'focus',
          frame: 0,
        },
      ],
    });
    expect(renderReport({ observation: value, fields: [] })).toContain(
      'none observed in this interval',
    );
    expect(
      reportSchema.safeParse({
        observation: value,
        fields: [],
        raw: 'PRIVATE_SENTINEL',
      }).success,
    ).toBe(false);
  });
});
