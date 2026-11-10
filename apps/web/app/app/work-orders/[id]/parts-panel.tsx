'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, FormField, Panel, QuantityInput, StatusBadge } from '@teknikflow/ui-web';
import {
  ConsumePartRequestSchema,
  type BalanceView,
  type PartConsumptionView,
} from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 09 — iş emri parça paneli: tüketim listesi + atomik tüketim formu.
 * Teknisyen (stock:issue_own) kendi araç stoğundan tüketir (mine=true);
 * stock:manage sahipleri tüm depoları seçebilir. Tüketim idempotency
 * anahtarıyla gönderilir — çift tıklama TEK hareket üretir.
 */

interface PartsPanelProps {
  workOrderId: string;
  status: string;
  permissions: string[];
  isAssignee: boolean;
}

function formatMoney(minor: number | null): string {
  if (minor === null) return '—';
  return `${(minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`;
}

export function PartsPanel({ workOrderId, status, permissions, isAssignee }: PartsPanelProps) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [parts, setParts] = useState<PartConsumptionView[] | null>(null);
  const [balances, setBalances] = useState<BalanceView[]>([]);
  const [itemId, setItemId] = useState('');
  const [lotId, setLotId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const terminal = status === 'CLOSED' || status === 'CANCELLED';
  const canManageStock = permissions.includes('stock:manage');
  const canExecute =
    permissions.includes('work_orders:complete') &&
    (permissions.includes('work_orders:view_all') || isAssignee);
  // Teknisyen kendi stoğundan; stock:manage sahibi tüm bakiyeleri görür.
  const balanceQuery = canManageStock ? '' : '?mine=true';

  const load = useCallback(async () => {
    const headers = { accept: 'application/json' };
    const [partsRes, balanceRes] = await Promise.all([
      fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/parts`, {
        headers,
        credentials: 'include',
        signal: AbortSignal.timeout(6000),
      }).catch(() => null),
      fetch(`${apiBaseUrl}/api/v1/inventory/balances${balanceQuery}`, {
        headers,
        credentials: 'include',
        signal: AbortSignal.timeout(6000),
      }).catch(() => null),
    ]);
    if (partsRes?.ok) setParts(((await partsRes.json()).data ?? []) as PartConsumptionView[]);
    if (balanceRes?.ok) {
      const rows = ((await balanceRes.json()).data ?? []) as BalanceView[];
      setBalances(rows.filter((row) => row.available > 0));
    }
  }, [apiBaseUrl, workOrderId, balanceQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  // Bakiye satırlarından kalem listesi türet (SKU başına tek seçenek).
  const itemOptions = useMemo(() => {
    const map = new Map<
      string,
      { itemId: string; sku: string; name: string; unit: string; tracking: string }
    >();
    for (const row of balances) {
      if (!map.has(row.itemId)) {
        map.set(row.itemId, {
          itemId: row.itemId,
          sku: row.sku,
          name: row.itemName,
          unit: row.unit,
          tracking: row.trackingMode,
        });
      }
    }
    return [...map.values()];
  }, [balances]);

  const lotOptions = balances.filter((row) => row.itemId === itemId && row.lotId !== null);
  const selectedItem = itemOptions.find((item) => item.itemId === itemId);
  const totalCostMinor = (parts ?? []).reduce((sum, part) => sum + (part.totalCostMinor ?? 0), 0);

  async function handleConsume(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    const qty = Number(quantity.replace(',', '.'));
    if (!itemId) {
      setError('Stok kalemi seçin');
      return;
    }
    if (!(qty > 0)) {
      setError('Miktar sıfırdan büyük olmalı');
      return;
    }
    const needsLot = selectedItem ? selectedItem.tracking !== 'NONE' : false;
    if (needsLot && !lotId) {
      setError('Parti/seri izlenen kalemde lot seçimi zorunludur');
      return;
    }

    const input = {
      itemId,
      quantity: qty,
      ...(needsLot ? { lotId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = ConsumePartRequestSchema.safeParse(input);
    if (!parsed.success) {
      setError('Form değerleri sözleşmeye uymuyor');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/work-orders/${workOrderId}/parts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-idempotency-key': crypto.randomUUID(),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        details?: { available?: number };
      };
      if (!response.ok) {
        if (body.code === 'NEGATIVE_STOCK_FORBIDDEN') {
          setError(
            `Araç stoğunda yeterli miktar yok (kullanılabilir: ${body.details?.available ?? 0}). Tüketim kaydedilemedi.`,
          );
        } else {
          setError(body.message ?? 'Tüketim kaydedilemedi');
        }
        return;
      }
      setInfo('Parça tüketimi kaydedildi.');
      setQuantity('');
      setNote('');
      setLotId('');
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (terminal) return null;

  return (
    <Panel
      title="Parçalar"
      headingLevel={2}
      subtitle={`Toplam malzeme maliyeti: ${formatMoney(totalCostMinor)}`}
    >
      {error ? (
        <Alert variant="danger" title="İşlem başarısız">
          {error}
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" title="Kaydedildi">
          {info}
        </Alert>
      ) : null}

      <h3 className="tf-panel__title" style={{ fontSize: 15 }}>
        Tüketilen parçalar
      </h3>
      {parts === null ? (
        <p className="tf-panel__subtitle">Yükleniyor…</p>
      ) : parts.length === 0 ? (
        <p className="tf-panel__subtitle" style={{ marginTop: 0 }}>
          Bu iş emrinde henüz parça tüketimi yok.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 8 }}>
          {parts.map((part) => (
            <li
              key={part.movementId}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                flexWrap: 'wrap',
                borderBottom: '1px solid var(--tf-border)',
                paddingBottom: 8,
              }}
            >
              <span className="tf-table__wo">{part.sku}</span>
              <span style={{ fontSize: 14 }}>{part.itemName}</span>
              <StatusBadge tone="gray">
                {part.quantity} {part.unit}
                {part.lotNo ? ` · ${part.lotNo}` : ''}
              </StatusBadge>
              <span className="tf-panel__subtitle" style={{ marginLeft: 'auto' }}>
                {part.warehouseName ?? '—'} · {formatMoney(part.totalCostMinor)} ·{' '}
                {new Date(part.occurredAt).toLocaleString('tr-TR')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canExecute ? (
        <form
          onSubmit={handleConsume}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}
        >
          <h3 className="tf-panel__title" style={{ fontSize: 15 }}>
            Parça tüket
          </h3>
          <FormField
            label="Stok kalemi"
            required
            hint="Yalnız kullanılabilir stokta olanlar listelenir"
          >
            {(ids) => (
              <select
                {...ids}
                name="part-item"
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value);
                  setLotId('');
                }}
              >
                <option value="">Seçin…</option>
                {itemOptions.map((item) => (
                  <option key={item.itemId} value={item.itemId}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          {lotOptions.length > 0 ? (
            <FormField label="Lot / seri" required>
              {(ids) => (
                <select
                  {...ids}
                  name="part-lot"
                  value={lotId}
                  onChange={(e) => setLotId(e.target.value)}
                >
                  <option value="">Seçin…</option>
                  {lotOptions.map((row) => (
                    <option key={row.lotId ?? ''} value={row.lotId ?? ''}>
                      {row.lotNo} ({row.available} {row.unit})
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          ) : null}

          <FormField label="Miktar" required>
            {() => (
              <QuantityInput
                label="Miktar"
                unit={selectedItem?.unit}
                value={quantity}
                onChange={setQuantity}
                step={1}
              />
            )}
          </FormField>

          <FormField label="Not (opsiyonel)">
            {(ids) => (
              <input
                {...ids}
                name="part-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            )}
          </FormField>

          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Tüketimi kaydet'}
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
