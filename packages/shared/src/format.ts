/** Gecikmeyi kullanıcıya gösterilecek metne çevirir. */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(1)} sn`;
}

/** ISO zamandan bugüne geçen süreyi Türkçe kısa biçimde verir. */
export function formatAge(isoTimestamp: string, now: Date = new Date()): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) {
    return '—';
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) {
    return `${seconds} sn önce`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  return `${Math.floor(hours / 24)} gün önce`;
}
