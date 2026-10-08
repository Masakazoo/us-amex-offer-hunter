import { describe, it, expect } from 'vitest';
import {
  fieldSpecs,
  profileSchema,
  storedProfileSchema,
} from '../apps/extension/src/profile.js';

describe('local profile boundary', () => {
  const values = Object.fromEntries(
    fieldSpecs.map(([key]) => [key, 'SENTINEL']),
  );
  it('accepts only the seven reviewed fields, without normalization or truncation', () => {
    expect(profileSchema.parse(values)).toEqual(values);
    expect(storedProfileSchema.safeParse({ version: 1, values }).success).toBe(
      true,
    );
    expect(
      profileSchema.safeParse({ ...values, ssn: 'SENTINEL' }).success,
    ).toBe(false);
    expect(profileSchema.safeParse({ ...values, firstName: 1 }).success).toBe(
      false,
    );
    expect(
      profileSchema.safeParse({ ...values, firstName: 'x'.repeat(16) }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({ ...values, firstName: '\n' }).success,
    ).toBe(false);
    expect(storedProfileSchema.safeParse({ version: 2, values }).success).toBe(
      false,
    );
  });
});
