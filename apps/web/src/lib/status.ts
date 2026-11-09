import type { ApiClientResult } from '@teknikflow/api-client';
import type { HealthReadyResponse } from '@teknikflow/contracts';

/** Web panelinde gösterilen tek bir servis kartının modeli. */
export interface ServiceCard {
  id: string;
  name: string;
  description: string;
  state: 'ok' | 'fail';
  /** İnsan okur durum etiketi. */
  label: string;
  /** Yanıt gecikmesi (ms) — ölçüldüyse. */
  latencyMs?: number;
  /** Başarısızlıkta güvenli özet. */
  error?: string;
}

export type ApiReadyResult = ApiClientResult<HealthReadyResponse>;

export interface WorkerHealthSnapshot {
  status: 'ok' | 'degraded';
  lastHeartbeat?: string;
  ageSeconds?: number;
}

/** Rozet etiketi üretir. */
export function statusLabel(state: 'ok' | 'fail'): string {
  return state === 'ok' ? 'Çalışıyor' : 'Hizmet dışı';
}

/** API yanıtından servis kartlarını türetir. */
export function serviceCardsFromApi(result: ApiReadyResult, apiLatencyMs?: number): ServiceCard[] {
  if (!result.ok) {
    const label = result.error.kind === 'timeout' ? 'Zaman aşımı' : 'Erişilemedi';
    return [
      {
        id: 'api',
        name: 'REST API (NestJS)',
        description: 'Sistem durumunun toplandığı servis',
        state: 'fail',
        label,
        error: result.error.message,
      },
      ...unreachableCards(),
    ];
  }

  const ready = result.data;
  const cards: ServiceCard[] = [
    {
      id: 'api',
      name: 'REST API (NestJS)',
      description: 'Sistem durumunun toplandığı servis',
      state: ready.status === 'ok' ? 'ok' : 'fail',
      label: ready.status === 'ok' ? 'Çalışıyor' : 'Sınırlı',
      latencyMs: apiLatencyMs,
    },
    cardFromCheck(
      'database',
      'PostgreSQL',
      'Kiracı ve iş verileri (Prisma)',
      ready.checks.database,
    ),
    cardFromCheck('redis', 'Redis', 'Kuyruklar, önbellek, oturum (BullMQ)', ready.checks.redis),
    cardFromCheck(
      'objectStorage',
      'Obje Deposu (RustFS)',
      'Özel dosya/ek deposu (S3 uyumlu)',
      ready.checks.objectStorage,
    ),
  ];
  return cards;
}

function cardFromCheck(
  id: string,
  name: string,
  description: string,
  check: HealthReadyResponse['checks'][keyof HealthReadyResponse['checks']],
): ServiceCard {
  return {
    id,
    name,
    description,
    state: check.state,
    label: statusLabel(check.state),
    latencyMs: check.latencyMs,
    error: check.error,
  };
}

function unreachableCards(): ServiceCard[] {
  return (['database', 'redis', 'objectStorage'] as const).map((id) => ({
    id,
    name: id === 'database' ? 'PostgreSQL' : id === 'redis' ? 'Redis' : 'Obje Deposu (RustFS)',
    description: 'API üzerinden sorgulanır',
    state: 'fail' as const,
    label: 'Bilinmiyor',
    error: 'API yanıt vermediği için kontrol edilemedi',
  }));
}

/** Worker sağlık anlık görüntüsünden kart üretir. */
export function workerCard(snapshot: WorkerHealthSnapshot | null): ServiceCard {
  if (!snapshot) {
    return {
      id: 'worker',
      name: 'Worker (BullMQ)',
      description: 'Arka plan işleri ve kalp atışı',
      state: 'fail',
      label: 'Erişilemedi',
      error: 'Worker sağlık uç noktası yanıt vermedi',
    };
  }
  const fresh = snapshot.status === 'ok';
  return {
    id: 'worker',
    name: 'Worker (BullMQ)',
    description: 'Arka plan işleri ve kalp atışı',
    state: fresh ? 'ok' : 'fail',
    label: fresh ? 'Çalışıyor' : 'Kalp atışı bayat',
    error: fresh ? undefined : `Son kalp atışı: ${snapshot.ageSeconds ?? '?'} sn önce`,
  };
}

/** Genel durum özeti: tüm kartlar ok ise 'ok'. */
export function overallFromCards(cards: readonly ServiceCard[]): {
  state: 'ok' | 'degraded';
  text: string;
} {
  const failing = cards.filter((card) => card.state === 'fail');
  if (failing.length === 0) {
    return { state: 'ok', text: 'Tüm sistemler hazır' };
  }
  const names = failing.map((card) => card.name).join(', ');
  return { state: 'degraded', text: `Kısıtlı çalışma: ${names}` };
}
