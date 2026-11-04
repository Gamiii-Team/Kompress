# CONFIG.md — Environment & Tier Mapping

Complete reference for every variable used by the pipeline. All values are externalized (`.env`); nothing is hardcoded inside `backend/src/` except fallback defaults (always overridable by env).

---

## Required (must be set; compose refuses start without them)

| Variable | Default / Example | Purpose | Tier change |
|---|---|---|---|
| `POSTGRES_PASSWORD` | — | Postgres admin password | T1→T2: connection string only |
| `S3_SECRET_ACCESS_KEY` | — | R2 / S3 secret | T1→T2: keys only |

---

## Runtime & identity

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `dev` auth refused when `production` (hard guard) |
| `ROLE` | — | `api` / `worker` / `scheduler`; determines command |
| `PORT` | `8080` | API listen port; LB targets this |
| `PUBLIC_HOST` | `localhost` | TLS cert, CORS origin, webhook URL |
| `ACME_EMAIL` | `ops@localhost` | Traefik ACME (Let's Encrypt) |
| `INSTANCE_ID` | container id | Returned by `/api/health`; used to verify LB distribution |

---

## Auth

| Variable | Default / Example | Notes |
|---|---|---|
| `AUTH_MODE` | `msal` | `dev` refused in production (startup assertion) |
| `MSAL_CLIENT_ID` | — | Entra app registration |
| `MSAL_TENANT_ID` | `common` | Multi-tenant; or specific tenant id |
| `API_AUDIENCE` | `api://document-compression` | Must match token `aud` |
| `ALLOWED_TENANTS` | — | Optional allowlist (e.g., `tenant-a,tenant-b`) |

Verification rules (from `SECURITY.md` §3):
- Signature against Microsoft JWKS (cached, rotated)
- `aud`, `iss` (vs `tid`), `exp`, `nbf`
- `user_key = tenantId.objectId`
- No sticky sessions required (JWT is self-contained)

---

## Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://app:changeme@postgres:5432/app` | T1 container; T2 managed Postgres changes only this string |
| `DB_POOL_MAX` | `10` | Connection pool size per node |

Migration: `node backend/src/db/migrate.js` (run once before rolling new image; backward-compatible expansions always).

---

## Queue / Cache / Rate limits (shared across nodes)

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379` | T1 container; T2 managed Redis — string only |
| `WORKER_CONCURRENCY` | `2` | Concurrent parsing jobs per worker process |
| `GLOBAL_MAX_JOBS` | `2` | Additional concurrency guard |

Redis config (compose): `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction`
> **Deliberate:** `noeviction` — the queue must not drop jobs under memory pressure. Cache-only instances can use `allkeys-lru` on a separate DB/instance if needed.

Rate limits (global, backed by Redis):
- Per IP: 300 / 15 min
- Auth endpoints: 20 / 15 min
- `POST /api/documents`: 20 / hour per user
- `POST /api/billing/notify`: 60 / min per source (signature-checked)
- Job polling: 1 / second per job per user

---

## Storage

| Variable | Default | Notes |
|---|---|---|
| `STORAGE_DRIVER` | `s3` | Adapter selects endpoint |
| `S3_ENDPOINT` | `http://seaweedfs:8333` | T1 SeaweedFS; T2 R2 endpoint (`https://<account>.r2.cloudflarestorage.com`) |
| `S3_REGION` | `auto` | R2 uses `auto` |
| `S3_BUCKET` | `doc-compression` | Private bucket; lifecycle rule on `users/*/uploads/` (7 days) only |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | API token scoped to bucket |
| `UPLOAD_RETENTION_DAYS` | `7` | Lifecycle rule + daily sweep backup |

Object key structure (enforced in adapter):
```
bucket/
  users/{userKey}/uploads/{uuid}       ← 7-day TTL
  users/{userKey}/documents/{docId}.json  ← no TTL (until user deletion)
```

---

## Models

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` for T1; `openai-compatible` or `modal-http` for T3 |
| `LLM_BASE_URL` | — | Modal endpoint or OpenAI-compatible |
| `LLM_API_KEY` | — | Never in image / git / logs |
| `LLM_MODEL` | `gpt-4o` | Text LLM |
| `VISION_MODEL` | `florence-2-large` | Image / vision |
| `OCR_MODEL` | `ocr-engine-v2` | Scanned pages |
| `MAX_CHUNK_TOKENS` | `3000` | Chunk size limit |
| `GLOBAL_MONTHLY_BUDGET_USD` | `30` | Credit guard; alert at 80% |

Model terms check (before deployment): inputs must not be used for training. Recorded in adapter config. Results cached by file `sha256` **scoped per user** (never across users).

---

## Payments (PayHere)

| Variable | Default | Notes |
|---|---|---|
| `PAYMENTS_ENABLED` | `false` | Must be `false` until live approved |
| `PAYHERE_MODE` | `sandbox` | `sandbox` → `live` only after Terms / Privacy / Return Policy live |
| `PAYHERE_MERCHANT_ID` | — | Sandbox test first (success / failure / cancellation) |
| `PAYHERE_MERCHANT_SECRET` | — | Signature verification only; never stores card data |

`POST /api/billing/notify` has **no bearer token**; trusted only after PayHere `md5sig` verification against merchant secret. Replay protection on `order_id`. Plan + balance change only inside transaction.

---

## Security / LB / Network

| Variable | Default | Notes |
|---|---|---|
| `TRAEFIK_DASHBOARD_ENABLED` | `true` | Bound to `127.0.0.1:8081` only; never public |
| `TRUSTED_PROXIES` | `10.0.0.0/8,172.16.0.0/12,127.0.0.1` | Real client IP for rate limits (Proxy Protocol / `CF-Connecting-IP`) |

LB specification (from `DEPLOYMENT.md` §5):
- Algorithm: `least-connections`
- Health: `GET /api/ready`, 10 s interval, 3 fails → drain, 2 passes → restore
- Sticky: `false`
- Max body: 50 MB (rejected at edge)
- Read timeout: 120 s; idle timeout: 75 s (300 s if SSE added)
- Draining: 30 s; retries: idempotent GET only; proxy protocol on if Cloudflare fronts

---

## Tier change summary (what actually changes)

| Concern | T1 | T2+ | Change required |
|---|---|---|---|
| DB | Postgres container | Managed Postgres | connection string only |
| Queue | Redis container | Managed Redis | connection string only |
| Files | SeaweedFS | R2 / S3 | endpoint + keys only |
| Rate limit | Redis (already) | Redis (already) | none |
| TLS | Traefik ACME | Cloudflare / DO LB | Traefik off or internal only |
| Cron | worker with advisory lock | same | none |
| Metrics | `/metrics` per node | aggregated | scrape config only |

**No code rewrite is required for T1→T2.** The only differences are connection strings, endpoint URLs, and whether Traefik is externally exposed.

---

## Verification checklist (pre-production)

- [ ] `NODE_ENV=production`, `AUTH_MODE=msal`
- [ ] `AUTH_MODE=dev` boot assertion verified (refuses in production)
- [ ] All default passwords changed from `.env.example`
- [ ] TLS valid; HSTS on; HTTP redirects to HTTPS
- [ ] Only 80/443 public; Postgres, Redis, MinIO unreachable externally
- [ ] `docker compose up -d --scale api=2` distributes (distinct `instance` IDs)
- [ ] Kill one API node under load → zero 5xx after one health interval
- [ ] Quota race test passes (10 parallel, balance 1 → 1 accepted)
- [ ] Idempotency test passes (5 identical `Idempotency-Key` → 1 job)
- [ ] R2 lifecycle rule active on `uploads/`; absent on `documents/`
- [ ] Retention sweep tested and logged
- [ ] Backups running **and a restore drill completed**
- [ ] PayHere sandbox: success, failure, cancellation all correct
- [ ] Modal budget guard tested (`GLOBAL_MONTHLY_BUDGET_USD`)
- [ ] Full acceptance suite green (`docs/SECURITY.md` §15 checklist)
