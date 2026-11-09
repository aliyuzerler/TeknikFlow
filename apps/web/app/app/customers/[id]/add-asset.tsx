'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, FormField, SideDrawer } from '@teknikflow/ui-web';
import { getClientApiBaseUrl } from '@/src/lib/client-env';
import { useCsrf } from '@/src/lib/use-csrf';

interface LocationOption {
  locationId: string;
  name: string | null;
  address: string;
}

/** Faz 04 — müşteriye ekipman ekleme çekmecesi (assets:manage). */
export function AddAssetButton({
  customerId,
  locations,
}: {
  customerId: string;
  locations: LocationOption[];
}) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const csrf = useCsrf();
  const [open, setOpen] = useState(false);
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [serviceLocationId, setServiceLocationId] = useState('');
  const [criticality, setCriticality] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (manufacturer.trim().length < 2) {
      setError('Üretici en az 2 karakter olmalı');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/assets`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          customerId,
          ...(assetTag.trim() ? { assetTag: assetTag.trim().toUpperCase() } : {}),
          manufacturer: manufacturer.trim(),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}),
          ...(serviceLocationId ? { serviceLocationId } : {}),
          criticality,
        }),
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);
      if (!response) {
        setError('Ağa ulaşılamadı');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
      if (!response.ok) {
        if (body.code === 'ASSET_TAG_TAKEN') setError('Bu etiket kiracı içinde kullanımda');
        else if (body.code === 'SERIAL_TAKEN') setError('Bu seri numarası kayıtlı');
        else setError(body.message ?? 'Ekipman eklenemedi');
        return;
      }
      setOpen(false);
      setManufacturer('');
      setModel('');
      setSerialNumber('');
      setAssetTag('');
      setServiceLocationId('');
      setCriticality('LOW');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        ＋ Ekipman
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Yeni Ekipman">
        <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 14 }}>
          {error ? (
            <p role="alert" style={{ margin: 0, color: 'var(--tf-danger)', fontSize: 13 }}>
              {error}
            </p>
          ) : null}

          <FormField label="Üretici" required>
            {(ids) => (
              <input
                name="manufacturer"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <FormField label="Model">
            {(ids) => (
              <input
                name="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <FormField label="Seri No" hint="Kiracı içinde tekil">
            {(ids) => (
              <input
                name="serial"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                {...ids}
              />
            )}
          </FormField>

          <FormField label="Etiket" hint="Boş bırakılırsa otomatik üretilir (ör. AST-4KD9T2)">
            {(ids) => (
              <input
                name="assetTag"
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value.toUpperCase())}
                placeholder="AST-…"
                {...ids}
              />
            )}
          </FormField>

          {locations.length > 0 ? (
            <FormField label="Lokasyon">
              {(ids) => (
                <select
                  name="location"
                  value={serviceLocationId}
                  onChange={(e) => setServiceLocationId(e.target.value)}
                  {...ids}
                >
                  <option value="">Seçilmedi</option>
                  {locations.map((location) => (
                    <option key={location.locationId} value={location.locationId}>
                      {location.name ?? location.address}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          ) : null}

          <FormField label="Kritiklik">
            {(ids) => (
              <select
                name="criticality"
                value={criticality}
                onChange={(e) => setCriticality(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH')}
                {...ids}
              >
                <option value="LOW">Düşük</option>
                <option value="MEDIUM">Orta</option>
                <option value="HIGH">Yüksek</option>
              </select>
            )}
          </FormField>

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Ekleniyor…' : 'Ekipmanı ekle'}
          </Button>
        </form>
      </SideDrawer>
    </>
  );
}
