/** Tek bir altyapı servisi sağlık kontrolünün sonucu. */
export interface ServiceCheckResult {
  /** 'ok' → kontrol başarılı; 'fail' → başarısız. */
  readonly state: 'ok' | 'fail';
  /** Yanıt gecikmesi (ms). Başarısızlıkta opsiyonel. */
  readonly latencyMs?: number;
  /** Başarısızlıkta güvenli (sır içermeyen) hata özeti. */
  readonly error?: string;
}

/**
 * Tüm kontrollerin kümesinden toplam readiness durumu hesaplar.
 * Tümü 'ok' ise 'ok'; herhangi biri 'fail' ise 'degraded'.
 */
export function computeReadiness(checks: Readonly<Record<string, ServiceCheckResult>>): {
  status: 'ok' | 'degraded';
  failing: string[];
} {
  const failing = Object.entries(checks)
    .filter(([, check]) => check.state === 'fail')
    .map(([name]) => name);
  return { status: failing.length === 0 ? 'ok' : 'degraded', failing };
}
