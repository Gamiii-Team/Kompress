// LB distribution — verify 2 API nodes serve traffic
// Plan §5; must run after docker compose up -d --scale api=2
console.log('LB distribution test: 20 requests to /api/health, read instance field');
console.log('Pass if both container IDs appear; fail if only 1.');
console.log('Manual: for i in $(seq 1 20); do curl -sk https://localhost/api/health | jq -r .instance; done | sort -u | wc -l');
console.log('Expected output: 2 (or more if N>2)');
