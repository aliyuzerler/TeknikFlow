'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@teknikflow/ui-web';
import { REQUEST_STATUS_LABELS } from '@teknikflow/contracts';

/**
 * Faz 05 — talep arama + durum filtresi (URL parametreli GET formu).
 * Sayfa yenilenmeden gezinme: submit → router.push.
 */
const STATUS_OPTIONS = ['NEW', 'IN_REVIEW', 'CONVERTED', 'CANCELLED'] as const;

export function RequestsSearch({
  initialQuery,
  status,
}: {
  initialQuery: string;
  status?: 'NEW' | 'IN_REVIEW' | 'CONVERTED' | 'CANCELLED';
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQuery);

  function push(nextQ: string, nextStatus?: string) {
    const next = new URLSearchParams();
    if (nextQ.trim()) next.set('q', nextQ.trim());
    if (nextStatus) next.set('status', nextStatus);
    router.push(`/app/requests${next.size > 0 ? `?${next}` : ''}`);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    push(q, status);
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Talep arama"
      style={{
        display: 'flex',
        gap: 10,
        padding: '16px 18px 8px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Konu veya müşteri adı ile ara"
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
      <label htmlFor="request-status-filter" className="tf-visually-hidden">
        Durum filtresi
      </label>
      <select
        id="request-status-filter"
        value={status ?? ''}
        onChange={(e) => push(q, e.target.value || undefined)}
        aria-label="Durum filtresi"
        style={{
          height: 38,
          padding: '0 10px',
          border: '1px solid var(--tf-border)',
          borderRadius: 'var(--tf-radius-sm)',
          font: 'inherit',
          background: 'var(--tf-surface)',
        }}
      >
        <option value="">Tüm durumlar</option>
        {STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {REQUEST_STATUS_LABELS[option]}
          </option>
        ))}
      </select>
      {searchParams.get('q') || status ? (
        <Button type="button" variant="ghost" onClick={() => router.push('/app/requests')}>
          Temizle
        </Button>
      ) : null}
    </form>
  );
}
