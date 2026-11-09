import { z } from 'zod';

/**
 * Tüm API hataları için tutarlı zarf. API_CONVENTIONS.md gereği:
 * kod + güvenli mesaj + istek kimliği; yığın izi sızdırılmaz.
 */
export const ApiErrorEnvelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
  statusCode: z.number().int().min(400).max(599),
  fieldErrors: z
    .array(
      z.object({
        field: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .optional(),
});

export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
