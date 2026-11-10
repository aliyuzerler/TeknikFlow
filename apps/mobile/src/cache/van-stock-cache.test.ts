import type { BalanceView } from '@teknikflow/contracts';
import { createMemoryCacheDriver } from './driver';
import { createVanStockCache } from './van-stock-cache';

/**
 * TEST-09 §7 — araç stoğu cache: replace-all (sunucu otoriter),
 * kullanıcı bazlı anahtar, logout temizliği.
 */

const USER = '11111111-1111-4111-8111-000000000001';

const BALANCE: BalanceView = {
  itemId: 'i1',
  sku: 'FLT-04-25',
  itemName: 'Hava filtresi',
  unit: 'ad',
  trackingMode: 'NONE',
  warehouseId: 'w1',
  warehouseName: 'Teknisyen Aracı 34',
  warehouseType: 'VEHICLE',
  lotId: null,
  lotNo: null,
  expiresAt: null,
  onHand: 6,
  reservedQty: 0,
  available: 6,
  lowStock: false,
  updatedAt: '2026-11-10T08:00:00.000Z',
};

describe('createVanStockCache', () => {
  it('put → get bakiyeleri taşır; tekrar put eskisini ÜSTÜNE YAZAR (replace-all)', async () => {
    const cache = createVanStockCache(createMemoryCacheDriver());
    await cache.put(USER, [BALANCE]);
    const first = await cache.get(USER);
    expect(first?.balances).toHaveLength(1);

    // Sunucu otoriter: tüketim sonrası tek bakiye kaldı → cache aynıdır.
    await cache.put(USER, [{ ...BALANCE, onHand: 3, available: 3 }]);
    const second = await cache.get(USER);
    expect(second?.balances).toHaveLength(1);
    expect(second?.balances[0]?.onHand).toBe(3);
    expect(second?.syncedAt).not.toBeNull();
  });

  it('kullanıcı bazlı izolasyon; clear ile temizlenir', async () => {
    const cache = createVanStockCache(createMemoryCacheDriver());
    await cache.put(USER, [BALANCE]);
    await cache.put('other-user', [{ ...BALANCE, sku: 'OTHER' }]);

    await cache.clear(USER);
    expect(await cache.get(USER)).toBeNull();
    expect(await cache.get('other-user')).not.toBeNull();

    await cache.clear();
    expect(await cache.get('other-user')).toBeNull();
  });
});
