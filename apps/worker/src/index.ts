import { createServer } from 'node:http';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { buildHealthBody } from './heartbeat.js';
import { getWorkerEnv } from './env.js';

/**
 * Faz 01 worker'ı: altyapı kanıtına odaklanır.
 * - 'infra.heartbeat' kuyruğunda 30 sn'de bir tekrarlanan iş çalıştırır,
 *   Redis'e worker:heartbeat kaydını yazar (TTL = 3 aralık).
 * - :4001/health ucundan kalp atışı tazeliğini bildirir.
 * Sonraki fazlarda (bildirim, PDF, hatırlatıcı...) gerçek kuyruklar eklenir.
 */

const HEARTBEAT_KEY = 'worker:heartbeat';

interface Deps {
  env: ReturnType<typeof getWorkerEnv>;
  connection: Redis;
  heartbeatQueue: Queue;
  worker: Worker;
  server: ReturnType<typeof createServer>;
}

function log(event: string, data: Record<string, unknown>): void {
  // Yapılandırılmış JSON çıktı (Phase 15'te OpenTelemetry'ye bağlanacak).
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`);
}

async function bootstrap(): Promise<void> {
  const env = getWorkerEnv();

  // BullMQ kendi bağlantısını yönetir; URL'den türet.
  const { Redis } = await import('ioredis');
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ gereksinimi
    connectTimeout: 2000,
  });

  const heartbeatQueue = new Queue('infra.heartbeat', { connection });

  const worker = new Worker(
    'infra.heartbeat',
    async () => {
      const now = new Date().toISOString();
      await connection.set(
        HEARTBEAT_KEY,
        now,
        'EX',
        Math.ceil(env.HEARTBEAT_INTERVAL_MS / 1000) * 3,
      );
      return { at: now };
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, error) => {
    log('heartbeat_failed', { jobId: job?.id ?? null, error: error.message });
  });
  worker.on('error', (error) => {
    log('worker_error', { error: error.message });
  });

  // Tekrarlanan iş: BullMQ v6 job-scheduler API'si. upsert olduğundan
  // yeniden başlatmada çift zamanlayıcı oluşmaz (idempotent).
  await heartbeatQueue.upsertJobScheduler(
    'infra-heartbeat-scheduler',
    { every: env.HEARTBEAT_INTERVAL_MS },
    {
      name: 'beat',
      data: {},
      opts: {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    },
  );

  const server = createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      void (async () => {
        const last = await connection.get(HEARTBEAT_KEY).catch(() => null);
        const body = buildHealthBody(last ?? undefined, Date.now(), env.HEARTBEAT_MAX_AGE_MS);
        res.writeHead(last === null ? 503 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      })();
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Bilinmeyen yol' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(env.WORKER_PORT, () => resolve());
  });
  log('worker_started', {
    port: env.WORKER_PORT,
    queue: 'infra.heartbeat',
    intervalMs: env.HEARTBEAT_INTERVAL_MS,
  });

  const deps: Deps = { env, connection, heartbeatQueue, worker, server };
  registerShutdown(deps);
}

function registerShutdown(deps: Deps): void {
  const shutdown = (signal: string) => {
    log('worker_stopping', { signal });
    void Promise.allSettled([deps.worker.close(), deps.heartbeatQueue.close()]).then(() => {
      deps.server.close(() => {
        deps.connection.quit().finally(() => process.exit(0));
      });
      // server beklemiyorsa da 5 sn sonra çık.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void bootstrap();
