/** Independent synthetic release contract. Do not derive expected DOM values or
 * labels from production field specs: distinct markers detect cross-field swaps. */
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { FullProfile } from '../apps/extension/src/full-profile.js';

type Kind = 'text' | 'tel' | 'password' | 'select' | 'checkbox' | 'radio';
type Field = [
  key: string,
  kind: Kind,
  label: string,
  input: string,
  dom?: string,
];
export const releaseFields: Field[] = [
  ['cardDesign', 'radio', 'Mirror', 'Mirror', '1'],
  [
    'cardMaterial',
    'radio',
    '85% Recycled Plastic',
    '85% Recycled Plastic',
    '1',
  ],
  ['email', 'text', 'Email Address', 'synthetic@example.invalid'],
  ['legalBusinessName', 'text', 'Legal Business Name', 'LEGAL-SENTINEL'],
  ['businessNameOnCard', 'text', 'Business Name on Card', 'BUSINESS-SENTINEL'],
  ['companyDBAName', 'text', 'Company DBA Name', 'DBA-SENTINEL'],
  ['firstName', 'text', 'First Name', 'FIRST-SENTINEL'],
  ['lastName', 'text', 'Last Name', 'LAST-SENTINEL'],
  ['nameOnCard', 'text', 'Name on Card', 'NAME-SENTINEL'],
  ['companyStructure', 'select', 'Company Structure', 'Corporation', '1'],
  ['doingBusinessAs', 'checkbox', 'Company does not have a DBA', 'no'],
  [
    'businessAddressLine1',
    'text',
    'Business Address Line 1',
    'BUSINESS-STREET-SENTINEL',
  ],
  [
    'businessAddressLine2',
    'text',
    'Business Address Line 2',
    'BUSINESS-UNIT-SENTINEL',
  ],
  ['businessZipCode', 'tel', 'Zip Code', '00000'],
  ['businessCity', 'text', 'City', 'BUSINESS-CITY-SENTINEL'],
  ['businessState', 'select', 'State', 'AL'],
  [
    'businessPhoneNumber',
    'tel',
    'Business Phone Number',
    '0000000000',
    '(000) 000-0000',
  ],
  ['industryType', 'select', 'Industry Type', 'Construction', '2'],
  ['yearsInBusiness', 'select', 'Years in Business', '3-5 years', '3'],
  ['numberOfEmployees', 'tel', 'Number of Employees', '17'],
  ['annualBusinessRevenue', 'text', 'Gross Annual Business Revenue', '1234.56'],
  ['estimatedMonthlySpend', 'text', 'Estimated Monthly Spend', '234.56'],
  ['federalTaxId', 'password', 'Federal Tax ID', '000000001'],
  ['roleInCompany', 'select', 'Role in Company', 'Owner', '2'],
  ['middleName', 'text', 'M.I.', 'X'],
  [
    'sameAddress',
    'checkbox',
    'My home address is the same as my business address',
    'no',
  ],
  ['addressLine1', 'text', 'Home Address Line 1', 'HOME-STREET-SENTINEL'],
  ['addressLine2', 'text', 'Home Address Line 2', 'HOME-UNIT-SENTINEL'],
  ['zipCode', 'tel', 'Zip Code', '00001'],
  ['city', 'text', 'City', 'HOME-CITY-SENTINEL'],
  ['state', 'select', 'State', 'AK'],
  ['cellPhone', 'tel', 'Cell Phone Number', '0000000001', '(000) 000-0001'],
  ['ssn', 'password', 'Social Security Number', '000000000', '000-00-0000'],
  ['dateOfBirth', 'text', 'Date Of Birth (MM-DD-YYYY)', '01-01-1000'],
  ['totalAnnualIncome', 'text', 'Total Annual Income', '3456.78'],
  ['nonTaxableAnnualIncome', 'text', 'Non-taxable Annual Income', '45.67'],
];
export const releaseProfile: FullProfile = Object.fromEntries(
  releaseFields.map(([key, , , value]) => [key, value]),
);
export const conditionalReleaseKeys = [
  'companyDBAName',
  'federalTaxId',
  'addressLine1',
  'addressLine2',
  'zipCode',
  'city',
  'state',
];

export async function assertReleaseFields(
  target: Page,
  popup: Page,
  pass: 'first' | 'repeat' | 'conditional' = 'first',
) {
  assert.equal(releaseFields.length, 36);
  const actual = await target.evaluate(
    (fields) =>
      fields.map(([key, kind]) => {
        const id = kind === 'radio' ? `${key}-1` : key;
        const name =
          kind === 'radio'
            ? key === 'cardDesign'
              ? 'color-fixture'
              : 'material-fixture'
            : key;
        const controls = document.querySelectorAll<
          HTMLInputElement | HTMLSelectElement
        >(`#${id}`);
        const named = [
          ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            `[name="${name}"]`,
          ),
        ];
        const el = controls[0];
        return {
          key,
          ids: controls.length,
          names: named.length,
          identity: !!el && named.includes(el),
          type: el?.type,
          labels: [...(el?.labels ?? [])].map((label) =>
            label.textContent!.trim().replace(/\s*\*$/, ''),
          ),
          value: kind === 'checkbox' ? null : el?.value,
          checked:
            kind === 'checkbox' || kind === 'radio'
              ? (el as HTMLInputElement)?.checked
              : null,
          selectedCount:
            kind === 'radio'
              ? named.filter((n) => (n as HTMLInputElement).checked).length
              : null,
          option:
            kind === 'select'
              ? (el as HTMLSelectElement)?.selectedOptions[0]?.textContent
              : null,
          disabled: el?.disabled,
          hidden: el?.hidden,
        };
      }),
    releaseFields,
  );
  for (const [key, kind, label, input, dom] of releaseFields) {
    const conditional =
      pass === 'conditional' && conditionalReleaseKeys.includes(key);
    const changedBranch =
      pass === 'conditional' &&
      ['companyStructure', 'doingBusinessAs', 'sameAddress'].includes(key);
    assert.deepEqual(
      actual.find((field) => field.key === key),
      {
        key,
        ids: 1,
        names: kind === 'radio' ? 2 : 1,
        identity: true,
        type: kind === 'select' ? 'select-one' : kind,
        labels: [
          'businessZipCode',
          'zipCode',
          'businessPhoneNumber',
          'cellPhone',
        ].includes(key)
          ? [label, '']
          : [label],
        value:
          kind === 'checkbox'
            ? null
            : conditional
              ? ''
              : changedBranch
                ? '3'
                : (dom ?? input),
        checked:
          kind === 'radio' ? true : kind === 'checkbox' ? changedBranch : null,
        selectedCount: kind === 'radio' ? 1 : null,
        option:
          kind === 'select'
            ? conditional
              ? 'Choose one'
              : changedBranch
                ? 'Sole Proprietorship'
                : input
            : null,
        disabled: conditional && key !== 'federalTaxId',
        hidden: conditional && key === 'federalTaxId',
      },
      `FIELD_DOM:${key}`,
    );
  }
  const run = await popup.evaluate(async () => {
    const reply = await chrome.runtime.sendMessage({
      channel: 'autofill-v1',
      op: 'view',
    });
    return reply.view?.run;
  });
  assert.equal(run?.phase, 'completed');
  assert.deepEqual(
    [...run.fields].sort((a, b) => a.field.localeCompare(b.field)),
    releaseFields
      .map(([field, kind]) => ({
        field,
        status:
          pass === 'conditional' && conditionalReleaseKeys.includes(field)
            ? ['addressLine1', 'zipCode', 'city', 'state'].includes(field)
              ? 'address-review'
              : 'conditional'
            : pass === 'conditional' &&
                ['companyStructure', 'doingBusinessAs', 'sameAddress'].includes(
                  field,
                )
              ? 'existing-value'
              : pass !== 'first' || kind === 'checkbox'
                ? 'matched'
                : 'filled',
      }))
      .sort((a, b) => a.field.localeCompare(b.field)),
    'FIELD_RESULTS',
  );
  assert.equal(await popup.locator('#results li').count(), 36);
}
