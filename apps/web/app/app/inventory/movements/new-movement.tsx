'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, FormField, QuantityInput } from '@teknikflow/ui-web';
import {
  CreateMovementRequestSchema,
  STOCK_MOVEMENT_TYPE_LABELS,
  type BalanceView,
  type StockItemView,
  type WarehouseView,
} from '@teknikflow/contracts';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

/**
 * Faz 09 — genel stok hareketi formu (RECEIVE/ISSUE/TRANSFER/RETURN/
 * ADJUSTMENT). Parti/seri izlenen kalemlerde lot, seçilen kalemin bakiye
 * satırlarından seçilir. movementKey istemcide üretilir — çift tıklama/
 * yenileme TEK defter satırı üretir.
 */

type MovementType = 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT';

const TYPES: MovementType[] = ['RECEIVE', 'ISSUE', 'TRANSFER', 'RETURN', 'ADJUSTMENT'];

export function NewMovementForm() {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [type, setType] = useState<MovementType>('RECEIVE');
  const [items, setItems] = useState<StockItemView[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseView[]>([]);
  const [itemLots, setItemLots] = useState<BalanceView[]>([]);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [lotId, setLotId] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedItem = items.find((item) => item.itemId === itemId);
  const needsLot = selectedItem ? selectedItem.trackingMode !== 'NONE' : false;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const headers = { accept: 'application/json' };
      const [itemsRes, warehouseRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/inventory/items?pageSize=100`, {
          headers,
          credentials: 'include',
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        fetch(`${apiBaseUrl}/api/v1/inventory/warehouses`, {
          headers,
          credentials: 'include',
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
      ]);
      if (cancelled) return;
      if (itemsRes?.ok) setItems(((await itemsRes.json()).data ?? []) as StockItemView[]);
      if (warehouseRes?.ok)
        setWarehouses(((await warehouseRes.json()).data ?? []) as WarehouseView[]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  // Seçilen kalemin lot satırları (bakiye uçtan türetilir).
  useEffect(() => {
    setLotId('');
    setItemLots([]);
    if (!itemId) return;
    let cancelled = false;
    async function load() {
      const response = await fetch(`${apiBaseUrl}/api/v1/inventory/balances?itemId=${itemId}`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json()) as { data?: BalanceView[] };
      if (!cancelled) setItemLots(body.data ?? []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [itemId, apiBaseUrl]);

  const lotOptions = useMemo(
    () => itemLots.filter((row) => row.lotId !== null && row.onHand > 0),
    [itemLots],
  );

  function directionOk(): boolean {
    switch (type) {
      case 'RECEIVE':
        return toWarehouseId !== '' && fromWarehouseId === '';
      case 'TRANSFER':
      case 'ISSUE':
      case 'RETURN':
        return fromWarehouseId !== '' && toWarehouseId !== '' && fromWarehouseId !== toWarehouseId;
      case 'ADJUSTMENT':
        return (fromWarehouseId !== '') !== (toWarehouseId !== '');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const qty = Number(quantity.replace(',', '.'));
    if (!itemId) {
      setError('Stok kalemi seçin');
      return;
    }
    if (!(qty > 0)) {
      setError('Miktar sıfırdan büyük olmalı');
      return;
    }
    if (needsLot && !lotId) {
      setError('Parti/seri izlenen kalemde lot seçimi zorunludur');
      return;
    }
    if (!directionOk()) {
      setError(
        'Yön uyuşmaz: giriş yalnız hedef depo, transfer her iki depo, düzeltme tam bir depo ile yapılır',
      );
      return;
    }

    const movementKey = crypto.randomUUID();
    const input = {
      type,
      itemId,
      quantity: qty,
      ...(needsLot ? { lotId } : {}),
      ...(fromWarehouseId ? { fromWarehouseId } : {}),
      ...(toWarehouseId ? { toWarehouseId } : {}),
      movementKey,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = CreateMovementRequestSchema.safeParse(input);
    if (!parsed.success) {
      setError('Form değerleri sözleşmeye uymuyor — alanları kontrol edin');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/inventory/movements`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
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
        quantity?: number;
        unit?: string;
      };
      if (!response.ok) {
        if (body.code === 'NEGATIVE_STOCK_FORBIDDEN') {
          setError(
            `Stok yetersiz — kullanılabilir: ${body.details?.available ?? 0}. Negatif bakiye onaysız oluşturulamaz; sayım düzeltmesi kullanın.`,
          );
        } else if (body.code === 'LOT_EXPIRED') {
          setError('Süresi geçmiş lot hareket yazılamaz');
        } else {
          setError(body.message ?? 'Hareket kaydedilemedi');
        }
        return;
      }
      // Tek json okuma — gövde hem hata hem başarıda aynı değişkenden alınır.
      setSuccess(
        `${STOCK_MOVEMENT_TYPE_LABELS[type]} kaydedildi${
          response.ok && body.quantity !== undefined ? ` (${body.quantity} ${body.unit})` : ''
        }.`,
      );
      setQuantity('');
      setNote('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ padding: '0 18px 14px', display: 'grid', gap: 12, maxWidth: 560 }}
    >
      <h3 className="tf-panel__title" style={{ fontSize: 15, marginTop: 8 }}>
        Yeni hareket
      </h3>
      {error ? <Alert variant="danger" title={error} /> : null}
      {success ? <Alert variant="success" title={success} /> : null}

      <FormField label="Hareket türü" required>
        {(ids) => (
          <select
            {...ids}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as MovementType)}
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {STOCK_MOVEMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField label="Stok kalemi" required>
        {(ids) => (
          <select {...ids} name="itemId" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Seçin…</option>
            {items
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.itemId} value={item.itemId}>
                  {item.sku} — {item.name}
                </option>
              ))}
          </select>
        )}
      </FormField>

      <FormField label={type === 'RECEIVE' ? 'Kaynak depo (girişte boş)' : 'Kaynak depo'}>
        {(ids) => (
          <select
            {...ids}
            name="fromWarehouseId"
            value={fromWarehouseId}
            onChange={(e) => setFromWarehouseId(e.target.value)}
          >
            <option value="">—</option>
            {warehouses
              .filter((warehouse) => warehouse.active)
              .map((warehouse) => (
                <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                  {warehouse.name}
                </option>
              ))}
          </select>
        )}
      </FormField>

      <FormField label={type === 'RECEIVE' ? 'Hedef depo (giriş)' : 'Hedef depo'}>
        {(ids) => (
          <select
            {...ids}
            name="toWarehouseId"
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
          >
            <option value="">—</option>
            {warehouses
              .filter((warehouse) => warehouse.active)
              .map((warehouse) => (
                <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                  {warehouse.name}
                </option>
              ))}
          </select>
        )}
      </FormField>

      {needsLot ? (
        <FormField label="Lot / seri" required hint="Süresi geçen lot hareket yazılamaz">
          {(ids) => (
            <select {...ids} name="lotId" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">Seçin…</option>
              {lotOptions.map((row) => (
                <option key={row.lotId ?? ''} value={row.lotId ?? ''}>
                  {row.lotNo} ({row.onHand} {row.unit})
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
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
        )}
      </FormField>

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Kaydediliyor…' : 'Hareketi kaydet'}
      </Button>
    </form>
  );
}
