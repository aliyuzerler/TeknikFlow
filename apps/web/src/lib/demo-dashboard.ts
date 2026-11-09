import type { NavSection } from '@teknikflow/ui-web';

/**
 * ⚠️ TASARIM ÖNİZLEME VERİSİ — üretim verisi DEĞİLDİR.
 *
 * Bu veri yalnızca `/app/overview` tasarım önizleme sayfasını besler
 * (design/preview.html'in gerçek kabukta yeniden üretimi). Gerçek API
 * verisi Faz 03+ ile (kimlik/tenant fazları) bağlanana kadar hiçbir üretim
 * kodu yolu bu dosyayı KULLANMAZ. docs/DEMO_SEED_DATA.md'deki "Atlas Teknik
 * Servis" setiyle aynı karakterler kullanılır (tutarlı demo evreni).
 */

export const DEMO_NAV_SECTIONS: NavSection[] = [
  {
    label: 'Çalışma alanı',
    items: [
      { id: 'overview', label: 'Genel Bakış', icon: 'overview', href: '/app/overview' },
      { id: 'work-orders', label: 'İş Emirleri', icon: 'work-orders', count: 12 },
      { id: 'dispatch', label: 'Planlama & Dispatch', icon: 'dispatch' },
      { id: 'customers', label: 'Müşteriler', icon: 'customers' },
      { id: 'assets', label: 'Makine & Ekipman', icon: 'assets' },
      { id: 'map', label: 'Harita & Saha', icon: 'map' },
    ],
  },
  {
    label: 'Operasyon',
    items: [
      { id: 'team', label: 'Ekip & Teknisyenler', icon: 'team' },
      { id: 'inventory', label: 'Depo & Parçalar', icon: 'warehouse' },
      { id: 'maintenance', label: 'Periyodik Bakım', icon: 'maintenance' },
      { id: 'quotes', label: 'Teklifler & Masraflar', icon: 'quotes' },
      { id: 'reports', label: 'Raporlar', icon: 'reports' },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { id: 'settings', label: 'Ayarlar', icon: 'settings' },
      { id: 'billing', label: 'Abonelik & Kullanım', icon: 'billing' },
    ],
  },
];

export const DEMO_USER = {
  name: 'Ali Yılmaz',
  role: 'Firma Yöneticisi',
  initials: 'AY',
} as const;

export const DEMO_CRUMBS = [{ label: 'Atlas Teknik Servis' }, { label: 'Genel Bakış' }] as const;

export interface DemoWorkOrder {
  code: string;
  type: string;
  customer: string;
  equipment: string;
  technician: string;
  planned: string;
  status: { tone: 'blue' | 'amber' | 'green' | 'red'; label: string };
}

export const DEMO_WORK_ORDERS: DemoWorkOrder[] = [
  {
    code: '#TF-2026-0842',
    type: 'Arıza · Yüksek',
    customer: 'Marmara Gıda A.Ş.',
    equipment: 'Soğutma Kompresörü',
    technician: 'Mehmet K.',
    planned: '09:30',
    status: { tone: 'blue', label: 'Sahada' },
  },
  {
    code: '#TF-2026-0841',
    type: 'Periyodik bakım',
    customer: 'Kuzey Plaza',
    equipment: 'HVAC Santral-02',
    technician: 'Can D.',
    planned: '10:00',
    status: { tone: 'amber', label: 'Parça bekliyor' },
  },
  {
    code: '#TF-2026-0840',
    type: 'Montaj · Normal',
    customer: 'Eksen Makine',
    equipment: 'CNC Soğutma Ünitesi',
    technician: 'Ayşe T.',
    planned: '11:30',
    status: { tone: 'green', label: 'Tamamlandı' },
  },
  {
    code: '#TF-2026-0839',
    type: 'Arıza · Kritik',
    customer: 'Anadolu Tekstil',
    equipment: 'Hava Kompresörü',
    technician: 'Emre Y.',
    planned: '12:00',
    status: { tone: 'red', label: 'SLA riski' },
  },
  {
    code: '#TF-2026-0838',
    type: 'Kontrol · Düşük',
    customer: 'Mavi Lojistik',
    equipment: 'Jeneratör-01',
    technician: 'Selin A.',
    planned: '13:00',
    status: { tone: 'blue', label: 'Atandı' },
  },
];

export const DEMO_SLA_ITEMS = [
  {
    dot: 'red' as const,
    time: '10:45',
    title: '#TF-0839 · Anadolu Tekstil',
    note: 'Yanıt süresi dolmak üzere',
  },
  {
    dot: 'amber' as const,
    time: '11:20',
    title: '#TF-0835 · Erdem Plastik',
    note: 'Atama yapılmadı',
  },
  {
    dot: 'amber' as const,
    time: '13:00',
    title: '#TF-0829 · Kent Otel',
    note: 'Bakım penceresi yaklaşıyor',
  },
];

export const DEMO_TEAM = [
  { name: 'Mehmet Kaya', note: '3 iş · 1 sahada', initials: 'MK', tone: 'blue' as const, load: 76 },
  {
    name: 'Can Demir',
    note: '2 iş · Parça bekliyor',
    initials: 'CD',
    tone: 'green' as const,
    load: 48,
  },
  {
    name: 'Ayşe Tunç',
    note: '4 iş · 1 tamamlandı',
    initials: 'AT',
    tone: 'pink' as const,
    load: 88,
  },
];

export const DEMO_EYEBROW = 'PAZARTESİ, 9 KASIM 2026';
