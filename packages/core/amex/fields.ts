// Candidate vocabulary supplied by the project brief; NOT verified Amex selectors.
export const fieldLabels = [
  'Email Address',
  'Legal Business Name',
  'DBA Name',
  'No DBA',
  'Business Name on Card',
  'Business Address Line 1',
  'Business Address Line 2',
  'ZIP Code',
  'Business Phone',
  'Industry Type',
  'Company Structure',
  'Years in Business',
  'Number of Employees',
  'Gross Annual Business Revenue',
  'Estimated Monthly Spend',
  'Federal Tax ID',
  'Role in Company',
  'First Name',
  'Middle Initial',
  'Last Name',
  'Name on Card',
  'Home address same as business',
  'Home Address',
  'ZIP',
  'Home Phone',
  'Cell Phone',
  'SSN',
  'Date of Birth',
  'Total Annual Income',
  'Non-Taxable Annual Income',
  'Send Bill To',
] as const;
export type FieldLabel = (typeof fieldLabels)[number];
const compact = (value: string) => value.toLowerCase().replace(/[\s_-]/g, '');
export function identifyField(
  signals: unknown[],
): FieldLabel | 'unknown' | 'ambiguous' {
  const matches = new Set(
    fieldLabels.filter((label) =>
      signals.some(
        (s) => typeof s === 'string' && compact(s) === compact(label),
      ),
    ),
  );
  return matches.size === 1
    ? [...matches][0]!
    : matches.size > 1
      ? 'ambiguous'
      : 'unknown';
}
/** Export only exact approved vocabulary. Presence is recorded separately for other strings. */
export function safeAttribute(value: unknown): FieldLabel | undefined {
  return fieldLabels.find((label) => label === value);
}
