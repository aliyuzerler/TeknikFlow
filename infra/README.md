# infra/ — Yerel Altyapı

TeknikFlow yerel geliştirme bağımlılıkları: **PostgreSQL 18, Redis 7, RustFS (S3-uyumlu)**.

> **Neden RustFS?** MinIO açık kaynak sunucusu Nisan 2026'da arşivlendi ve
> `dl.min.io` artık ikili dosyaları sunmuyor. RustFS (Apache-2.0) S3-uyumlu,
> tek ikili dosyalı, konsolu `:9001`'de MinIO benzeri bir alternatiftir —
> bkz. `docs/decisions/ADR-0005`.

## A) Docker varsa (önerilen)

```bash
pnpm infra:up      # docker compose up -d
pnpm infra:down    # durdur
```

| Servis | Port | Not |
|---|---|---|
| PostgreSQL | 5432 | kullanıcı `teknikflow`, parola `local_dev_only`, db `teknikflow` |
| Redis | 6379 | şifresiz, yalnızca yerel |
| RustFS S3 API | 9000 | `local_s3_user` / `local_s3_password_change_me` |
| RustFS Konsol | 9001 | tarayıcıdan http://localhost:9001 |

Bucket (`teknikflow-private`), `pnpm db:seed` tarafından **yeniden deneme
döngüsüyle** idempotent biçimde oluşturulur (RustFS yavaş başlarsa bile güvenli).

## B) Docker yoksa (sandbox/CI veya sade makine)

```bash
pnpm infra:native        # embedded PostgreSQL + Redis + RustFS'ı başlatır
pnpm infra:native:stop   # hepsini durdurur
```

- PostgreSQL kümesi `infra/native/.data/pg` altında kalıcıdır (yeniden init gerektirmez).
- Redis, `redis-memory-server` ile 6379'da çalışır.
- RustFS tekli binary `infra/native/bin/rustfs` altına indirilir (≈115 MB, git'e girmez).
- Bu mod **root/sudo gerektirmez**; gereksinim yalnızca Node.js + `unzip` komutudur.
- RustFS günlükleri: `infra/native/.state/rustfs.log`.

## Test veritabanı

Entegrasyon testleri ayrı bir veritabanı kullanır: `teknikflow_test`.

```bash
# Native modda otomatik oluşturulur; Docker modunda:
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U teknikflow -d postgres -c 'CREATE DATABASE teknikflow_test'

TEST_DATABASE_URL=postgresql://teknikflow:local_dev_only@localhost:5432/teknikflow_test \
  pnpm db:migrate && pnpm test:integration
```

## Sır güvenliği

Buradaki tüm kimlik bilgileri **yalnızca yerel geliştirme** içindir ve
`.env.example` ile eşleşir. Üretim değerleri asla bu dosyalara girmez.
