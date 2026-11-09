import { describe, expect, it } from 'vitest';
import { assetDeepLink, generateAssetTag, normalizeEmail, normalizeName } from './crm-utils.js';

describe('normalizeName (çift kayıt anahtarı)', () => {
  it('Türkçe karakterleri İ-ı ayrımı doğru olacak şekilde büyütür', () => {
    expect(normalizeName('İstanbul')).toBe('ISTANBUL');
    expect(normalizeName('ışık')).toBe('ISIK');
    expect(normalizeName('Çağrı')).toBe('CAGRI');
  });

  it('çoklu boşlukları sıkıştırır ve kenarları kırpar', () => {
    expect(normalizeName('  Atlas   Teknik ')).toBe('ATLAS TEKNIK');
  });

  it('aynı kelime farklı yazım (i/İ) aynı anahtarı üretir', () => {
    expect(normalizeName('Işık Ltd')).toBe(normalizeName('ışık ltd'));
    expect(normalizeName('ŞİRKET A.Ş.')).toBe(normalizeName('şirket a.ş.'));
  });

  it('boş girdi boş anahtar üretir', () => {
    expect(normalizeName('   ')).toBe('');
  });
});

describe('normalizeEmail', () => {
  it('trim + küçük harf', () => {
    expect(normalizeEmail('  Ali@Firma.TEST ')).toBe('ali@firma.test');
  });
});

describe('generateAssetTag', () => {
  it('AST-XXXXXX biçimindedir ve karışabilir karakter içermez', () => {
    for (let i = 0; i < 20; i += 1) {
      const tag = generateAssetTag();
      expect(tag).toMatch(/^AST-[A-HJ-NP-Z2-9]{6}$/);
      expect(tag).not.toMatch(/[O0Il1]/);
    }
  });

  it('iki üretim farklıdır (rastgelelik)', () => {
    const tags = new Set(Array.from({ length: 50 }, () => generateAssetTag()));
    expect(tags.size).toBe(50);
  });
});

describe('assetDeepLink (QR içerik)', () => {
  it('taban URL sonundaki eğikleri kırpıp bağlantı üretir', () => {
    expect(assetDeepLink('http://localhost:3000/', 'AST-ABC123')).toBe(
      'http://localhost:3000/a/AST-ABC123',
    );
    expect(assetDeepLink('https://app.teknikflow.test', 'AST-1')).toBe(
      'https://app.teknikflow.test/a/AST-1',
    );
  });

  it('etiketteki özel karakterler yüzde-kodlanır', () => {
    expect(assetDeepLink('http://x.test', 'AST A/B')).toBe('http://x.test/a/AST%20A%2FB');
  });
});
