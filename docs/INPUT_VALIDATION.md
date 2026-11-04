# User Input Validation Documentation

Document Compression Pipeline · v1.0

## 1. Principle

The frontend validates for **convenience only**. The backend is the sole
authority. Every rule below is enforced server-side on every request, including
requests that arrive via a load balancer retry or a direct API call.

Validation order is deliberate: cheap checks first, expensive parsing last.
A file is never parsed before it has passed every rejection rule.

## 2. Validation Pipeline (upload)

```
1  Authentication          → 401
2  Idempotency-Key lookup  → return prior 202 if seen
3  Quota check (atomic)    → 403 quota_exceeded
4  Multipart shape         → 400
5  Extension allowlist     → 415 rejected
6  Size vs plan + ceiling  → 413 rejected
7  Magic bytes vs ext      → 415 rejected
8  Source-code detection   → 415 rejected
9  PDF script scan         → 415 rejected
10 Office macro/OLE scan   → 415 rejected
11 Archive bomb limits     → 415 rejected
12 Image re-encode         → re-encode, or 415 on failure
13 Stream to storage       → job queued
```

Any failure at steps 4–12 → status `rejected`, a clear reason string, the
partial object deleted, **no quota consumed**.

## 3. File Rules

### 3.1 Extension allowlist

Accepted: `.pdf` `.docx` `.pptx` `.txt` `.md` `.rtf` `.odt`

Explicitly rejected: `.html` `.htm` `.csv` `.xlsx` `.xls` `.docm` `.pptm` `.xlsm`
`.svg` `.png` `.jpg` `.jpeg` `.gif` `.zip` `.rar` `.7z`
`.py` `.js` `.ts` `.sh` `.bat` `.ps1` `.php` `.rb` `.pl` `.exe` `.jar` `.dll` `.so`

No separate image files are accepted in this version. Images are only processed
when embedded inside an accepted document.

### 3.2 Magic bytes

| Extension              | Expected signature                                                     |
| ---------------------- | ---------------------------------------------------------------------- |
| `.pdf`                 | `25 50 44 46` (`%PDF`)                                                 |
| `.docx` `.pptx` `.odt` | `50 4B 03 04` (ZIP) **plus** correct internal structure                |
| `.rtf`                 | `7B 5C 72 74 66` (`{\rtf`)                                             |
| `.txt` `.md`           | no signature; must be valid UTF-8 (or declared encoding), no NUL bytes |

ZIP-based formats are further checked for the expected content types:
`word/document.xml`, `ppt/presentation.xml`, or `mimetype` = ODF.

### 3.3 Size limits

| Plan           | Max file                                                  |
| -------------- | --------------------------------------------------------- |
| Free           | 5 MB                                                      |
| Pro            | 15 MB                                                     |
| Enterprise     | 50 MB                                                     |
| Server ceiling | 50 MB, enforced at the load balancer and again in Express |

Pages are **not** counted. Only size and the job time limit apply.

### 3.4 PDF script scan

Reject if the raw bytes contain any of:
`/JavaScript` `/JS` `/OpenAction` `/AA` `/Launch` `/EmbeddedFile` `/RichMedia` `/XFA`

### 3.5 Office macro and object scan

Reject if the archive contains:
`vbaProject.bin`, `vbaData.xml`, any `oleObject*.bin`, `activeX*.xml`,
`embeddings/*`, or a relationship with `TargetMode="External"`.

### 3.6 Archive bomb limits (DOCX / PPTX / ODT)

| Limit                                          | Value              |
| ---------------------------------------------- | ------------------ |
| Total decompressed size                        | 200 MB             |
| Compression ratio                              | 100:1              |
| Entry count                                    | 5000               |
| Nested archive depth                           | 2                  |
| Path traversal in entry name (`../`, absolute) | reject immediately |

### 3.7 Images inside documents

- SVG rejected outright.
- Every other image re-encoded through `sharp` to strip metadata and payloads.
- Re-encode failure → the image is rejected and the chunk is flagged; the job
  continues and ends `needs_review` if an image entry cannot be produced.
- Image bytes are never written to the output JSON.

## 4. Field Validation

### 4.1 `POST /api/documents` (multipart)

| Field     | Type   | Rules                                                                                  |
| --------- | ------ | -------------------------------------------------------------------------------------- |
| `file`    | binary | required, exactly one, all rules in §3                                                 |
| `subject` | string | optional, trim, max 200 chars, no control chars (`\x00–\x1F`, `\x7F`), plain text only |

Extra fields → `400`. Missing file → `400`.

### 4.2 `PATCH /api/documents/:id`

```json
{ "subject": "Biology" }
```

- `subject` required, string, 1–200 chars after trim, no control characters.
- Any additional property → `400` (strict schema).
- Updates the document record and **every** chunk. Reprocesses nothing.

### 4.3 `PUT /api/me`

```json
{ "university": "University of Colombo" }
```

- Must exactly match an entry in `config/universities.json`, which always
  includes `Other`.
- Any additional property → `400`.

### 4.4 `POST /api/billing/notify`

Form-encoded, validated by PayHere signature **first**, then field types.

| Field                                 | Rule                                               |
| ------------------------------------- | -------------------------------------------------- |
| `merchant_id`                         | must equal configured merchant id                  |
| `order_id`                            | must exist and be unprocessed                      |
| `payhere_amount` / `payhere_currency` | must match the stored order                        |
| `status_code`                         | integer, `2` = success                             |
| `md5sig`                              | verified against merchant secret; mismatch → `400` |

### 4.5 Path and query parameters

- `:id` must be a UUID v4. Non-UUID → `400` before any DB query.
- Unknown query parameters → `400` on strict routes.
- Pagination: `limit` integer 1–100 (default 20), `offset` integer ≥ 0.

## 5. Header Validation

| Header            | Rule                                                           |
| ----------------- | -------------------------------------------------------------- |
| `Authorization`   | `Bearer <token>`, exactly one, verified per `SECURITY.md` §3   |
| `Content-Type`    | `multipart/form-data` for upload, `application/json` elsewhere |
| `Idempotency-Key` | optional, UUID v4, 24 h dedupe window in Redis                 |
| `Content-Length`  | required for upload, must not exceed the ceiling               |

## 6. Language

English only in this version. Non-English content is not rejected at upload but
is flagged in the completeness report, because OCR and compression quality
degrade outside the tested language.

## 7. Error Response Shape

Every rejection returns the same structure so the frontend can render it
without special cases:

```json
{
  "error": {
    "code": "rejected_pdf_script",
    "message": "This PDF contains embedded JavaScript, which is not allowed.",
    "field": "file",
    "jobId": null
  }
}
```

| Code                    | HTTP | Meaning                       |
| ----------------------- | ---- | ----------------------------- |
| `unauthorized`          | 401  | missing or invalid token      |
| `quota_exceeded`        | 403  | no outputs left this month    |
| `file_too_large`        | 413  | over plan or server limit     |
| `rejected_extension`    | 415  | extension not allowed         |
| `rejected_magic_bytes`  | 415  | signature mismatch            |
| `rejected_source_code`  | 415  | executable or source content  |
| `rejected_pdf_script`   | 415  | PDF script marker found       |
| `rejected_macro`        | 415  | macro / OLE / ActiveX found   |
| `rejected_archive_bomb` | 415  | decompression limits exceeded |
| `rejected_svg`          | 415  | SVG not permitted             |
| `validation_failed`     | 400  | field-level schema failure    |
| `rate_limited`          | 429  | too many requests             |

Messages are user-readable and never expose stack traces, file paths, internal
hostnames or SQL.

## 8. Output Handling Rules

- Document text is **never** rendered as HTML anywhere in the frontend.
- No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no `new Function`.
- Table cells rendered as text, even if they contain markup-looking strings.
- Hyperlink targets from documents are displayed as text, not auto-linked.
- Download filename is `{doc_id}.json`, never the user's original filename.

## 9. Required Validation Tests

| Fixture / input                                                        | Expected                         |
| ---------------------------------------------------------------------- | -------------------------------- |
| `simple.txt`, `simple.md`, `typed.pdf`, `headings.docx`, `slides.pptx` | accepted                         |
| `javascript.pdf`                                                       | `rejected_pdf_script`            |
| `macro.docm`                                                           | `rejected_extension`             |
| `script-renamed.py` → `.pdf`                                           | `rejected_magic_bytes`           |
| `exe-renamed.pdf`                                                      | `rejected_magic_bytes`           |
| `svg-with-script.svg`                                                  | `rejected_svg`                   |
| `zip-bomb.docx`                                                        | `rejected_archive_bomb`          |
| `../../etc/passwd` as entry name                                       | `rejected_archive_bomb`          |
| 6 MB file on Free                                                      | `file_too_large`                 |
| subject with `<script>`                                                | accepted as text, rendered inert |
| subject 201 chars                                                      | `validation_failed`              |
| `PATCH` with extra field                                               | `validation_failed`              |
| university not in list                                                 | `validation_failed`              |
| non-UUID `:id`                                                         | `validation_failed`              |
| balance 0                                                              | `quota_exceeded`, nothing stored |
