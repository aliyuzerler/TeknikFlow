import { describe, expect, it } from 'vitest';
import { hash, verify } from '@node-rs/argon2';
import { PasswordService } from './password.service.js';

// Argon2id parametreleri OWASP 2024 (m=19MiB, t=2, p=1) — yavaşlık kabulüdür;
// test süresini korumak için tek bir gerçek hash/verify çifti kullanılır.
const service = new PasswordService();

describe('PasswordService (Argon2id)', () => {
  it('özet $argon2id$ önekiyle üretilir ve doğrulanır', async () => {
    const digest = await service.hashPassword('Saha!Servis2026');
    expect(digest.startsWith('$argon2id$')).toBe(true);
    await expect(service.verifyPassword(digest, 'Saha!Servis2026')).resolves.toBe(true);
  });

  it('yanlış parola doğrulanmaz', async () => {
    const digest = await service.hashPassword('Saha!Servis2026');
    await expect(service.verifyPassword(digest, 'Saha!Servis2027')).resolves.toBe(false);
  });

  it('aynı parola farklı özet üretir (salt)', async () => {
    const a = await hash('Ayni!Parola123');
    const b = await hash('Ayni!Parola123');
    expect(a).not.toBe(b);
    await expect(verify(a, 'Ayni!Parola123')).resolves.toBe(true);
    await expect(verify(b, 'Ayni!Parola123')).resolves.toBe(true);
  });
});
