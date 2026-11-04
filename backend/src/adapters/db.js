// DB Adapter — Postgres (shared, stateless nodes use same connection string)
// Section 1 / 2 of plan.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgres://app:changeme@postgres:5432/app",
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => console.error("Postgres pool error:", err));

// Atomic quota decrement — never read-then-write. Must be single statement.
async function decrementQuota(userId, amount = 1) {
  const result = await pool.query(
    `UPDATE users SET monthly_outputs = monthly_outputs - $1, updated_at = NOW()
     WHERE id = $2 AND monthly_outputs >= $1
     RETURNING monthly_outputs, plan`,
    [amount, userId],
  );
  return result.rows[0] || null; // null if not enough balance
}

// Read profile / plan
async function getUser(userKey) {
  const res = await pool.query(
    "SELECT * FROM users WHERE user_key = $1 LIMIT 1",
    [userKey],
  );
  return res.rows[0] || null;
}

async function getDocument(userKey, docId) {
  const res = await pool.query(
    "SELECT * FROM documents WHERE user_id = $1 AND id = $2",
    [userKey, docId],
  );
  return res.rows[0] || null;
}

async function createDocument(userKey, fileName, originalName, storageKey) {
  const res = await pool.query(
    `INSERT INTO documents (user_id, original_name, storage_key, status, created_at)
     VALUES ($1, $2, $3, 'processing', NOW())
     RETURNING id, created_at`,
    [userKey, originalName, storageKey],
  );
  return res.rows[0];
}

async function updateDocumentStatus(
  docId,
  status,
  outputPath = null,
  outputCount = 0,
) {
  await pool.query(
    `UPDATE documents SET status = $1, output_path = COALESCE($2, output_path), output_count = COALESCE($3, output_count), updated_at = NOW() WHERE id = $4`,
    [status, outputPath, outputCount, docId],
  );
}

// Job tracking
async function createJob(docId, stage = "queued") {
  const res = await pool.query(
    `INSERT INTO jobs (document_id, stage, created_at) VALUES ($1, $2, NOW()) RETURNING id`,
    [docId, stage],
  );
  return res.rows[0].id;
}

async function getJob(jobId) {
  const res = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  return res.rows[0] || null;
}

async function updateJob(jobId, stage, meta = null) {
  await pool.query(
    "UPDATE jobs SET stage = $1, meta = COALESCE($2, meta), updated_at = NOW() WHERE id = $3",
    [stage, meta ? JSON.stringify(meta) : null, jobId],
  );
}

// Advisory lock for cron singleton (scheduler)
async function advisoryLock(key) {
  // key should be an integer derived from key name for pg_advisory_xact_lock
  const intKey = require("crypto")
    .createHash("sha256")
    .update(key)
    .digest()
    .readUInt32BE(0);
  await pool.query("SELECT pg_advisory_xact_lock($1)", [intKey]);
  return true;
}

module.exports = {
  pool,
  decrementQuota,
  getUser,
  getDocument,
  createDocument,
  updateDocumentStatus,
  createJob,
  getJob,
  updateJob,
  advisoryLock,
};
