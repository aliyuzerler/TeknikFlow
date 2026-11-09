import { describe, expect, it } from 'vitest';
import { parseCustomersCsv } from './csv-import.js';

describe('parseCustomersCsv', () => {
  const HEADER = 'name,customerType,taxId,contactName,contactEmail,contactPhone';

  it('geçerli satırları ayrıştırır (türkçe, iletişimli)', () => {
    const result = parseCustomersCsv(
      `${HEADER}\nAtlas Teknik,COMPANY,1234567890,Ali Yılmaz,ali@atlas.test,+905550001122\nBireysel Müşteri,INDIVIDUAL,,,ahmet@b.test,`,
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      row: 2,
      name: 'Atlas Teknik',
      customerType: 'COMPANY',
      taxId: '1234567890',
      contactName: 'Ali Yılmaz',
      contactEmail: 'ali@atlas.test',
      contactPhone: '+905550001122',
    });
    expect(result.rows[1]?.customerType).toBe('INDIVIDUAL');
    expect(result.rows[1]?.contactEmail).toBe('ahmet@b.test');
  });

  it('türkçe takma adları kabul eder (FIRMA/BIREYSEL)', () => {
    const result = parseCustomersCsv('name,customerType\nX Firması,FIRMA\nY Kişi,BIREYSEL');
    expect(result.rows[0]?.customerType).toBe('COMPANY');
    expect(result.rows[1]?.customerType).toBe('INDIVIDUAL');
  });

  it('başlık sırası serbest ve bilinmeyen sütun reddedilir', () => {
    expect(parseCustomersCsv('name,email\nA,a@b.test').error).toContain('Bilinmeyen sütun');
    const reordered = parseCustomersCsv('contactEmail,name\nali@atlas.test,Atlas');
    expect(reordered.rows[0]?.name).toBe('Atlas');
    expect(reordered.rows[0]?.contactEmail).toBe('ali@atlas.test');
  });

  it('zorunlu sütun eksikse tüm içe aktarma reddedilir', () => {
    expect(parseCustomersCsv('taxId,email\n123,a@b.test').error).toContain(
      'Eksik zorunlu sütun: name',
    );
    expect(parseCustomersCsv('').error).toBeDefined();
  });

  it('tırnak içindeki virgüller ve "" kaçışı desteklenir', () => {
    const result = parseCustomersCsv(
      `${HEADER}\n"Atlas, Teknik A.Ş.",COMPANY,,,,\n"Sayılı ""Kilit"" Ltd",COMPANY,,,,`,
    );
    expect(result.rows[0]?.name).toBe('Atlas, Teknik A.Ş.');
    expect(result.rows[1]?.name).toBe('Sayılı "Kilit" Ltd');
  });

  it('dosya içi tekrarlar duplicate işaretlenir (normalize duyarlı)', () => {
    const result = parseCustomersCsv(
      `${HEADER}\nAtlas Teknik,,,,,\natlas teknik,,,,,\nATLAS  TEKNIK,,,,,`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.status === 'duplicate')).toBe(true);
  });

  it('satır bazlı doğrulama hataları toplanır (ad, taxId, e-posta)', () => {
    const result = parseCustomersCsv(
      `${HEADER}\nA,COMPANY,,,,\nB Firma,COMPANY,12345,,,,\nC Firma,COMPANY,,,gecersiz-email,`,
    );
    expect(result.rows).toHaveLength(0);
    expect(result.issues.map((i) => i.row)).toEqual([2, 3, 4]);
    expect(result.issues[0]?.error).toContain('2-200');
    expect(result.issues[1]?.error).toContain('10-11');
    expect(result.issues[2]?.error).toContain('e-posta');
  });

  it('boş satırlar atlanır; satır numaraları dosya bazlıdır', () => {
    const result = parseCustomersCsv(`${HEADER}\n\nAtlas,,,,,\n\n`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.row).toBe(3);
  });

  it('çok satırlı tırnak alanı (satır sonu içinde) desteklenir', () => {
    const csv = `${HEADER}\n"Çok\nSatırlı A.Ş.",COMPANY,,,,\n`;
    const result = parseCustomersCsv(csv);
    expect(result.rows[0]?.name).toContain('Satırlı');
    expect(result.rows[0]?.name).toContain('\n');
  });
});
