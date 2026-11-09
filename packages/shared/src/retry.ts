export interface RetryOptions {
  /** Toplam deneme sayısı (ilk deneme dahil). */
  retries: number;
  /** İlk bekleme süresi (ms). Her denemede 2x büyür. */
  baseMs: number;
  /** Tek bir denemeye verilecek üst sınır (ms). */
  maxWaitMs?: number;
  /** Rastgelelik deterministik test için enjekte edilebilir. */
  jitter?: () => number;
}

const defaultJitter = () => Math.random();

/**
 * Exponential backoff ile yeniden dener. Fn her denemede `attempt` sayısını alır.
 * Tüm denemeler tükenirse son hatayı fırlatır.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { retries, baseMs, maxWaitMs = Number.POSITIVE_INFINITY, jitter = defaultJitter } = options;
  if (retries < 1) {
    throw new Error('retries >= 1 olmalı');
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      const exponential = baseMs * 2 ** (attempt - 1);
      const capped = Math.min(exponential, maxWaitMs);
      const waitMs = Math.floor(capped * (0.5 + 0.5 * jitter()));
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
