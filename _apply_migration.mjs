// Apply a .sql file to the live DB via the Supabase Management API (runs as the
// postgres superuser, so DDL works). Token from ~/.supabase/access-token.
//   node _apply_migration.mjs src/db/migrations/2026-06-28_reader_email_recovery.sql
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const REF = 'dmbrtmkoopxchzwlnnoz';
const token = readFileSync(join(homedir(), '.supabase', 'access-token'), 'utf8').trim();
const sqlPath = process.argv[2];
if (!sqlPath) { console.error('usage: node _apply_migration.mjs <file.sql>'); process.exit(1); }
const query = readFileSync(sqlPath, 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text || '(empty body — DDL ran with no result rows)');
process.exit(res.ok ? 0 : 1);
