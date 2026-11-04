// Scheduler — exactly ONE replica; DB advisory lock prevents duplicates
// Section 4 / 1 / 6 of plan.
const db = require('./adapters/db');
const storage = require('./adapters/storage');

async function runMonthlyGrants() {
  // Advisory lock to ensure singleton
  await db.advisoryLock('monthly-grants');
  console.log('Running monthly grants (locked)');
  // In full: query users with plan=free on 1st of month, grant Pro for 30 days or add outputs based on plan rules
  await db.pool.query(`UPDATE users SET monthly_outputs = CASE WHEN plan = 'pro' THEN 10 WHEN plan = 'enterprise' THEN 50 ELSE 3 END WHERE updated_at < NOW() - INTERVAL '30 days'`);
}

async function runRetentionSweep() {
  await db.advisoryLock('retention-sweep');
  console.log('Running retention sweep (locked)');
  // Delete uploads older than 7 days via lifecycle rule + backup sweep
  // Simplified: list objects under uploads/ and delete older than 7d
  // In production, rely on S3 lifecycle rule primarily; this is backup
}

// Simple interval-based scheduler (in production use node-cron or external cron)
function start() {
  const INTERVAL = 60 * 60 * 1000; // 1 hour check
  setInterval(async () => {
    const now = new Date();
    if (now.getDate() === 1 && now.getHours() === 0) await runMonthlyGrants();
    await runRetentionSweep();
  }, INTERVAL);
  console.log('Scheduler started, role=scheduler, singleton with advisory lock');
}

start();
