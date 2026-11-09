import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff } from './retry.js';

describe('retryWithBackoff', () => {
  it('ilk denemede başarılıysa tekrar denemez', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await retryWithBackoff(fn, { retries: 3, baseMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('geçici hata sonrası başarılı olursa sonucu döner', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        throw new Error('geçici');
      }
      return 'ok';
    });
    const result = await retryWithBackoff(fn, { retries: 3, baseMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('tüm denemeler tükenirse son hatayı fırlatır', async () => {
    const fn = vi.fn(async () => {
      throw new Error('kalıcı');
    });
    await expect(retryWithBackoff(fn, { retries: 2, baseMs: 1 })).rejects.toThrow('kalıcı');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries < 1 → hatayı erken verir', async () => {
    await expect(retryWithBackoff(async () => 1, { retries: 0, baseMs: 1 })).rejects.toThrow(
      'retries >= 1',
    );
  });

  it('backoff üst sınırına uyar (maxWaitMs)', async () => {
    const waits: number[] = [];
    // Bekleme sürelerini kaydedip beklemeden çöz: üst sınır matematiğini izole test et.
    // Not: setTimeout imzası (callback, delay, ...args) sırasındadır.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback?: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      callback?.();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    const fn = vi.fn(async () => {
      throw new Error('x');
    });
    const promise = retryWithBackoff(fn, {
      retries: 4,
      baseMs: 100,
      maxWaitMs: 250,
      jitter: () => 1,
    });
    await expect(promise).rejects.toThrow('x');
    // jitter=1 → waitMs = capped: 100, 200, 250 (capped); son denemeden sonra bekleme yok
    expect(waits).toEqual([100, 200, 250]);
    vi.restoreAllMocks();
  });
});
