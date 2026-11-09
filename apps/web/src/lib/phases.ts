export interface PhaseInfo {
  id: number;
  name: string;
  status: 'done' | 'in-progress' | 'not-started';
}

/** docs/STATUS.md ile eş tutulan faz haritası (her faz sonunda güncellenir). */
export const PHASES: readonly PhaseInfo[] = [
  { id: 1, name: 'Çalışma alanı ve altyapı temeli', status: 'done' },
  { id: 2, name: 'Marka sistemi, UI shell ve Storybook', status: 'done' },
  { id: 3, name: 'Kimlik, kiracı izolasyonu, RBAC ve onboarding', status: 'done' },
  { id: 4, name: 'CRM, kişiler, lokasyonlar ve ekipman envanteri', status: 'not-started' },
  { id: 5, name: 'Servis talebi ve iş emri yaşam döngüsü', status: 'not-started' },
  { id: 6, name: 'Dispatch panosu, ekip kapasitesi ve planlama', status: 'not-started' },
  { id: 7, name: 'Mobil temel ve teknisyen gelen kutusu', status: 'not-started' },
  { id: 8, name: 'Teknisyen iş yürütme, GPS, medya ve imza', status: 'not-started' },
  { id: 9, name: 'Envanter, araç stoğu ve parça tüketimi', status: 'not-started' },
  { id: 10, name: 'Önleyici bakım ve servis sözleşmeleri', status: 'not-started' },
  { id: 11, name: 'Teklifler, masraflar ve ticari akış', status: 'not-started' },
  { id: 12, name: 'Müşteri portalı ve bildirimler', status: 'not-started' },
  { id: 13, name: 'Analitik, dışa aktarım ve operasyon panoları', status: 'not-started' },
  { id: 14, name: 'SaaS planları, koltuklar, abonelik ve faturalama', status: 'not-started' },
  { id: 15, name: 'Güvenlik, performans, gözlemlenebilirlik ve dağıtım', status: 'not-started' },
  { id: 16, name: 'Sürüm adayı, regresyon otomasyonu ve kalite onayı', status: 'not-started' },
];

export function phaseStatusLabel(status: PhaseInfo['status']): string {
  switch (status) {
    case 'done':
      return 'Tamamlandı';
    case 'in-progress':
      return 'Devam ediyor';
    case 'not-started':
      return 'Başlanmadı';
  }
}
