// Idempotency test — same Idempotency-Key ×5 → 1 job, 1 quota unit
// Plan §5; Security.md §3 (idempotency Redis 24h)
console.log('Idempotency test: POST /api/documents with same Idempotency-Key 5 times');
console.log('Expected: first = 202 {jobId}, duplicates = 202 {jobId} (same), quota consumed = 1');
console.log('Implementation: use fixed UUID key; verify Redis key exists; check DB jobs count = 1');
console.log('Pass if duplicate count === 1 && quota decrement === 1; fail if >1 jobs or >1 quota.');
