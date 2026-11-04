// DB Migration — creates schema for Postgres (replaces SQLite)
// Section 1 / 2 of plan.
const { pool } = require('../adapters/db');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key TEXT UNIQUE NOT NULL,
  email TEXT,
  university TEXT,
  plan TEXT DEFAULT 'free',
  monthly_outputs INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_user_key ON users(user_key);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(user_key),
  original_name TEXT,
  storage_key TEXT,
  status TEXT DEFAULT 'processing',
  output_path TEXT,
  output_count INTEGER DEFAULT 0,
  subject TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  stage TEXT DEFAULT 'queued',
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage);

CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_documents_updated_at();
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('Migration complete — Postgres schema applied');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
