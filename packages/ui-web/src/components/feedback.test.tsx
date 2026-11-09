import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, OfflineBanner, ProgressBar, SyncStatus } from './feedback.js';
import { Breadcrumbs, PageHeader } from './page.js';

describe('Breadcrumbs', () => {
  it('sayfa yolu nav’ı, bağlantıları ve son öğeyi aria-current ile basar', () => {
    render(
      <Breadcrumbs
        items={[{ label: 'Atlas Teknik Servis', href: '/app/overview' }, { label: 'Genel Bakış' }]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Sayfa yolu' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Atlas Teknik Servis' })).toHaveAttribute(
      'href',
      '/app/overview',
    );
    expect(screen.getByText('Genel Bakış')).toHaveAttribute('aria-current', 'page');
  });

  it('tek öğede bağlantı yok, yalnız mevcut sayfa', () => {
    render(<Breadcrumbs items={[{ label: 'İş Emirleri' }]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('PageHeader', () => {
  it('h1 + üst etiket + alt yazı + eylem alanı basar', () => {
    render(
      <PageHeader
        eyebrow="PAZARTESİ, 9 KASIM 2026"
        title="Operasyon Genel Bakışı"
        subtitle="Bugün saha ekiplerinizde neler oluyor."
        actions={<button type="button">Yeni Talep</button>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Operasyon Genel Bakışı' }),
    ).toBeInTheDocument();
    expect(screen.getByText('PAZARTESİ, 9 KASIM 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni Talep' })).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('baş harfleri taşır ve süstür (aria-hidden)', () => {
    render(<Avatar initials="AY" />);
    const avatar = screen.getByText('AY');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
  });

  it('ton ve boyut sınıflarını uygular', () => {
    const { container } = render(<Avatar initials="CD" tone="green" size="sm" />);
    const avatar = container.querySelector('.tf-avatar');
    expect(avatar).toHaveClass('tf-avatar--green', 'tf-avatar--sm');
  });
});

describe('ProgressBar', () => {
  it('progressbar rolünü tam aria değerleriyle duyurur', () => {
    render(<ProgressBar value={76} label="Mehmet Kaya iş yükü" />);
    const bar = screen.getByRole('progressbar', { name: 'Mehmet Kaya iş yükü' });
    expect(bar).toHaveAttribute('aria-valuenow', '76');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('değeri [0, max] aralığına kenetler', () => {
    render(<ProgressBar value={130} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('SyncStatus', () => {
  it('her durum METİNLE anlatılır — nokta süstür', () => {
    const { rerender } = render(<SyncStatus state="synced" />);
    expect(screen.getByText('Senkronize')).toBeInTheDocument();
    rerender(<SyncStatus state="syncing" />);
    expect(screen.getByText('Senkronize ediliyor')).toBeInTheDocument();
    rerender(<SyncStatus state="pending" pendingCount={4} />);
    expect(screen.getByText('Kuyrukta: 4')).toBeInTheDocument();
    rerender(<SyncStatus state="error" />);
    expect(screen.getByText('Senkronizasyon hatası')).toBeInTheDocument();
  });

  it('role=status ile kibarca duyurulur', () => {
    render(<SyncStatus state="syncing" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('OfflineBanner', () => {
  it('çevrimdışıyken uyarı bandı görünür ve duyurulur', () => {
    render(<OfflineBanner online={false} />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/Çevrimdışısınız/);
  });

  it('çevrimiçi + kuyruk varsa bekleyen sayıyı söyler', () => {
    render(<OfflineBanner online pendingCount={3} />);
    expect(screen.getByRole('status')).toHaveTextContent(/3 değişiklik/);
  });

  it('çevrimiçi ve kuyruk boşsa hiçbir şey render etmez', () => {
    const { container } = render(<OfflineBanner online />);
    expect(container).toBeEmptyDOMElement();
  });
});
