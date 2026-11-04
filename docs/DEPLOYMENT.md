# Deployment Documentation

Document Compression Pipeline · v1.0

## 1. Topology Summary

Stateless API nodes behind a load balancer, separate worker pool, one scheduler,
externalised state in Postgres + Redis + S3-compatible storage. Local disk is
scratch only and may be destroyed at any time.

## 2. Prerequisites

- Docker Engine 24+ and Docker Compose v2
- A domain with DNS pointed at the host (for TLS)
- 2 GB RAM minimum for T1; 4 GB recommended once Pro launches
- Microsoft Entra app registration (production auth)
- Cloudflare R2 bucket (production storage) or SeaweedFS for self-host
- Modal endpoints (production models) or `LLM_PROVIDER=mock`

## 3. Environment Variables

```env
# Runtime
NODE_ENV=production
ROLE=api                      # api | worker | scheduler
PORT=8080
PUBLIC_HOST=api.example.com
ACME_EMAIL=ops@example.com
INSTANCE_ID=                  # auto-filled with container id

# Auth
AUTH_MODE=msal                # dev is refused when NODE_ENV=production
MSAL_CLIENT_ID=
MSAL_TENANT_ID=common
API_AUDIENCE=api://document-compression
ALLOWED_TENANTS=              # optional allowlist

# Database
DATABASE_URL=postgres://app:PASSWORD@postgres:5432/app
DB_POOL_MAX=10

# Queue / cache
REDIS_URL=redis://redis:6379
WORKER_CONCURRENCY=2
GLOBAL_MAX_JOBS=2

# Storage
STORAGE_DRIVER=s3
S3_ENDPOINT=http://seaweedfs:8333
S3_REGION=auto
S3_BUCKET=doc-compression
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
UPLOAD_RETENTION_DAYS=7

# Postgres (container only)
POSTGRES_PASSWORD=

# Models
LLM_PROVIDER=mock             # mock | openai-compatible | modal-http
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
VISION_MODEL=
OCR_MODEL=
MAX_CHUNK_TOKENS=3000
GLOBAL_MONTHLY_BUDGET_USD=30

# Payments
PAYMENTS_ENABLED=false
PAYHERE_MODE=sandbox
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=
```
