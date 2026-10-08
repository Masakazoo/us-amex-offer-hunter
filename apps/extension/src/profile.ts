import { z } from 'zod';

export const fieldSpecs = [
  ['email', 'Email Address', 50],
  ['legalBusinessName', 'Legal Business Name', 90],
  ['businessNameOnCard', 'Business Name on Card', 20],
  ['companyDBAName', 'Company DBA Name', 90],
  ['firstName', 'First Name', 15],
  ['lastName', 'Last Name', 20],
  ['nameOnCard', 'Name on Card', 20],
] as const;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (v) =>
        !Array.from(v).some(
          (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
        ),
    );
export const profileSchema = z
  .object({
    email: text(50),
    legalBusinessName: text(90),
    businessNameOnCard: text(20),
    companyDBAName: text(90),
    firstName: text(15),
    lastName: text(20),
    nameOnCard: text(20),
  })
  .strict();
export const storedProfileSchema = z
  .object({ version: z.literal(1), values: profileSchema })
  .strict();
export const profileKey = 'autofillProfileV1';
