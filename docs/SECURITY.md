# Security Documentation

Document Compression Pipeline · v1.0 · Owner: Engineering

## 1. Scope

Covers the frontend, load balancer, API nodes, worker nodes, scheduler, data
stores, model integrations, and payment callbacks. Uploaded documents are
treated as hostile input at all times.

## 2. Trust Boundaries

| #   | Boundary        | Crossing             | Controls                                                       |
| --- | --------------- | -------------------- | -------------------------------------------------------------- |
| B1  | Internet → Edge | any request          | Cloudflare WAF, DDoS, TLS 1.2+, geo/rate rules                 |
| B2  | Edge → API      | HTTP                 | JWT verify, Redis rate limit, body size cap, schema validation |
| B3  | API → Storage   | file bytes           | extension + magic bytes + content scan before write            |
| B4  | Worker → Parser | untrusted file       | worker thread, memory cap, timeout, no network                 |
| B5  | Worker → Modal  | sanitized text/image | allowlisted endpoints, re-encoded images, no secrets in prompt |
| B6  | PayHere → API   | webhook              | signature verification, no bearer token, replay protection     |

## 3. Authentication

### Production

- Microsoft Entra ID, multi-tenant, authorization code + PKCE via MSAL React.
- Backend verifies on **every** request: signature against Microsoft JWKS
  (cached, rotated), `aud`, `iss` matching the token's own `tid`, `exp`, `nbf`.
- User key = `tenantId.objectId`. Record created on first successful login.
- Auth is stateless. **No sessions, no sticky sessions at the load balancer.**
- Optional `ALLOWED_TENANTS` allowlist to restrict which universities may sign in.
- Written against generic OIDC (issuer, client id, JWKS URL) so another IdP can
  be added without a rewrite.

### Development

- `AUTH_MODE=dev` enables `POST /api/dev/login`.
- Refuses to boot if `NODE_ENV=production` and `AUTH_MODE=dev`. This is a hard
  startup assertion, not a runtime warning.

### Authorization

- Every document, job, upload and JSON object is owned by a `user_key`.
- Ownership is checked in the query (`WHERE user_id = $1 AND id = $2`), never
  after fetching.
- Another user's resource ID returns **404**, never 403 — no existence oracle.

## 4. Load Balancer Security

| Control             | Setting                                                            |
| ------------------- | ------------------------------------------------------------------ |
| TLS termination     | Traefik (ACME) or Cloudflare / DO LB                               |
| Sticky sessions     | disabled — must remain disabled                                    |
| Max request body    | 52428800 bytes (50 MB), rejected at edge                           |
| Health check        | `GET /api/ready`, 10 s, 3 failures → drain                         |
| Connection draining | 30 s on SIGTERM                                                    |
| Retry policy        | idempotent GET only; **never** retry `POST /api/documents`         |
| Real client IP      | Proxy Protocol / `CF-Connecting-IP`, trusted proxy list configured |
| Dashboard           | Traefik `:8081` bound to `127.0.0.1` only                          |
| Internal services   | Postgres, Redis, SeaweedFS publish **no** public ports             |

Only 80 and 443 are exposed on a production host. If Cloudflare fronts the API,
the firewall permits only Cloudflare IP ranges.

## 5. Upload Security

Full rules in `INPUT_VALIDATION.md`. Summary of enforced rejections:

- Extension not in `.pdf .docx .pptx .txt .md .rtf .odt`
- Magic bytes not matching the claimed extension
- Source code or executable content, regardless of extension
- PDF containing `/JavaScript /JS /OpenAction /AA /Launch /EmbeddedFile /RichMedia /XFA`
- `.docm .pptm .xlsm`, `vbaProject.bin`, OLE objects, ActiveX, external relationships
- SVG in any container
- Archive bomb: decompressed size or compression ratio over cap
- File over the plan's size limit or the 50 MB server ceiling

Every image is re-encoded through an image library before it reaches a model,
stripping metadata and embedded payloads. Rejected uploads are deleted from
storage immediately; nothing partial is retained.

## 6. Parsing Sandbox

- Parsing runs in a `worker_threads` worker, not the request thread.
- `maxOldGenerationSizeMb: 512`, `maxYoungGenerationSizeMb: 128`.
- Wall-clock timeout: 120 s default, 300 s hard maximum.
- No outbound network from the parser except allowlisted model endpoints.
- Scratch directory is per-job, deleted in a `finally` block.
- Timeout or OOM → job `failed`, no quota consumed, scratch wiped.

## 7. Application Hardening

- `helmet` with CSP `default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- HSTS in production only.
- `express.json({ limit: '1mb' })` — JSON bodies are never large.
- CORS: same-origin in the Docker topology. Explicit allowlist if the frontend
  is served from Cloudflare Pages on a different origin.
- All document text rendered as **text nodes**. No `dangerouslySetInnerHTML`,
  no `eval`, no `innerHTML`, no rendering of document-supplied HTML or URLs.
- Links from documents shown as plain text with `rel="noopener noreferrer"` if
  clickable at all.

## 8. Rate Limiting

Backed by Redis so limits are **global across all API nodes**, not per-node.

| Scope                      | Limit                                  |
| -------------------------- | -------------------------------------- |
| Global per IP              | 300 / 15 min                           |
| Auth endpoints             | 20 / 15 min                            |
| `POST /api/documents`      | 20 / hour per user                     |
| `POST /api/billing/notify` | 60 / min per source, signature-checked |
| Job polling                | 1 / second per job per user            |

Exceeding a limit returns `429` with `Retry-After`.

## 9. Multi-Node Correctness (security-relevant)

| Risk                            | Control                                                |
| ------------------------------- | ------------------------------------------------------ |
| Double quota spend on LB retry  | `Idempotency-Key` → Redis, 24 h TTL                    |
| Quota race across nodes         | single atomic `UPDATE ... WHERE balance > 0 RETURNING` |
| Duplicate monthly grant         | scheduler singleton + Postgres advisory lock           |
| Duplicate retention sweep       | same advisory lock pattern                             |
| Job duplication on worker crash | BullMQ stalled-job recovery + idempotent output write  |

## 10. Secrets

- Environment variables only. Never in the image, never in git, never in logs.
- `.env` is gitignored and `chmod 600` on hosts.
- Production prefers Docker secrets or the platform secret store.
- Secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `LLM_API_KEY`, `PAYHERE_MERCHANT_SECRET`.
- Rotation: quarterly, and immediately on suspected compromise.
- CI runs secret scanning on every push.

## 11. Logging

Structured JSON via Pino. **Included:** request id, user key, job id, document id,
route, status, duration, error code, node instance id.
**Never included:** document text, extracted text, condensed text, tokens, API
keys, passwords, full request bodies, payment card data.
Logs retained 30 days.

## 12. Payments

- `POST /api/billing/notify` requires no bearer token and is trusted **only**
  after PayHere signature verification.
- Signature computed with the merchant secret; mismatch → `400`, no state change.
- Replay protection on `order_id`; a processed order is never processed twice.
- Plan and balance change only inside a transaction.
- Sandbox tested for success, failure and cancellation before go-live.

## 13. Dependency & Build Security

- `npm audit --audit-level=high` fails CI.
- Lockfile committed; `npm ci` in Docker.
- Multi-stage build; runtime image has no dev dependencies, no build tools.
- Container runs as non-root `app` user, `no-new-privileges:true`.
- Base images pinned and refreshed monthly.
- Model licences checked before deployment (recorded in `MODEL_ADAPTERS.md`).

## 14. Incident Response

1. Detect via alert (error rate, 5xx, auth failures, budget spike).
2. Contain: drain the affected node, or disable the affected integration.
3. Rotate all potentially exposed secrets.
4. Preserve logs and evidence before restarting.
5. Assess data exposure per `DATA_PROTECTION.md`.
6. Notify affected users and, where legally required, the regulator.
7. Post-incident review within 5 working days; add a regression test.

## 15. Verification Checklist

- [ ] All malicious fixtures rejected
- [ ] Cross-user access returns 404
- [ ] `AUTH_MODE=dev` refuses to boot in production
- [ ] Rate limit holds across 2 API nodes
- [ ] Quota race test: 10 parallel, balance 1 → exactly 1 accepted
- [ ] Node killed mid-traffic → no 5xx after one health interval
- [ ] No internal service reachable from the public internet
- [ ] No document text in any log line
