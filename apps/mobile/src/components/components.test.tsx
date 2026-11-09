import { render } from '@testing-library/react-native';
import { StatusBadge } from './status-badge';
import { SyncBanner } from './sync-banner';

/**
 * Faz 07 — rozet ve senkron şeridi testleri: etiketler + durum tonları.
 */

describe('StatusBadge', () => {
  it('durum etiketleri tr-TR taşır', () => {
    expect(render(<StatusBadge status="ASSIGNED" />).getByText('Atandı')).toBeTruthy();
    expect(render(<StatusBadge status="IN_PROGRESS" />).getByText('Devam')).toBeTruthy();
    expect(
      render(<StatusBadge status="WAITING_PARTS" />).getByText('Parça bekleniyor'),
    ).toBeTruthy();
    expect(render(<StatusBadge status="CANCELLED" />).getByText('İptal')).toBeTruthy();
  });

  it('öncelik etiketleri taşır', () => {
    expect(render(<StatusBadge priority="URGENT" />).getByText('Acil')).toBeTruthy();
    expect(render(<StatusBadge priority="LOW" />).getByText('Düşük')).toBeTruthy();
  });
});

describe('SyncBanner', () => {
  it('durum + meta dürüst birleşir', () => {
    const utils = render(
      <SyncBanner
        status="synced"
        lastSyncAt="2026-11-09T09:15:00.000Z"
        pendingCount={2}
        error={null}
        testID="banner"
      />,
    );
    expect(utils.getByText(/Güncel/)).toBeTruthy();
    expect(utils.getByText(/2 işlem kuyrukta/)).toBeTruthy();
  });

  it('çevrimdışı durum açıkça bildirilir', () => {
    const utils = render(
      <SyncBanner status="offline" lastSyncAt={null} pendingCount={0} error={null} />,
    );
    expect(utils.getByText('Çevrimdışı — önbellek gösteriliyor')).toBeTruthy();
  });

  it('hata mesajı şeritte taşınır', () => {
    const utils = render(
      <SyncBanner
        status="error"
        lastSyncAt={null}
        pendingCount={0}
        error="Sunucu yanıt vermiyor"
      />,
    );
    expect(utils.getByText(/Sunucu yanıt vermiyor/)).toBeTruthy();
  });
});
