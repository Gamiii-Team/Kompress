# Data Protection Documentation

Document Compression Pipeline · v1.0

## 1. Purpose

Defines what personal and document data the system holds, where it lives, who
can reach it, how long it survives, and how it is destroyed. Uploaded documents
are student coursework and are treated as **high-sensitivity** by default.

## 2. Data Inventory

| Category          | Examples                                                | Sensitivity | Store                         | Retention              |
| ----------------- | ------------------------------------------------------- | ----------- | ----------------------------- | ---------------------- |
| Identity          | Entra `tid`, `oid`, email, display name                 | Medium      | Postgres                      | until account deletion |
| Profile           | university choice, plan, balance                        | Low         | Postgres                      | until account deletion |
| Uploaded document | the original file                                       | **High**    | Object storage `uploads/`     | **7 days**             |
| Extracted text    | IR blocks, OCR text                                     | **High**    | worker scratch (ephemeral)    | job duration only      |
| Output JSON       | original + condensed layers, tables, image descriptions | **High**    | Object storage `documents/`   | until user deletes     |
| Job metadata      | status, stage, timings, error codes                     | Low         | Postgres                      | 90 days                |
| Payment metadata  | order id, plan, amount, status                          | Medium      | Postgres                      | statutory period       |
| Card data         | —                                                       | —           | **never touches our systems** | n/a                    |
| Logs              | request id, user key, job id, error code                | Medium      | log store                     | 30 days                |
| Backups           | DB dump, object replicas                                | **High**    | encrypted backup bucket       | 30 days rolling        |

**Never collected:** card numbers, CVV, national ID, date of birth, biometrics.
**Never stored:** image bytes in the output JSON, page rasters after the job,
document text in logs.

## 3. Data Minimisation

- Only the identity claims required to key the account are read from the token.
- University is a dropdown choice, not inferred from email or documents.
- Subject is optional; the LLM proposes one only if the user leaves it blank.
- Extracted intermediates live in per-job scratch and are deleted in a
  `finally` block, including on failure.

## 4. Isolation Model

### Storage

```
bucket/
  users/{tenantId}.{objectId}/uploads/{uuid}       ← 7-day TTL
  users/{tenantId}.{objectId}/documents/{docId}.json  ← no TTL
```

- Bucket is **private**. No public read, no public write, no anonymous listing.
- Object keys are random UUIDs. The original filename never appears in a key.
- All access is mediated by the API after an ownership check.
- Presigned URLs, if used, are single-object, ≤ 5 minutes, and issued only after
  the ownership check.

### Database

- Every row carrying user data has `user_id`.
- Ownership enforced in the `WHERE` clause, not in application code after fetch.
- Cross-user access returns `404`.

### Enterprise / school admins

- Admins see **usage counts only**: seats used, outputs consumed, job statuses.
- Admins **never** see student documents, JSON outputs, or extracted text.
- This is enforced by scope in the API, not by hiding UI elements.

## 5. Encryption

### In transit

- TLS 1.2+ everywhere: browser → edge, edge → API, API → Modal, API → PayHere.
- Internal service traffic on a private Docker network or VPC in T2+.
- HSTS enabled in production.

### At rest

| Store                | Mechanism                                                     |
| -------------------- | ------------------------------------------------------------- |
| R2 / S3              | server-side encryption, provider-managed keys                 |
| SeaweedFS (self-host) | encrypted host volume (LUKS) — mandatory, not optional        |
| Postgres (managed)   | provider encryption at rest                                   |
| Postgres (container) | encrypted host volume                                         |
| Backups              | encrypted before upload, key held outside the backup bucket   |
| Redis                | private network only; holds job metadata, not document bodies |

## 6. Retention & Deletion

| Trigger                           | Action                                                            |
| --------------------------------- | ----------------------------------------------------------------- |
| Upload age > 7 days               | object deleted by lifecycle rule; daily scheduler sweep as backup |
| User clicks "delete upload early" | upload deleted immediately, JSON untouched                        |
| User deletes a document           | JSON + any remaining upload + DB rows deleted                     |
| User deletes account              | full cascade, see below                                           |
| Job rejected                      | partial object deleted immediately, nothing retained              |
| Job failed                        | scratch wiped, upload follows the normal 7-day rule               |
| Log age > 30 days                 | rotated out                                                       |
| Backup age > 30 days              | expired                                                           |

### Account deletion cascade

1. Enumerate `users/{userKey}/` and delete every object (uploads + documents).
2. Delete rows: outputs → jobs → documents → payments (retain statutory
   records only, anonymised) → user.
3. Invalidate any cached tokens for that user key.
4. Write an audit record containing the user key hash and timestamp only.
5. Backups containing the data expire within 30 days; this window is disclosed
   in the privacy policy.

Deletion is verified by a test that lists the user prefix afterwards and asserts
zero objects.

## 7. Access Control

| Role         | Can access                                 | Cannot access                |
| ------------ | ------------------------------------------ | ---------------------------- |
| User         | own documents, own JSON, own profile       | anyone else's data           |
| School admin | seat and usage counts for their tenant     | student documents            |
| Operator     | logs, metrics, health, queue depth         | document bodies (not logged) |
| Support      | document metadata on explicit user consent | document bodies by default   |

- No standing admin access to document content.
- Break-glass access requires a ticket, is time-boxed, and is fully audit-logged.
- Database credentials are per-service; the API role cannot `DROP TABLE`.

## 8. Third-Party Processors

| Processor       | Data sent                        | Purpose              | Notes                                |
| --------------- | -------------------------------- | -------------------- | ------------------------------------ |
| Microsoft Entra | auth tokens                      | identity             | no document data                     |
| Modal           | extracted text, sanitized images | inference            | no user identity attached to prompts |
| Cloudflare      | all traffic, stored files        | CDN, WAF, R2 storage |                                      |
| DigitalOcean    | all traffic on droplet           | compute              |                                      |
| PayHere         | name, email, amount, order id    | payment              | card data never reaches us           |

Only the minimum required data leaves the system for each processor. Model
prompts contain document content but **no user identifiers**.

## 9. Model & Prompt Handling

- Text sent to a model is the chunk content only.
- Images are re-encoded before transmission.
- Provider terms must confirm inputs are **not used for training**; this is
  checked and recorded before enabling any provider.
- Model name and prompt version are recorded in the output JSON for
  reproducibility, not the prompt content itself.
- Results are cached by file `sha256` **scoped per user** — never across users.

## 10. Legal & Compliance (Sri Lanka)

- The Personal Data Protection Act, No. 9 of 2022 applies. Confirm current
  obligations with a lawyer before onboarding schools.
- Many users will be **under 18**. Before onboarding a school:
  - obtain the school's **written consent**,
  - confirm the lawful basis for processing minors' data,
  - agree controller / processor roles in writing,
  - confirm the school has authority to consent on students' behalf.
- Publish a Privacy Policy, Terms, and Return Policy before PayHere onboarding
  (PayHere rejects sites without them).
- PayHere is not a merchant of record; tax obligations remain with the business.

## 11. Data Subject Rights

| Right         | Implementation                                       |
| ------------- | ---------------------------------------------------- |
| Access        | `GET /api/documents` + `GET /api/documents/:id/json` |
| Portability   | JSON download, open format, no proprietary wrapper   |
| Rectification | `PATCH /api/documents/:id`, `PUT /api/me`            |
| Erasure       | `DELETE /api/documents/:id`, `DELETE /api/me`        |
| Objection     | account deletion; no marketing processing exists     |

Requests are self-service and take effect immediately, not on a support queue.

## 12. Breach Response

1. Identify scope: which user keys, which objects, which time window.
2. Contain and rotate credentials.
3. Preserve audit logs before any restart.
4. Assess whether document content was exposed.
5. Notify affected users and the regulator within the statutory deadline.
6. Record the incident, root cause, and the regression test added.

## 13. Verification Checklist

- [ ] Upload older than 7 days deleted by sweep; JSON untouched
- [ ] Account deletion leaves zero objects under the user prefix
- [ ] Rejected upload leaves zero objects
- [ ] Output JSON contains no base64 image bytes
- [ ] No document text appears in any log
- [ ] Cross-user read, patch and delete all return 404
- [ ] Bucket denies anonymous listing
- [ ] School admin endpoint returns counts, never content
- [ ] Cache hit for user A never serves user B
- [ ] Backups encrypted and expired at 30 days
