'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@teknikflow/ui-web';

/**
 * Faz 04 — müşteri arama çubuğu (URL parametreli GET formu).
 * Sayfa yenilenmeden gezinme: submit → router.push.
 */
export function CustomersSearch({
  initialQuery,
  showArchived,
}: {
  initialQuery: string;
  showArchived: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQuery);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (q.trim()) next.set('q', q.trim());
    if (showArchived) next.set('status', 'ARCHIVED');
    router.push(`/app/customers${next.size > 0 ? `?${next}` : ''}`);
  }

  function toggleArchived() {
    const next = new URLSearchParams();
    if (q.trim()) next.set('q', q.trim());
    if (!showArchived) next.set('status', 'ARCHIVED');
    router.push(`/app/customers${next.size > 0 ? `?${next}` : ''}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Müşteri arama"
      style={{ display: 'flex', gap: 10, padding: '16px 18px 8px', flexWrap: 'wrap' }}
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Müşteri adı veya vergi no ile ara"
        aria-label="Arama sorgusu"
        style={{
          flex: '1 1 240px',
          maxWidth: 360,
          height: 38,
          padding: '0 12px',
          border: '1px solid var(--tf-border)',
          borderRadius: 'var(--tf-radius-sm)',
          font: 'inherit',
        }}
      />
      <Button type="submit" variant="primary">
        Ara
      </Button>
      <Button type="button" variant="secondary" onClick={toggleArchived}>
        {showArchived ? 'Arşivi gizle' : 'Arşivdekiler'}
      </Button>
      {searchParams.get('q') || showArchived ? (
        <Button type="button" variant="ghost" onClick={() => router.push('/app/customers')}>
          Temizle
        </Button>
      ) : null}
    </form>
  );
}
