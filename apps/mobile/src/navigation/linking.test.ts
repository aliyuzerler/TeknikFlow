import { parseWorkOrderLink, workOrderDeepLink } from './linking';

/**
 * Faz 07 — bildirim yönlendirmesi: derin bağlantı ayrıştırma. Geçersiz
 * yol ASLA detay ekranına taşımaz (null).
 */

describe('linking', () => {
  it('geçerli tfmobile://wo/{id} bağlantısı ayrıştırılır', () => {
    const id = '11111111-1111-4111-8111-000000000001';
    expect(parseWorkOrderLink(workOrderDeepLink(id))).toBe(id);
  });

  it('geçersiz şema/yol null döner (sızıntı/karışıklık yok)', () => {
    expect(parseWorkOrderLink('https://example.com/wo/x')).toBeNull();
    expect(parseWorkOrderLink('tfmobile://customer/x')).toBeNull();
    expect(parseWorkOrderLink('tfmobile://wo/')).toBeNull();
    expect(parseWorkOrderLink('')).toBeNull();
  });
});
