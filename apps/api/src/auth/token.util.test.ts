import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, sha256 } from './token.service.js';

describe('opak token yardımcıları', () => {
  it('token 43 karakter base64url ve benzersizdir', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).not.toBe(a);
  });

  it('sha256 deterministik ve 64 hex karakterdir', () => {
    expect(sha256('test')).toBe(sha256('test'));
    expect(sha256('test')).not.toBe(sha256('tset'));
    expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
