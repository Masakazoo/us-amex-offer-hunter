import {
  fullFieldSpecs,
  type FullProfile,
} from '../apps/extension/src/full-profile.js';

/** Intentionally meaningless markers, invalid US zero-number identifiers, ancient date. No real/fabricated person. */
export function fullSentinelProfile(): FullProfile {
  const data: FullProfile = {};
  for (const s of fullFieldSpecs) {
    data[s.key] =
      s.options?.[0] ??
      (s.format === 'zip'
        ? '00000'
        : s.format === 'phone'
          ? '0000000000'
          : s.format === 'tax' || s.format === 'ssn'
            ? '000000000'
            : s.format === 'money' || s.format === 'digits'
              ? '0'
              : s.format === 'date'
                ? '01-01-1000'
                : s.key === 'middleName'
                  ? 'X'
                  : 'SENTINEL');
  }
  data.companyStructure = 'Sole Proprietorship';
  data.doingBusinessAs = 'yes';
  data.sameAddress = 'yes';
  data.companyDBAName = '';
  return data;
}
