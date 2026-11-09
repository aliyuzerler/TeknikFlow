import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id parola özeti (ADR-0002 / SECURITY_PRIVACY.md).
 *
 * Parametreler OWASP 2024 önerilerine göre: m=19 MiB, t=2, p=1
 * (19456 KiB). Özet asla loglanmaz ve API yanıtlarına girmez.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hashPassword(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}
