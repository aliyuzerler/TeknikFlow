import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  MEDIA_STATUS_LABELS,
  SIGNATURE_ROLE_LABELS,
  TIME_ENTRY_TYPE_LABELS,
  VISIT_MILESTONE_LABELS,
  type ChecklistItemView,
  type ExecutionReportView,
  type SignatureStroke,
  type WorkOrderStatus,
  type WorkOrderView,
} from '@teknikflow/contracts';
import { SignaturePad } from './signature-pad';
import { theme } from '../theme';
import type { ActionOutcome, ExecutionActions } from '../screens/execution-actions';

/**
 * Faz 08 — saha yürütme paneli: kabul/yol/varış/iş başlat/bitir eylemleri,
 * checklist, süre takibi, imza tuvali ve kanıt özeti. Tüm mutasyonlar
 * ExecutionActions üzerinden outbox'a girer (offline-first).
 */

export interface ExecutionPanelProps {
  order: WorkOrderView;
  actions: ExecutionActions;
  /** Rapor verisi (checklist/süre/imza/medya/varış) — çevrimiçi çekilir. */
  report?: ExecutionReportView | null;
  /** Çevrimiçi mi (çevrimdışıyken rapor çekilmez, eylemler kuyruklanır). */
  online: boolean;
  /** Kuyrukta bekleyen işlem sayısı (şerit). */
  pendingCount: number;
  /** Eylem sonrası ekranın tazelemesi için. */
  onAfterAction?: () => void;
  testIDPrefix?: string;
}

const ACTION_BUTTONS: Array<{ from: WorkOrderStatus[]; to: WorkOrderStatus; label: string }> = [
  { from: ['ASSIGNED'], to: 'ACCEPTED', label: 'İşi Kabul Et' },
  { from: ['ACCEPTED'], to: 'EN_ROUTE', label: 'Yola Çık' },
  { from: ['ON_SITE'], to: 'IN_PROGRESS', label: 'İşi Başlat' },
  {
    from: ['IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CUSTOMER'],
    to: 'COMPLETED',
    label: 'İşi Bitir',
  },
];

export function ExecutionPanel({
  order,
  actions,
  report,
  online,
  pendingCount,
  onAfterAction,
  testIDPrefix = 'execution',
}: ExecutionPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualReason, setManualReason] = useState('');
  const [showManualArrival, setShowManualArrival] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [strokes, setStrokes] = useState<SignatureStroke[]>([]);

  const labor = report?.labor ?? null;
  const openEntry = useMemo(() => {
    if (!report) return null;
    return report.timeEntries.find((entry) => entry.status === 'OPEN') ?? null;
  }, [report]);
  const requiredRemaining = report?.requiredChecklistRemaining ?? null;
  const signatures = report?.signatures ?? [];
  const validSignatures = signatures.filter((signature) => !signature.supersededById);

  async function run(fn: () => Promise<ActionOutcome>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await fn();
      if (outcome.ok) {
        setMessage(
          outcome.sent
            ? 'Kaydedildi.'
            : pendingCount > 0 || !online
              ? 'Çevrimdışı — kuyruğa alındı, bağlantıda gönderilecek.'
              : 'Kaydedildi.',
        );
        setShowManualArrival(false);
        onAfterAction?.();
      } else {
        setMessage(outcome.message);
        if (outcome.needsManualArrival) setShowManualArrival(true);
      }
    } finally {
      setBusy(false);
    }
  }

  const buttons = ACTION_BUTTONS.filter((button) => button.from.includes(order.status));

  return (
    <View style={styles.wrap} testID={testIDPrefix}>
      <Text style={styles.title}>Saha Yürütme</Text>

      {!online ? <Text style={styles.offline}>Çevrimdışı — eylemler kuyruğa alınır.</Text> : null}
      {pendingCount > 0 ? (
        <Text style={styles.pending} testID={`${testIDPrefix}-pending`}>
          {pendingCount} işlem senkron bekliyor.
        </Text>
      ) : null}

      {buttons.map((button) => (
        <Text
          key={button.to}
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void run(() => actions.transition(order.workOrderId, button.to))}
          accessibilityRole="button"
          accessibilityLabel={button.label}
          testID={`${testIDPrefix}-${button.to.toLowerCase()}`}
        >
          {button.label}
        </Text>
      ))}

      {/* GPS varışı: EN_ROUTE durumunda. */}
      {order.status === 'EN_ROUTE' ? (
        <View style={styles.arriveBox}>
          <Text
            style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
            onPress={() => void run(() => actions.arrive(order.workOrderId))}
            accessibilityRole="button"
            accessibilityLabel="Varış (GPS ile)"
            testID={`${testIDPrefix}-arrive-gps`}
          >
            Varış (GPS)
          </Text>
          {showManualArrival ? (
            <View style={styles.manualBox} testID={`${testIDPrefix}-manual-box`}>
              <TextInput
                style={styles.input}
                placeholder="Manuel onay nedeni (ör. konum izni reddedildi)"
                value={manualReason}
                onChangeText={setManualReason}
                accessibilityLabel="Manuel varış nedeni"
                testID={`${testIDPrefix}-manual-reason`}
              />
              <Text
                style={styles.button}
                onPress={() => void run(() => actions.arrive(order.workOrderId, manualReason))}
                accessibilityRole="button"
                accessibilityLabel="Manuel varışı onayla"
                testID={`${testIDPrefix}-arrive-manual`}
              >
                Manuel Onayla
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {message ? (
        <Text style={styles.message} testID={`${testIDPrefix}-message`}>
          {message}
        </Text>
      ) : null}

      {/* Checklist */}
      {report && report.checklist.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Checklist{' '}
            {requiredRemaining !== null && requiredRemaining > 0
              ? `(${requiredRemaining} zorunlu eksik)`
              : ''}
          </Text>
          {report.checklist.map((item) => (
            <ChecklistRow
              key={item.itemId}
              item={item}
              busy={busy}
              onToggle={() => void run(() => actions.toggleChecklistItem(order.workOrderId, item))}
              testIDPrefix={`${testIDPrefix}-checklist`}
            />
          ))}
        </View>
      ) : null}

      {/* Süre takibi */}
      {report ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Süre Takibi</Text>
          {labor ? (
            <Text style={styles.laborRow} testID={`${testIDPrefix}-labor-summary`}>
              Yol {labor.travelMinutes} dk · İş {labor.laborMinutes} dk · Bekleme{' '}
              {labor.waitingMinutes} dk
            </Text>
          ) : null}
          {openEntry ? (
            <View style={styles.openEntryRow}>
              <Text style={styles.openEntryText} testID={`${testIDPrefix}-open-entry`}>
                Açık: {TIME_ENTRY_TYPE_LABELS[openEntry.type]}
              </Text>
              <Text
                style={styles.button}
                onPress={() =>
                  void run(() => actions.stopLabor(order.workOrderId, openEntry.timeEntryId))
                }
                accessibilityRole="button"
                accessibilityLabel="Süreyi durdur"
                testID={`${testIDPrefix}-stop-labor`}
              >
                Durdur
              </Text>
            </View>
          ) : order.status === 'IN_PROGRESS' || order.status === 'ON_SITE' ? (
            <Text
              style={styles.button}
              onPress={() => void run(() => actions.startLabor(order.workOrderId))}
              accessibilityRole="button"
              accessibilityLabel="İş süresi başlat"
              testID={`${testIDPrefix}-start-labor`}
            >
              İş Süresi Başlat
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Varış kayıtları (GPS kanıtı) */}
      {report && report.visits.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Konum Kayıtları</Text>
          {report.visits.map((visit) => (
            <Text key={visit.visitId} style={styles.visitRow} testID={`${testIDPrefix}-visit`}>
              {VISIT_MILESTONE_LABELS[visit.milestone]} · {formatVisitLocation(visit)} ·{' '}
              {visit.latitude !== null
                ? `±${Math.round(visit.accuracyMeters ?? 0)} m`
                : 'konum yok'}
            </Text>
          ))}
        </View>
      ) : null}

      {/* İmza */}
      {order.status !== 'CLOSED' && order.status !== 'CANCELLED' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            İmza {validSignatures.length > 0 ? `(${validSignatures.length} geçerli)` : ''}
          </Text>
          {signatures.map((signature) => (
            <Text
              key={signature.signatureId}
              style={styles.signatureRow}
              testID={`${testIDPrefix}-signature`}
            >
              {SIGNATURE_ROLE_LABELS[signature.role]} · {signature.signerName} ·{' '}
              {signature.supersededById ? 'geçersiz kılındı (düzeltme)' : 'geçerli'}
            </Text>
          ))}
          <TextInput
            style={styles.input}
            placeholder="İmzalayan adı (ör. Ayşe Yılmaz)"
            value={signerName}
            onChangeText={setSignerName}
            accessibilityLabel="İmzalayan adı"
            testID={`${testIDPrefix}-signer-name`}
          />
          <SignaturePad
            onStrokesChange={(next) => setStrokes(next)}
            testIDPrefix={`${testIDPrefix}-pad`}
          />
          <Text
            style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
            onPress={() => {
              if (signerName.trim().length < 2) {
                setMessage('İmzalayan adı en az 2 karakter olmalı');
                return;
              }
              const clean = strokes.filter((stroke) => stroke.length >= 2);
              const pointCount = clean.reduce((total, stroke) => total + stroke.length, 0);
              if (pointCount < 4) {
                setMessage('İmza çok kısa — tekrar imzalayın');
                return;
              }
              void run(() =>
                actions.captureSignature(order.workOrderId, {
                  role: 'CUSTOMER',
                  signerName: signerName.trim(),
                  signedAt: new Date().toISOString(),
                  strokes: clean,
                }),
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="İmzayı kaydet"
            testID={`${testIDPrefix}-capture-signature`}
          >
            İmzayı Kaydet
          </Text>
        </View>
      ) : null}

      {/* Medya kanıtı */}
      {report && report.media.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Medya ({report.media.length})</Text>
          {report.media.map((media) => (
            <Text key={media.mediaId} style={styles.mediaRow} testID={`${testIDPrefix}-media`}>
              {media.fileName} · {MEDIA_STATUS_LABELS[media.status]}
              {media.failureCode ? ` (${media.failureCode})` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function formatVisitLocation(visit: { latitude: number | null; longitude: number | null }): string {
  if (visit.latitude === null || visit.longitude === null) return 'manuel onay';
  return `${visit.latitude.toFixed(4)}, ${visit.longitude.toFixed(4)}`;
}

function ChecklistRow({
  item,
  busy,
  onToggle,
  testIDPrefix,
}: {
  item: ChecklistItemView;
  busy: boolean;
  onToggle: () => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.checklistRow}>
      <Text
        style={[styles.checkbox, item.done && styles.checkboxDone]}
        onPress={busy ? undefined : onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${item.label} ${item.done ? 'tamamlandı' : 'tamamlanmadı'}`}
        testID={`${testIDPrefix}-${item.itemId}`}
      >
        {item.done ? '✓' : '○'}
      </Text>
      <View style={styles.checklistText}>
        <Text style={[styles.checklistLabel, item.done && styles.checklistLabelDone]}>
          {item.label}
          {item.required ? ' *' : ''}
        </Text>
        {item.note ? <Text style={styles.checklistNote}>{item.note}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
  },
  title: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  offline: {
    color: theme.warning,
    fontSize: theme.textSm,
    marginBottom: 6,
  },
  pending: {
    color: theme.muted,
    fontSize: theme.textSm,
    marginBottom: 6,
  },
  button: {
    color: theme.blue700,
    fontSize: theme.textBase,
    fontWeight: '600',
    paddingVertical: 10,
  },
  buttonPrimary: {
    color: theme.blue600,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  arriveBox: {
    marginTop: 4,
  },
  manualBox: {
    marginTop: 8,
    backgroundColor: theme.canvas,
    borderRadius: theme.radiusMd,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: theme.textBase,
    color: theme.text,
    backgroundColor: theme.canvas,
    marginBottom: 6,
  },
  message: {
    marginTop: 6,
    color: theme.text,
    fontSize: theme.textSm,
  },
  section: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 10,
  },
  sectionTitle: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    marginBottom: 6,
  },
  checklistRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
    alignItems: 'flex-start',
  },
  checklistText: {
    flexShrink: 1,
  },
  checkbox: {
    fontSize: 20,
    lineHeight: 24,
    color: theme.blue700,
    fontWeight: '700',
    minWidth: 28,
  },
  checkboxDone: {
    color: theme.success,
  },
  checklistLabel: {
    fontSize: theme.textBase,
    color: theme.text,
    flexShrink: 1,
  },
  checklistLabelDone: {
    textDecorationLine: 'line-through',
    color: theme.muted,
  },
  checklistNote: {
    fontSize: theme.textXs,
    color: theme.muted,
  },
  laborRow: {
    fontSize: theme.textSm,
    color: theme.text,
    marginBottom: 6,
  },
  openEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  openEntryText: {
    fontSize: theme.textSm,
    color: theme.success,
    fontWeight: '600',
    flex: 1,
  },
  visitRow: {
    fontSize: theme.textSm,
    color: theme.text,
    paddingVertical: 2,
  },
  signatureRow: {
    fontSize: theme.textSm,
    color: theme.text,
    paddingVertical: 2,
  },
  mediaRow: {
    fontSize: theme.textSm,
    color: theme.text,
    paddingVertical: 2,
  },
});
