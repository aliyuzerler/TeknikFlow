import { fetchHealthReady } from '@teknikflow/api-client';
import { formatLatency } from '@teknikflow/shared';
import { getWebEnv } from '../src/load-env';
import {
  overallFromCards,
  serviceCardsFromApi,
  workerCard,
  type ServiceCard,
  type WorkerHealthSnapshot,
} from '../src/lib/status';
import { PHASES, phaseStatusLabel } from '../src/lib/phases';

export const dynamic = 'force-dynamic';

async function probeWorker(url: string): Promise<WorkerHealthSnapshot | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      status?: string;
      lastHeartbeat?: string;
      ageSeconds?: number;
    };
    if (body.status !== 'ok' && body.status !== 'degraded') {
      return null;
    }
    return {
      status: body.status,
      lastHeartbeat: body.lastHeartbeat,
      ageSeconds: body.ageSeconds,
    };
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const { apiBaseUrl, workerHealthUrl } = getWebEnv();

  const startedAt = performance.now();
  const [apiResult, workerSnapshot] = await Promise.all([
    fetchHealthReady(apiBaseUrl),
    probeWorker(workerHealthUrl),
  ]);
  const apiLatencyMs = Math.round(performance.now() - startedAt);

  const cards: ServiceCard[] = [
    ...serviceCardsFromApi(apiResult, apiResult.ok ? apiLatencyMs : undefined),
    workerCard(workerSnapshot),
  ];
  const overall = overallFromCards(cards);
  const renderedAt = new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Istanbul',
  }).format(new Date());

  return (
    <main className="page">
      <header className="site-header">
        <img
          src="/teknikflow-mark.svg"
          alt="TeknikFlow logosu"
          className="site-header__mark"
          width={44}
          height={44}
        />
        <div className="site-header__titles">
          <h1>TeknikFlow</h1>
          <p>Teknik servis ve saha operasyonları platformu</p>
        </div>
        <span className="site-header__phase">Faz 01 · Altyapı Temeli</span>
      </header>

      <section
        className={`overall ${overall.state === 'ok' ? 'overall--ok' : 'overall--degraded'}`}
        aria-label="Genel sistem durumu"
      >
        <p className="overall__text">{overall.text}</p>
        <div className="overall__meta">
          <div>Sayfa oluşturulma: {renderedAt} (TSİ)</div>
          <div>
            API: {apiBaseUrl} · Worker: {workerHealthUrl}
          </div>
        </div>
      </section>

      <section aria-labelledby="servisler-baslik">
        <h2 id="servisler-baslik">Servis Durumları</h2>
        <div className="cards">
          {cards.map((card) => (
            <article
              key={card.id}
              aria-label={`${card.name} durumu`}
              className="card"
              data-state={card.state}
            >
              <div className="card__head">
                <h3 className="card__name">{card.name}</h3>
                <span className={`badge badge--${card.state}`}>
                  <span className="badge__dot" aria-hidden="true" />
                  {card.label}
                </span>
              </div>
              <p className="card__desc">{card.description}</p>
              <div className="card__foot">
                {card.latencyMs !== undefined ? (
                  <span>Gecikme: {formatLatency(card.latencyMs)}</span>
                ) : null}
                {card.error ? (
                  <span style={{ color: 'var(--tf-danger)' }}>{card.error}</span>
                ) : null}
                {card.id === 'worker' && card.state === 'ok' && card.error === undefined && (
                  <span>Kalp atışı: her 30 sn</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="kurulum-baslik">
        <h2 id="kurulum-baslik">Yerel Kurulum</h2>
        <pre className="commands">
          <span className="cmt">{'# 1) Bağımlılıklar'}</span>
          {'\n'}pnpm install{'\n\n'}
          <span className="cmt">{'# 2) Altyapı (Docker olan makinelerde — önerilen)'}</span>
          {'\n'}pnpm infra:up{'\n\n'}
          <span className="cmt">
            {"# 2') Docker yoksa: yerel native mod (embedded PG/Redis + RustFS)"}
          </span>
          {'\n'}pnpm infra:native{'\n\n'}
          <span className="cmt">{'# 3) Veritabanı şeması + tohum (bucket dahil)'}</span>
          {'\n'}pnpm db:migrate &amp;&amp; pnpm db:seed{'\n\n'}
          <span className="cmt">{'# 4) Uygulamalar (API :4000 · Web :3000 · Worker :4001)'}</span>
          {'\n'}pnpm dev
        </pre>
      </section>

      <section aria-labelledby="fazlar-baslik">
        <h2 id="fazlar-baslik">Teslimat Fazları</h2>
        <table className="phases">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Kapsam</th>
              <th scope="col">Durum</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map((phase) => (
              <tr
                key={phase.id}
                className={phase.status === 'in-progress' ? 'is-current' : undefined}
              >
                <td>{String(phase.id).padStart(2, '0')}</td>
                <td>{phase.name}</td>
                <td>
                  <span className={`phase-badge phase-badge--${phase.status}`}>
                    {phaseStatusLabel(phase.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="site-footer">
        <p>
          Bu sayfa Faz 01 çıktısıdır: çalışma alanı, altyapı ve sağlık kontrolleri. İş modelleri
          (kimlik, CRM, iş emirleri…) kendi fazlarında eklenir — <code>docs/EXECUTION_PLAN.md</code>
          .
        </p>
        <ul>
          <li>
            API sağlık uçları: <code>GET /health/live</code> · <code>GET /health/ready</code>
          </li>
          <li>
            Kalite kapısı:{' '}
            <code>
              pnpm lint &amp;&amp; pnpm typecheck &amp;&amp; pnpm test &amp;&amp; pnpm build
            </code>
          </li>
          <li>Kiracı verisi bu fazda yoktur; demo iş verisi Faz 03+ ile gelir.</li>
        </ul>
      </footer>
    </main>
  );
}
