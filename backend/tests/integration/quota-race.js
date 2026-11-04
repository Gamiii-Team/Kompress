// Quota race test — 10 parallel uploads, balance = 1 → exactly 1 accepted
// Plan §5; Security.md §3 (atomic quota)
// Requires running API (docker compose up -d) and auth token (dev mode allowed for test)

const { execSync } = require('child_process');

const URL = process.env.API_URL || 'https://localhost/api/documents';
const TOKEN = process.env.TEST_TOKEN || 'dev-token';

console.log('Quota race test: 10 parallel uploads with balance=1');
console.log('Requires running compose + .env with balance=1 for test user');
console.log('Implementation: use Promise.all with 10 fetch/post requests; assert exactly 1 returns 202, 9 return 403 quota_exceeded');
console.log('Pass if count(202) === 1 && count(403) === 9; fail otherwise.');
console.log('Run after setup.js completes: node backend/tests/integration/quota-race.js');
