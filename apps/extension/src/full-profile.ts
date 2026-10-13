import { z } from 'zod';
import { fieldSpecs, profileSchema } from './profile.js';

export type FullFieldSpec = {
  key: string;
  label: string;
  title: string;
  kind: 'text' | 'tel' | 'password' | 'select' | 'checkbox' | 'radio';
  max: number;
  section: 'business' | 'personal' | 'design';
  options?: string[];
  format?: 'digits' | 'zip' | 'phone' | 'tax' | 'ssn' | 'date' | 'money';
  optional?: boolean;
  combobox?: boolean;
};
const states =
  'AL AK AS AZ AR CA CO CT DC DE FL GA GU HI ID IL IN IA KS KY LA ME MH MD MA MI FM MN MS MO MT NE NV NH NJ NM NY NC ND MP OH OK OR PW PA PR RI SC SD TN TX UT VT VA VI WA WV WI WY AE AP AA'.split(
    ' ',
  );
const originalTitles: Record<string, string> = {
  email: 'メールアドレス',
  legalBusinessName: '正式な事業名',
  businessNameOnCard: 'カードに表示する事業名',
  companyDBAName: 'DBA（屋号）',
  firstName: '名（ローマ字）',
  lastName: '姓（ローマ字）',
  nameOnCard: 'カードに表示する氏名',
};
export const fullFieldSpecs: FullFieldSpec[] = [
  {
    key: 'cardDesign',
    label: 'Card design',
    title: 'カードデザイン',
    kind: 'radio',
    max: 30,
    section: 'design',
    options: ['Classic', 'Mirror'],
    optional: true,
  },
  {
    key: 'cardMaterial',
    label: 'Card material',
    title: 'カード素材',
    kind: 'radio',
    max: 30,
    section: 'design',
    options: ['Metal', '85% Recycled Plastic'],
    optional: true,
  },
  ...fieldSpecs.map(([key, label, max]): FullFieldSpec => ({
    key,
    label,
    max,
    title: originalTitles[key]!,
    kind: 'text',
    section: ['firstName', 'lastName', 'nameOnCard'].includes(key)
      ? 'personal'
      : 'business',
  })),
  {
    key: 'companyStructure',
    label: 'Company Structure',
    title: '事業形態',
    kind: 'select',
    max: 30,
    section: 'business',
    options: ['Corporation', 'Partnership', 'Sole Proprietorship'],
  },
  {
    key: 'doingBusinessAs',
    label: 'Company does not have a DBA',
    title: 'DBA（屋号）はない',
    kind: 'checkbox',
    max: 3,
    section: 'business',
    options: ['yes', 'no'],
  },
  {
    key: 'businessAddressLine1',
    label: 'Business Address Line 1',
    title: '事業住所（番地・通り）',
    kind: 'text',
    max: 40,
    section: 'business',
    combobox: true,
  },
  {
    key: 'businessAddressLine2',
    label: 'Business Address Line 2',
    title: '事業住所（部屋番号など）',
    kind: 'text',
    max: 40,
    section: 'business',
    optional: true,
  },
  {
    key: 'businessZipCode',
    label: 'Zip Code',
    title: '事業住所のZIP（5桁）',
    kind: 'tel',
    max: 5,
    section: 'business',
    format: 'zip',
  },
  {
    key: 'businessCity',
    label: 'City',
    title: '事業住所の市',
    kind: 'text',
    max: 35,
    section: 'business',
  },
  {
    key: 'businessState',
    label: 'State',
    title: '事業住所の州',
    kind: 'select',
    max: 2,
    section: 'business',
    options: states,
  },
  {
    key: 'businessPhoneNumber',
    label: 'Business Phone Number',
    title: '事業の電話番号（米国10桁）',
    kind: 'tel',
    max: 20,
    section: 'business',
    format: 'phone',
  },
  {
    key: 'industryType',
    label: 'Industry Type',
    title: '業種',
    kind: 'select',
    max: 30,
    section: 'business',
    options: [
      'Agriculture',
      'Construction',
      'Finance/Real Estate',
      'Government Entity',
      'Insurance Services',
      'Manufacturing',
      'Non-profit',
      'Retail Trade',
      'Wholesale Trade',
      'Other',
    ],
  },
  {
    key: 'yearsInBusiness',
    label: 'Years in Business',
    title: '営業年数',
    kind: 'select',
    max: 30,
    section: 'business',
    options: [
      'Less than one year',
      '1-2 years',
      '3-5 years',
      '6-10 years',
      '11-15 years',
      '16-20 years',
      'More than 20 years',
    ],
  },
  {
    key: 'numberOfEmployees',
    label: 'Number of Employees',
    title: '従業員数',
    kind: 'tel',
    max: 3,
    section: 'business',
    format: 'digits',
  },
  {
    key: 'annualBusinessRevenue',
    label: 'Gross Annual Business Revenue',
    title: '年間事業売上（USD）',
    kind: 'text',
    max: 11,
    section: 'business',
    format: 'money',
  },
  {
    key: 'estimatedMonthlySpend',
    label: 'Estimated Monthly Spend',
    title: '月間利用見込額（USD・任意）',
    kind: 'text',
    max: 11,
    section: 'business',
    format: 'money',
    optional: true,
  },
  {
    key: 'federalTaxId',
    label: 'Federal Tax ID',
    title: '事業のFederal Tax ID（個人事業主では不要）',
    kind: 'password',
    max: 11,
    section: 'business',
    format: 'tax',
  },
  {
    key: 'roleInCompany',
    label: 'Role in Company',
    title: '会社での役職',
    kind: 'select',
    max: 30,
    section: 'business',
    options: [
      'General Manager',
      'Owner',
      'Partner',
      'President/Chairman',
      'Treasurer',
      'VP',
      'Other Authorizing Officer',
    ],
  },
  {
    key: 'middleName',
    label: 'M.I.',
    title: 'ミドルイニシャル（任意）',
    kind: 'text',
    max: 1,
    section: 'personal',
    optional: true,
  },
  {
    key: 'sameAddress',
    label: 'My home address is the same as my business address',
    title: '自宅住所は事業住所と同じ',
    kind: 'checkbox',
    max: 3,
    section: 'personal',
    options: ['yes', 'no'],
  },
  {
    key: 'addressLine1',
    label: 'Home Address Line 1',
    title: '自宅住所（番地・通り）',
    kind: 'text',
    max: 40,
    section: 'personal',
    combobox: true,
  },
  {
    key: 'addressLine2',
    label: 'Home Address Line 2',
    title: '自宅住所（部屋番号など）',
    kind: 'text',
    max: 40,
    section: 'personal',
    optional: true,
  },
  {
    key: 'zipCode',
    label: 'Zip Code',
    title: '自宅住所のZIP（5桁）',
    kind: 'tel',
    max: 5,
    section: 'personal',
    format: 'zip',
  },
  {
    key: 'city',
    label: 'City',
    title: '自宅住所の市',
    kind: 'text',
    max: 35,
    section: 'personal',
  },
  {
    key: 'state',
    label: 'State',
    title: '自宅住所の州',
    kind: 'select',
    max: 2,
    section: 'personal',
    options: states,
  },
  {
    key: 'cellPhone',
    label: 'Cell Phone Number',
    title: '携帯電話番号（米国10桁）',
    kind: 'tel',
    max: 20,
    section: 'personal',
    format: 'phone',
  },
  {
    key: 'ssn',
    label: 'Social Security Number',
    title: 'SSN（9桁）',
    kind: 'password',
    max: 11,
    section: 'personal',
    format: 'ssn',
  },
  {
    key: 'dateOfBirth',
    label: 'Date Of Birth (MM-DD-YYYY)',
    title: '生年月日（MM-DD-YYYY）',
    kind: 'text',
    max: 10,
    section: 'personal',
    format: 'date',
  },
  {
    key: 'totalAnnualIncome',
    label: 'Total Annual Income',
    title: '年間総収入（USD）',
    kind: 'text',
    max: 10,
    section: 'personal',
    format: 'money',
  },
  {
    key: 'nonTaxableAnnualIncome',
    label: 'Non-taxable Annual Income',
    title: '年間非課税収入（USD・任意）',
    kind: 'text',
    max: 10,
    section: 'personal',
    format: 'money',
    optional: true,
  },
];
const extraShape: Record<string, z.ZodType<string>> = {};
for (const spec of fullFieldSpecs) {
  if (fieldSpecs.some(([key]) => key === spec.key)) continue;
  extraShape[spec.key] = z
    .string()
    .max(spec.max)
    .refine(
      (v) =>
        !Array.from(v).some(
          (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
        ),
    )
    .refine((v) => !v || !spec.options || spec.options.includes(v))
    .optional()
    .default('');
}
export const fullProfileSchema = profileSchema.extend(extraShape).strict();
export type FullProfile = Record<string, string>;

export function profileIssues(
  values: FullProfile,
): { field: string; reason: 'required' | 'format' | 'inconsistent' }[] {
  const issues: ReturnType<typeof profileIssues> = [];
  for (const s of fullFieldSpecs) {
    const value = values[s.key] ?? '';
    const inactive =
      (s.key === 'companyDBAName' && values.doingBusinessAs === 'yes') ||
      (s.key === 'federalTaxId' &&
        values.companyStructure === 'Sole Proprietorship') ||
      (['addressLine1', 'addressLine2', 'zipCode', 'city', 'state'].includes(
        s.key,
      ) &&
        values.sameAddress === 'yes');
    if (inactive) continue;
    if (!value) {
      if (!s.optional) issues.push({ field: s.key, reason: 'required' });
      continue;
    }
    let valid = !!value.trim();
    const digits = value.replace(/[ ()-]/g, '');
    if (s.format === 'digits') valid = /^\d{1,3}$/.test(value);
    if (s.format === 'zip') valid = /^\d{5}$/.test(value);
    if (s.format === 'phone') valid = /^\d{10}$/.test(digits);
    if (s.format === 'tax' || s.format === 'ssn')
      valid = /^\d{9}$/.test(digits);
    if (s.format === 'money') valid = /^\d+(?:\.\d{1,2})?$/.test(value);
    if (s.format === 'date') {
      const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
      if (!match) valid = false;
      else {
        const [, m, d, y] = match;
        const date = new Date(Number(y), Number(m) - 1, Number(d));
        valid =
          date.getFullYear() === Number(y) &&
          date.getMonth() === Number(m) - 1 &&
          date.getDate() === Number(d) &&
          date.getTime() < Date.now();
      }
    }
    if (!valid) issues.push({ field: s.key, reason: 'format' });
  }
  if (
    values.companyStructure === 'Sole Proprietorship' &&
    ['Government Entity', 'Insurance Services', 'Non-profit'].includes(
      values.industryType ?? '',
    )
  )
    issues.push({ field: 'industryType', reason: 'inconsistent' });
  return issues;
}
