import { describe, expect, it } from 'vitest';
import { classifyTarget } from '../apps/extension/src/target.js';

const path =
  '/en-us/credit-cards/apply/business/business-platinum-charge-card/68443-9-0';
describe('extension destination boundary', () => {
  it.each([path, `${path}/`, `${path}?source=public#form`])(
    'allows the reviewed application route %s',
    (route) => {
      expect(classifyTarget(`https://www.americanexpress.com${route}`)).toBe(
        'amex',
      );
    },
  );
  it.each([
    undefined,
    'not a URL',
    `http://www.americanexpress.com${path}`,
    `https://www.americanexpress.com.evil.example${path}`,
    `https://americanexpress.com${path}`,
    `https://www.americanexpress.com:444${path}`,
    `https://user:secret@www.americanexpress.com${path}`,
    `https://www.americanexpress.com${path}/extra`,
    `https://www.americanexpress.com${path.replace('business-platinum-charge-card', 'other-card')}`,
    'https://www.americanexpress.com/',
    'http://127.0.0.1:4173/autofill-fixture?x=1',
    'http://127.0.0.1:4173/autofill-fixture#form',
    'http://localhost:4173/autofill-fixture',
  ])('rejects other destinations', (url) => {
    expect(classifyTarget(url)).toBeUndefined();
  });
  it('keeps the fixture isolated', () => {
    expect(classifyTarget('http://127.0.0.1:4173/autofill-fixture')).toBe(
      'fixture',
    );
  });
});
