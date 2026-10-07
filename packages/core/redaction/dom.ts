import { z } from 'zod';
import { fieldLabels, identifyField, safeAttribute } from '../amex/fields.js';
const attributes = [
  'name',
  'id',
  'autocomplete',
  'aria-label',
  'label',
  'placeholder',
] as const;
export const fieldSchema = z
  .object({
    field: z.string().regex(/^field-[1-9]\d*$/),
    frame: z.number().int().nonnegative(),
    semantic: z.enum([...fieldLabels, 'unknown', 'ambiguous']),
    element: z.enum(['input', 'select', 'textarea', 'other']),
    type: z.enum([
      'text',
      'email',
      'tel',
      'number',
      'date',
      'password',
      'checkbox',
      'radio',
      'other',
    ]),
    required: z.boolean(),
    disabled: z.boolean(),
    attributes: z.array(
      z
        .object({
          attribute: z.enum(attributes),
          present: z.boolean(),
          approvedLiteral: z.enum(fieldLabels).optional(),
        })
        .strict(),
    ),
    validation: z
      .object({
        patternPresent: z.boolean(),
        maxLengthPresent: z.boolean(),
        invalid: z.boolean(),
      })
      .strict(),
    networkSafety: z.enum(['unknown', 'requires-real-user-data']),
  })
  .strict();
export type SafeField = z.infer<typeof fieldSchema>;
export function sanitizeField(
  raw: Record<string, unknown>,
  field: string,
  frame: number,
): SafeField {
  const element = fieldSchema.shape.element.safeParse(raw.element);
  const type = fieldSchema.shape.type.safeParse(raw.type);
  return fieldSchema.parse({
    field,
    frame,
    semantic: identifyField(attributes.map((key) => raw[key])),
    element: element.success ? element.data : 'other',
    type: type.success ? type.data : 'other',
    required: raw.required === true,
    disabled: raw.disabled === true,
    attributes: attributes.map((attribute) => ({
      attribute,
      present: typeof raw[attribute] === 'string' && raw[attribute] !== '',
      ...(safeAttribute(raw[attribute])
        ? { approvedLiteral: safeAttribute(raw[attribute]) }
        : {}),
    })),
    validation: {
      patternPresent: raw.patternPresent === true,
      maxLengthPresent: raw.maxLengthPresent === true,
      invalid: raw.invalid === true,
    },
    networkSafety: 'unknown',
  });
}
