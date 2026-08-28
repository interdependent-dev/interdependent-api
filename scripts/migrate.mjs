#!/usr/bin/env node
// Versioned migration runner with an applied-migrations ledger.
//
// Applies src/db/migrations/*.sql in lexicographic (= chronological) order and
// records each one in a schema_migrations table. Re-running is a no-op.
//
//   node scripts/migrate.mjs [--dry-run]      apply pending migrations
//   node scripts/migrate.mjs --status         show applied vs pending
//   node scripts/migrate.mjs --mark-applied [name...]
//                                             record migrations in the ledger
//                                             WITHOUT executing them (baseline
//                                             an existing database; no names =
//                                             all pending)
//
// Target (pick one):
//   DATABASE_URL / --db <url>   direct Postgres via psql — used for local dev
//                               and scratch databases. Each migration runs in a
//                               single transaction together with its ledger row.
//   Supabase Management API     the repo's established DDL path (service-role
//                               REST cannot run DDL). Needs a personal access
//                               token in SUPABASE_ACCESS_TOKEN or
//                               ~/.supabase/access-token, and the project ref
//                               from SUPABASE_PROJECT_REF or SUPABASE_URL.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations');
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};
const opt = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v) fail(`${name} requires a value`);
  argv.splice(i, 2);
  return v;
};
function fail(msg) { console.error(`migrate: ${msg}`); process.exit(1); }

const dryRun = flag('--dry-run');
const status = flag('--status');
const markApplied = flag('--mark-applied');
const dbUrl = opt('--db') || process.env.DATABASE_URL || null;
const markNames = argv.splice(0, argv.length); // remaining args = migration names for --mark-applied
if (!markApplied && markNames.length) fail(`unexpected arguments: ${markNames.join(' ')} (names are only valid with --mark-applied)`);

// ---- backends: exec(sql) runs a transactional batch; query(sql) returns rows ----
function sqlLiteral(s) { return `'${s.replace(/'/g, "''")}'`; }

function psqlBackend(url) {
  const redacted = url.replace(/:\/\/([^:@/]+):[^@/]+@/, '://$1:***@');
  const run = (args, input) => {
    const res = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', url, ...args], {
      input, encoding: 'utf8',
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    });
    if (res.error?.code === 'ENOENT') fail('psql not found on PATH (needed for the DATABASE_URL backend)');
    if (res.status !== 0) throw new Error(res.stderr.trim() || `psql exited ${res.status}`);
    return res.stdout;
  };
  return {
    label: `postgres ${redacted}`,
    // --single-transaction wraps the whole stdin script (migration + ledger row).
    exec: async (sql) => { run(['--single-transaction', '-f', '-'], sql); },
    query: async (sql) =>
      JSON.parse(run(['-A', '-t', '-c', `SELECT COALESCE(json_agg(t), '[]'::json) FROM (${sql}) t`])),
  };
}

function managementApiBackend() {
  const tokenFile = join(homedir(), '.supabase', 'access-token');
  const token = process.env.SUPABASE_ACCESS_TOKEN
    || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : null);
  const ref = process.env.SUPABASE_PROJECT_REF
    || process.env.SUPABASE_URL?.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) {
    fail(`no target: set DATABASE_URL (or --db <url>) for direct Postgres, or for the
         Supabase Management API set SUPABASE_ACCESS_TOKEN (or ~/.supabase/access-token)
         plus SUPABASE_PROJECT_REF or SUPABASE_URL`);
  }
  const post = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Management API HTTP ${res.status}: ${text}`);
    return text ? JSON.parse(text) : [];
  };
  return {
    label: `supabase project ${ref} (Management API)`,
    exec: async (sql) => { await post(`BEGIN;\n${sql}\nCOMMIT;`); },
    query: post,
  };
}

// ---- migration discovery ----
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
if (!files.length) fail(`no .sql files found in ${MIGRATIONS_DIR}`);
const checksumOf = (name) =>
  createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, name))).digest('hex');

const backend = dbUrl ? psqlBackend(dbUrl) : managementApiBackend();
console.log(`target: ${backend.label}`);

// ---- ledger state ----
const ledger_exists =
  (await backend.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ledger_exists`))[0]?.ledger_exists === true;

const applied = new Map(); // name -> { checksum, applied_at }
if (ledger_exists) {
  for (const row of await backend.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name')) {
    applied.set(row.name, row);
  }
}

for (const [name, row] of applied) {
  if (!files.includes(name)) console.warn(`warn: ledger lists ${name} but no such file exists`);
  else if (checksumOf(name) !== row.checksum) console.warn(`warn: ${name} changed on disk after being applied (checksum mismatch)`);
}
const pending = files.filter((f) => !applied.has(f));

// ---- commands ----
if (status) {
  for (const f of files) {
    const row = applied.get(f);
    console.log(row ? `applied  ${f}  (${row.applied_at})` : `pending  ${f}`);
  }
  if (!ledger_exists) console.log('(no schema_migrations table yet — nothing has been applied through the runner)');
  process.exit(0);
}

if (markApplied) {
  const targets = markNames.length ? markNames : pending;
  for (const name of targets) {
    if (!files.includes(name)) fail(`unknown migration: ${name}`);
    if (applied.has(name)) { console.log(`already applied  ${name}`); continue; }
    if (dryRun) { console.log(`would mark applied  ${name}`); continue; }
    await backend.exec(`${LEDGER_DDL}
INSERT INTO schema_migrations (name, checksum) VALUES (${sqlLiteral(name)}, ${sqlLiteral(checksumOf(name))});`);
    console.log(`marked applied  ${name}`);
  }
  if (!targets.length) console.log('nothing to mark — ledger is up to date');
  process.exit(0);
}

// default: apply pending in order
if (!pending.length) {
  console.log(`up to date — ${applied.size} migration(s) applied, nothing pending`);
  process.exit(0);
}
for (const name of pending) {
  if (dryRun) { console.log(`would apply  ${name}`); continue; }
  const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
  try {
    await backend.exec(`${LEDGER_DDL}
${sql}
INSERT INTO schema_migrations (name, checksum) VALUES (${sqlLiteral(name)}, ${sqlLiteral(checksumOf(name))});`);
  } catch (err) {
    // The failed migration rolled back whole (its transaction includes the
    // ledger row); everything before it is applied and recorded.
    console.error(`\nFAILED  ${name} — rolled back, later migrations not attempted`);
    fail(err.message);
  }
  console.log(`applied  ${name}`);
}
if (dryRun) console.log(`dry run — ${pending.length} migration(s) would be applied, no changes made`);
