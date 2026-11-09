'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@teknikflow/ui-web';

/** Faz 04 — ekipman arama/filtre çubuğu (URL parametreli). */
export function AssetSearch({
  initialQuery,
  status,
  criticality,
}: {
  initialQuery: string;
  status: string;
  criticality: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [statusValue, setStatusValue] = useState(status);
  const [criticalityValue, setCriticalityValue] = useState(criticality);

  function push(nextQ: string, nextStatus: string, nextCriticality: string) {
    const next = new URLSearchParams();
    if (nextQ.trim()) next.set('q', nextQ.trim());
    if (nextStatus) next.set('status', nextStatus);
    if (nextCriticality) next.set('criticality', nextCriticality);
    router.push(`/app/assets${next.size > 0 ? `?${next}` : ''}`);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    push(q, statusValue, criticalityValue);
  }

  const selectStyle = {
    height: 38,
    padding: '0 8px',
    border: '1px solid var(--tf-border)',
    borderRadius: 'var(--tf-radius-sm)',
    background: 'var(--tf-surface)',
    font: 'inherit',
    fontSize: 13,
  } as const;

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Ekipman arama"
      style={{ display: 'flex', gap: 10, padding: '16px 18px 8px', flexWrap: 'wrap', alignItems: 'center' }}
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Etiket, seri, marka veya müşteri ara"
        aria-label="Arama sorgusu"
        style={{
          flex: '1 1 220px',
          maxWidth: 320,
          height: 38,
          padding: '0 12px',
          border: '1px solid var(--tf-border)',
          borderRadius: 'var(--tf-radius-sm)',
          font: 'inherit',
        }}
      />
      <select
        aria-label="Durum filtresi"
        value={statusValue}
        onChange={(e) => push(q, e.target.value, criticalityValue)}
        style={selectStyle}
      >
        <option value="">Tüm durumlar</option>
        <option value="ACTIVE">Aktif</option>
        <option value="INACTIVE">Pasif</option>
        <option value="RETIRED">Emekli</option>
      </select>
      <select
        aria-label="Kritiklik filtresi"
        value={criticalityValue}
        onChange={(e) => push(q, statusValue, e.target.value)}
        style={selectStyle}
      >
        <option value="">Tüm kritiklikler</option>
        <option value="HIGH">Yüksek</option>
        <option value="MEDIUM">Orta</option>
        <option value="LOW">Düşük</option>
      </select>
      <Button type="submit" variant="primary">
        Ara
      </Button>
      {(q || statusValue || criticalityValue) && (
        <Button type="button" variant="ghost" onClick={() => { setQ(''); setStatusValue(''); setCriticalityValue(''); router.push('/app/assets'); }}>
          Temizle
        </Button>
      )}
    </form>
  );
}
