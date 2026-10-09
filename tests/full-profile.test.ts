import { describe, it, expect } from 'vitest';
import {
  fullProfileSchema,
  profileIssues,
} from '../apps/extension/src/full-profile.js';
import { parseVaultProfile } from '../apps/extension/src/vault-profile.js';
import { fullSentinelProfile } from './full-form-fixture.js';

describe('full encrypted profile', () => {
  it('roundtrips reviewed fields and explicitly chosen options', () => {
    const p = fullSentinelProfile();
    const parsed = parseVaultProfile(
      Object.entries(p)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n'),
    );
    expect(parsed).toEqual(p);
    expect(profileIssues(p)).toEqual([]);
  });
  it('requires applicable fields and validates format without returning values', () => {
    const p = fullSentinelProfile();
    p.ssn = 'SENTINEL';
    p.cellPhone = '';
    p.dateOfBirth = '02-31-2000';
    expect(profileIssues(p)).toEqual(
      expect.arrayContaining([
        { field: 'ssn', reason: 'format' },
        { field: 'cellPhone', reason: 'required' },
        { field: 'dateOfBirth', reason: 'format' },
      ]),
    );
    expect(JSON.stringify(profileIssues(p))).not.toContain('SENTINEL');
  });
  it('requires home address and federal tax id only when applicable', () => {
    const p = fullSentinelProfile();
    p.federalTaxId = '';
    p.addressLine1 = '';
    expect(profileIssues(p)).toEqual([]);
    p.companyStructure = 'Corporation';
    p.sameAddress = 'no';
    expect(profileIssues(p)).toEqual(
      expect.arrayContaining([
        { field: 'federalTaxId', reason: 'required' },
        { field: 'addressLine1', reason: 'required' },
      ]),
    );
  });
  it('rejects unknown choices, extra fields and control characters', () => {
    const p = fullSentinelProfile();
    expect(
      fullProfileSchema.safeParse({ ...p, industryType: 'UNREVIEWED' }).success,
    ).toBe(false);
    expect(
      fullProfileSchema.safeParse({ ...p, newField: 'SENTINEL' }).success,
    ).toBe(false);
    expect(
      fullProfileSchema.safeParse({ ...p, businessAddressLine1: '\n' }).success,
    ).toBe(false);
  });
  it('does not silently invent values for a legacy seven-field file', () => {
    const p = parseVaultProfile(
      [
        'email',
        'legalBusinessName',
        'businessNameOnCard',
        'companyDBAName',
        'firstName',
        'lastName',
        'nameOnCard',
      ]
        .map((k) => `${k}: "SENTINEL"`)
        .join('\n'),
    )!;
    expect(p.ssn).toBe('');
    expect(p.companyStructure).toBe('');
    expect(profileIssues(p).some((i) => i.field === 'ssn')).toBe(true);
  });
});
