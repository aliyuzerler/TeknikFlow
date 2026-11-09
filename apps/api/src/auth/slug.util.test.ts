import { describe, expect, it } from 'vitest';
import { slugify } from './slug.util.js';

describe('slugify', () => {
  it('Türkçe karakterleri koruyarak çevirir', () => {
    expect(slugify('Atlas Teknik Servis')).toBe('atlas-teknik-servis');
    expect(slugify('Çağrı Yönetim A.Ş.')).toBe('cagri-yonetim-a-s');
    expect(slugify('İstanbul Bölge')).toBe('istanbul-bolge');
  });

  it('çok kısa girdiler için geçerli bir üretim yapar', () => {
    expect(slugify('ab').length).toBeGreaterThanOrEqual(3);
    expect(slugify('---').length).toBeGreaterThanOrEqual(3);
  });

  it('uzun girdiler 40 karakterde kesilir', () => {
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(40);
  });
});
