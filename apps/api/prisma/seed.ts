import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { retryWithBackoff } from '@teknikflow/shared';
import { getEnv } from '../src/config/env.js';

/**
 * Faz 01 tohumu (seed) — yalnızca altyapı önyüklemesi:
 * 1) Özel obje deposunda (RustFS) tenant verilerinin yaşayacağı bucket'ı hazırlar.
 * 2) app_settings tablosuna önyükleme kayıtlarını yazar.
 *
 * NOT: docs/DEMO_SEED_DATA.md'deki "Atlas Teknik Servis" demo veri seti
 * (şubeler, kullanıcılar, müşteriler, iş emirleri...) kimlik/CRM fazlarıyla
 * birlikte (Faz 03+) eklenir; bu fazda iş modelleri bilinçli olarak YOKTUR.
 */
async function main(): Promise<void> {
  const env = getEnv();

  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });

  // Bucket: private varsayılan (anonim erişim RustFS'te kapalıdır).
  // RustFS/Docker ağır yük altında yavaş açılabileceğinden yeniden deneme ile.
  const bucketStatus = await retryWithBackoff(
    async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
        return 'mevcut';
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
        return 'oluşturuldu';
      }
    },
    { retries: 5, baseMs: 1500, maxWaitMs: 8000, jitter: () => 0.5 },
  );
  console.log(`[seed] bucket '${env.S3_BUCKET}': ${bucketStatus}`);

  const prisma = new PrismaClient();
  try {
    const now = new Date().toISOString();
    const settings: Array<{ key: string; value: string }> = [
      { key: 'bootstrap.version', value: '0.1.0' },
      { key: 'bootstrap.completedAt', value: now },
      { key: 'demo.workspace', value: 'foundation-ready' },
      {
        key: 'demo.note',
        value: 'Atlas Teknik Servis demo verisi Faz 03+ ile eklenir (kimlik fazı)',
      },
    ];
    for (const setting of settings) {
      await prisma.appSetting.upsert({
        where: { key: setting.key },
        create: setting,
        update: { value: setting.value },
      });
    }
    console.log(`[seed] app_settings: ${settings.length} kayıt güncel`);
    console.log(`[seed] Tamamlandı (${now})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[seed] Başarısız:', error);
  process.exit(1);
});
