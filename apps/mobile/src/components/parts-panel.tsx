import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  type BalanceView,
  type ExecutionReportView,
  type PartConsumptionView,
  type WorkOrderView,
} from '@teknikflow/contracts';
import { theme } from '../theme';
import type { ActionOutcome, ExecutionActions } from '../screens/execution-actions';

/**
 * Faz 09 — parça paneli: teknisyen kendi araç stoğundan tüketim seçer ve
 * kuyruğa girer (offline-first; sunucu atomik işler). Bakiye cache'ten
 * (senkronizasyonla) gelir; rapor çevrimiçiyse tüketilenler listelenir.
 * Sunucu reddi (stok aşımı/lot eksik) outbox çakışma şeridinde görünür —
 * kayıpsız senkronizasyon ilkesi.
 */

export interface PartsPanelProps {
  order: WorkOrderView;
  actions: ExecutionActions;
  /** Senkronizasyonla çekilen kendi araç stoğu (cache). */
  vanStock: BalanceView[];
  /** Tüketilen parçalar — çevrimiçi rapordan. */
  report?: ExecutionReportView | null;
  online: boolean;
  onAfterAction?: () => void;
  testIDPrefix?: string;
}

interface ItemOption {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  trackingMode: BalanceView['trackingMode'];
  available: number;
}

function formatMoney(minor: number | null): string {
  if (minor === null) return '—';
  return `${(minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺`;
}

export function PartsPanel({
  order,
  actions,
  vanStock,
  report,
  online,
  onAfterAction,
  testIDPrefix = 'parts',
}: PartsPanelProps) {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedLotId, setSelectedLotId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Bakiye satırlarından kalem seçenekleri (SKU başına bir satır).
  const itemOptions = useMemo<ItemOption[]>(() => {
    const map = new Map<string, ItemOption>();
    for (const row of vanStock) {
      if (row.available <= 0) continue;
      const existing = map.get(row.itemId);
      if (existing) {
        existing.available += row.available;
        continue;
      }
      map.set(row.itemId, {
        itemId: row.itemId,
        sku: row.sku,
        name: row.itemName,
        unit: row.unit,
        trackingMode: row.trackingMode,
        available: row.available,
      });
    }
    return [...map.values()];
  }, [vanStock]);

  const lotOptions = vanStock.filter((row) => row.itemId === selectedItemId && row.lotId !== null);
  const selectedItem = itemOptions.find((item) => item.itemId === selectedItemId);
  const consumed: PartConsumptionView[] = report?.parts ?? [];

  const terminal = order.status === 'CLOSED' || order.status === 'CANCELLED';
  if (terminal) return null;

  async function handleConsume() {
    setError(null);
    setInfo(null);
    const qty = Number(quantity.replace(',', '.'));
    if (!selectedItem) {
      setError('Parça seçin');
      return;
    }
    if (!(qty > 0)) {
      setError('Miktar sıfırdan büyük olmalı');
      return;
    }
    if (selectedItem.trackingMode !== 'NONE' && !selectedLotId) {
      setError('Parti/seri izlenen parçada lot seçin');
      return;
    }
    setBusy(true);
    try {
      const outcome: ActionOutcome = await actions.consumePart(order.workOrderId, {
        itemId: selectedItem.itemId,
        quantity: qty,
        ...(selectedLotId ? { lotId: selectedLotId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (outcome.ok) {
        setInfo(
          outcome.sent
            ? 'Parça tüketimi gönderildi.'
            : 'Kuyruğa alındı — bağlantı kurulunca gönderilecek.',
        );
        setQuantity('');
        setNote('');
        setSelectedLotId('');
        onAfterAction?.();
      } else {
        setError(outcome.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section} testID={testIDPrefix}>
      <Text style={styles.sectionTitle}>Parçalar</Text>

      <Text style={styles.hint}>
        {online
          ? `Araç stoğu senkronize — ${itemOptions.length} kalem kullanılabilir`
          : `Çevrimdışı — araç stoğu önbellekten (${itemOptions.length} kalem); tüketim kuyruğa girer`}
      </Text>

      {consumed.length > 0 ? (
        <View style={styles.consumedBox}>
          {consumed.map((part) => (
            <View key={part.movementId} style={styles.consumedRow}>
              <Text style={styles.consumedText}>
                {part.sku} · {part.quantity} {part.unit}
                {part.lotNo ? ` (${part.lotNo})` : ''}
              </Text>
              <Text style={styles.consumedCost}>{formatMoney(part.totalCostMinor)}</Text>
            </View>
          ))}
          <Text style={styles.totalText}>
            Toplam malzeme: {formatMoney(report?.partsCostMinor ?? 0)}
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>Bu işte henüz parça tüketilmedi.</Text>
      )}

      <Text style={styles.fieldLabel} nativeID={`${testIDPrefix}-item-label`}>
        Parça seç
      </Text>
      <View style={styles.itemList} testID={`${testIDPrefix}-items`}>
        {itemOptions.length === 0 ? (
          <Text style={styles.hint}>Araç stoğunda kullanılabilir parça yok.</Text>
        ) : (
          itemOptions.map((item) => (
            <Text
              key={item.itemId}
              style={[styles.itemRow, selectedItemId === item.itemId && styles.itemRowSelected]}
              onPress={() => {
                setSelectedItemId(item.itemId);
                setSelectedLotId('');
              }}
              accessibilityRole="button"
              accessibilityLabel={`${item.sku} ${item.name} seç`}
              testID={`${testIDPrefix}-item-${item.sku}`}
            >
              {item.sku} · {item.name} ({item.available} {item.unit})
            </Text>
          ))
        )}
      </View>

      {lotOptions.length > 0 && selectedItem ? (
        <>
          <Text style={styles.fieldLabel}>Lot / seri</Text>
          <View style={styles.itemList} testID={`${testIDPrefix}-lots`}>
            {lotOptions.map((row) => (
              <Text
                key={row.lotId ?? ''}
                style={[styles.itemRow, selectedLotId === row.lotId && styles.itemRowSelected]}
                onPress={() => setSelectedLotId(row.lotId ?? '')}
                accessibilityRole="button"
                accessibilityLabel={`Lot ${row.lotNo ?? ''} seç`}
              >
                {row.lotNo} ({row.available} {row.unit})
              </Text>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.fieldLabel} nativeID={`${testIDPrefix}-qty-label`}>
        Miktar
      </Text>
      <TextInput
        style={styles.input}
        value={quantity}
        onChangeText={setQuantity}
        placeholder="0"
        inputMode="decimal"
        keyboardType="decimal-pad"
        accessibilityLabel="Parça miktarı"
        testID={`${testIDPrefix}-qty`}
      />

      <Text style={styles.fieldLabel}>Not (opsiyonel)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Örn. devir/değişim"
        maxLength={500}
        accessibilityLabel="Parça notu"
        testID={`${testIDPrefix}-note`}
      />

      {error ? (
        <Text style={styles.error} testID={`${testIDPrefix}-error`}>
          {error}
        </Text>
      ) : null}
      {info ? (
        <Text style={styles.info} testID={`${testIDPrefix}-info`}>
          {info}
        </Text>
      ) : null}

      <Text
        style={[styles.consumeBtn, busy && styles.btnDisabled]}
        onPress={() => void handleConsume()}
        accessibilityRole="button"
        accessibilityLabel="Parça tüketimini kaydet"
        testID={`${testIDPrefix}-consume`}
      >
        {busy ? 'Gönderiliyor…' : 'Parça Tüket'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
  },
  sectionTitle: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: theme.textXs,
    color: theme.muted,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: theme.textSm,
    fontWeight: '600',
    color: theme.textStrong,
    marginTop: 8,
    marginBottom: 4,
  },
  itemList: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusSm,
    padding: 8,
    gap: 6,
    marginBottom: 8,
  },
  itemRow: {
    fontSize: theme.textSm,
    color: theme.text,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 40,
  },
  itemRowSelected: {
    color: theme.blue700,
    fontWeight: '700',
    backgroundColor: theme.canvas,
    borderRadius: theme.radiusSm,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusSm,
    padding: 10,
    minHeight: 44,
    fontSize: theme.textBase,
    color: theme.text,
    backgroundColor: theme.canvas,
    marginBottom: 8,
  },
  consumedBox: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusSm,
    padding: 8,
    marginBottom: 8,
    gap: 4,
  },
  consumedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  consumedText: {
    fontSize: theme.textSm,
    color: theme.text,
    flexShrink: 1,
  },
  consumedCost: {
    fontSize: theme.textSm,
    color: theme.textStrong,
    fontWeight: '600',
  },
  totalText: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    marginTop: 4,
  },
  error: {
    fontSize: theme.textSm,
    color: theme.danger,
    fontWeight: '600',
    marginTop: 4,
  },
  info: {
    fontSize: theme.textSm,
    color: theme.success,
    fontWeight: '600',
    marginTop: 4,
  },
  consumeBtn: {
    marginTop: 10,
    backgroundColor: theme.blue700,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: theme.textBase,
    textAlign: 'center',
    paddingVertical: 14,
    borderRadius: theme.radiusSm,
    minHeight: 48,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
