/** Retained legacy fixture schema; never included in the normal extension. */
import { z } from 'zod';
import { profileSchema } from './profile-fields.js';
export { fieldSpecs, profileSchema } from './profile-fields.js';
export const storedProfileSchema = z
  .object({ version: z.literal(1), values: profileSchema })
  .strict();
export const profileKey = 'autofillProfileV1';
