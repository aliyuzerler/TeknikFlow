import { z } from 'zod';

/** GET /health/live yanıtı — süreç ayakta mı? Bağımlılıklara bakmaz. */
export const HealthLiveResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});

/** Tek bir bağımlılık kontrolünün sonucu. */
export const ServiceCheckResultSchema = z.object({
  state: z.enum(['ok', 'fail']),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().max(200).optional(),
});

/** GET /health/ready yanıtı — bağımlılıklar (DB, Redis, obje deposu) hazır mı? */
export const HealthReadyResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: ServiceCheckResultSchema,
    redis: ServiceCheckResultSchema,
    objectStorage: ServiceCheckResultSchema,
  }),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;
export type ServiceCheckResult = z.infer<typeof ServiceCheckResultSchema>;
