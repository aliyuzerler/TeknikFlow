/**
 * Kalp atışı tazeliği kuralları — saf fonksiyonlar (test edilebilir).
 */

/** Kalp atışı kaydının hâlâ taze sayılıp sayılmadığını söyler. */
export function isHeartbeatFresh(
  lastHeartbeatIso: string | undefined,
  now: number = Date.now(),
  maxAgeMs: number,
): boolean {
  if (!lastHeartbeatIso) {
    return false;
  }
  const timestamp = Date.parse(lastHeartbeatIso);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return now - timestamp <= maxAgeMs;
}

/** Kalp atışının yaşını saniye cinsinden verir. */
export function heartbeatAgeSeconds(
  lastHeartbeatIso: string | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!lastHeartbeatIso) {
    return undefined;
  }
  const timestamp = Date.parse(lastHeartbeatIso);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return Math.max(0, Math.round((now - timestamp) / 1000));
}

/** Sağlık uç noktası gövdesi. */
export interface WorkerHealthBody {
  status: 'ok' | 'degraded';
  lastHeartbeat?: string;
  ageSeconds?: number;
}

/** Kalp atışı verisinden sağlık gövdesi türetir. */
export function buildHealthBody(
  lastHeartbeatIso: string | undefined,
  now: number = Date.now(),
  maxAgeMs: number,
): WorkerHealthBody {
  const fresh = isHeartbeatFresh(lastHeartbeatIso, now, maxAgeMs);
  const ageSeconds = heartbeatAgeSeconds(lastHeartbeatIso, now);
  return {
    status: fresh ? 'ok' : 'degraded',
    ...(lastHeartbeatIso ? { lastHeartbeat: lastHeartbeatIso } : {}),
    ...(ageSeconds !== undefined ? { ageSeconds } : {}),
  };
}
