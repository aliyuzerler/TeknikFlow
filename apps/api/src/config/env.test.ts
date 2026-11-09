import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const validRaw = {
  DATABASE_URL: 'postgresql://teknikflow:pw@localhost:5432/teknikflow',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'teknikflow-private',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
};

describe('parseEnv', () => {
  it('geçerli girdi + varsayılanlar uygulanır', () => {
    const env = parseEnv(validRaw);
    expect(env.PORT).toBe(4000);
    expect(env.S3_REGION).toBe('us-east-1');
    expect(env.NODE_ENV).toBe('development');
  });

  it('zorunlu değişken eksikse toplu hata fırlatır', () => {
    expect(() => parseEnv({})).toThrowError(/Geçersiz ortam değişkenleri/);
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('PORT sayıya çevrilir, geçersizse reddedilir', () => {
    expect(parseEnv({ ...validRaw, PORT: '4100' }).PORT).toBe(4100);
    expect(() => parseEnv({ ...validRaw, PORT: 'abc' })).toThrowError(/PORT/);
    expect(() => parseEnv({ ...validRaw, PORT: '-1' })).toThrowError(/PORT/);
  });

  it('bilinmeyen NODE_ENV reddedilir', () => {
    expect(() => parseEnv({ ...validRaw, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
  });
});
