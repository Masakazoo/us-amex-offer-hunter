import { describe, expect, it } from 'vitest';
import { fieldSpecs } from '../apps/extension/src/profile.js';
import {
  maxProfileBytes,
  parseVaultProfile,
} from '../apps/extension/src/vault-profile.js';

const template = fieldSpecs.map(([key]) => `${key}: "SENTINEL"`).join('\n');
describe('vault template boundary', () => {
  it('preserves exact strings and accepts blank DBA, comments, BOM and CRLF', () => {
    const parsed = parseVaultProfile(
      '\uFEFF# template\r\n' +
        template
          .replace('companyDBAName: "SENTINEL"', 'companyDBAName: ""')
          .replaceAll('\n', '\r\n'),
    );
    expect(parsed?.companyDBAName).toBe('');
    expect(parsed?.firstName).toBe('SENTINEL');
    expect(
      parseVaultProfile(
        template.replace(
          'firstName: "SENTINEL"',
          `firstName: ${JSON.stringify(' A"B ')}`,
        ),
      )?.firstName,
    ).toBe(' A"B ');
  });
  it.each([
    template + '\nssn: "SENTINEL"',
    template + '\nfirstName: "SENTINEL"',
    template.replace('firstName: "SENTINEL"', ''),
    template.replace('firstName: "SENTINEL"', 'firstName: true'),
    template.replace('firstName: "SENTINEL"', 'firstName: &ref "SENTINEL"'),
    template.replace('firstName: "SENTINEL"', 'firstName: *ref'),
    template.replace('firstName: "SENTINEL"', 'firstName: !!str "SENTINEL"'),
    template.replace('firstName: "SENTINEL"', 'firstName: "\\n"'),
    template.replace('firstName: "SENTINEL"', `firstName: "${'X'.repeat(16)}"`),
    template + '\n__proto__: "SENTINEL"',
    '#' + 'X'.repeat(maxProfileBytes),
  ])('rejects invalid input without returning source or throwing', (source) => {
    expect(parseVaultProfile(source)).toBeUndefined();
  });
});
