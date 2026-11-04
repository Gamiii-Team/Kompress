# Contributing — Document Compression Pipeline

> Applies to adapters, fixtures, tests, and documentation changes. All contributions must preserve the 3 explicit architecture changes (Postgres, Redis/BullMQ, separate API/Worker) and the 6 hard load-balancing rules.

---

## Before you change anything

1. Confirm which build step (1–16 from `README.md`) your change touches.
2. Confirm it does not break one of the hard rules:
   - API holds zero local state (no session memory, no local disk truth, no in-process queue)
   - Auth is stateless JWT (no sticky sessions)
   - Uploads stream straight to object storage (never sit on API disk)
   - Quota decrement is a single atomic DB statement
   - Cron runs in exactly one place, guarded by DB advisory lock
   - Local disk is scratch only, wiped on restart

3. If you change adapters, preserve swappability (`MinIO↔R2↔S3`, `Postgres↔D1`, `Mock↔Modal`). The adapter layer (`backend/src/adapters/`) is the contract.

---

## Adapter rules (swappable by env only)

| Adapter file | Providers | What must never leak out |
|---|---|---|
| `storage.js` | MinIO / R2 / S3 | Endpoint / keys stay in `.env`; code never references a specific vendor |
| `db.js` | Postgres / D1 (test only) | `DATABASE_URL` only; queries never assume SQLite syntax |
| `queue.js` | BullMQ / Redis | Queue name `document-compression`; `noeviction` policy required for queue DB |
| `model.js` | Mock / Modal HTTP | `LLM_PROVIDER` selects; no hardcoded endpoint URLs in adapter |

If you add a provider, add it to the adapter and `.env.example`, never to `server.js` or `worker.js`.

---

## Fixture conventions

From `docs/INPUT_VALIDATION.md` §9:

- `simple.txt`, `simple.md`, `typed.pdf`, `headings.docx`, `slides.pptx` → accepted
- `javascript.pdf` → `rejected_pdf_script`
- `macro.docm` → `rejected_extension`
- `script-renamed.py` → `.pdf` → `rejected_magic_bytes`
- `exe-renamed.pdf` → `rejected_magic_bytes`
- `svg-with-script.svg` → `rejected_svg`
- `zip-bomb.docx` → `rejected_archive_bomb`
- `../../etc/passwd` as entry name → `rejected_archive_bomb`
- 6 MB on Free → `file_too_large`
- `subject` with `<script>` → accepted (rendered inert), not rejected
- `PATCH` with extra field → `validation_failed`
- `university` not in `config/universities.json` → `validation_failed`
- non-UUID `:id` → `validation_failed`
- balance `0` → `quota_exceeded`, nothing stored

Add fixtures to `backend/tests/fixtures/` and reference them in `docs/INPUT_VALIDATION.md`.

---

## Testing additions (from section 5 of Final Plan)

| Test | Method | Pass condition |
|---|---|---|
| LB distribution | 20 requests, read `instance` | both nodes serve |
| Node failover | `docker stop api_1` mid-traffic | zero 5xx after 1 health interval |
| Rolling deploy | new image with `--scale api=2` | zero dropped requests |
| Upload during drain | SIGTERM API mid-upload | completes or clean 503, never corrupt |
| Quota race | 10 parallel uploads, balance = 1 | exactly 1 accepted |
| Idempotency | same `Idempotency-Key` ×5 | 1 job, 1 quota unit |
| Worker crash | kill worker mid-job | BullMQ requeues; no duplicate output |
| Duplicate cron | 2 schedulers running | advisory lock → grants once |
| Shared rate limit | 2 nodes, 300 req from one IP | limited globally, not 300/node |
| Load test | k6 (`backend/tests/load/upload.js`) | p95 < 500 ms, error < 0.1% |
| Queue backpressure | 200 jobs queued | API stays responsive, no OOM |

Run: `docker compose --profile load run --rm k6` (script lives at `backend/tests/load/upload.js`).

---

## Pull request requirements

- [ ] All 5 doc files (`README.md`, `SECURITY.md`, `CONTRIBUTE.md`, `AGENTS.md`, `CONFIG.md`) updated if touched
- [ ] Adapter changes preserve swappability; no vendor hardcoding
- [ ] Quota logic still atomic (single `UPDATE ... RETURNING`)
- [ ] `AUTH_MODE=dev` startup guard untouched (`NODE_ENV=production` must exit)
- [ ] No new dependencies without `npm audit --audit-level=high` pass
- [ ] Migrations backward-compatible (`migrate.js` non-destructive)
- [ ] `npm ci` works; `Dockerfile` multi-stage (runtime has no dev tools)

---

## Forbidden patterns (will be rejected in review)

- Adding an in-process queue (SQLite file, `setInterval` polling)
- Adding sticky-session support at Traefik / LB
- Adding session memory to API (Redis session store is OK for rate limits only)
- Reading quota with `SELECT`, then writing with `UPDATE` (must be one statement)
- Running more than one scheduler without advisory lock
- Storing document text in logs, metrics, or error messages
- Rendering document content as HTML / `dangerouslySetInnerHTML`
- Including image bytes inside the output JSON
- Unencrypted backups; backups not tested with restore drill
