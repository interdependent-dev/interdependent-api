// READ-ONLY: confirm the email/recovery migration is live before/after deploy.
// Safe to re-run any time; writes nothing.
// Run:  node --env-file=.env scripts/_verify_auth_migration.mjs
//
// NB: uses non-head selects on purpose — a `head:true` request does NOT surface
// PostgREST's PGRST205 "table missing" error, so it gives false positives.
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let ok = true;

// 1. readers.email column exists?
{
  const { error } = await db.from('readers').select('id,email').limit(1);
  if (error) { console.log('✗ readers.email  MISSING —', error.message); ok = false; }
  else console.log('✓ readers.email column present');
}

// 2. reader_recovery_tokens table exists?
{
  const { error } = await db.from('reader_recovery_tokens').select('id,reader_id,token_hash,expires_at,used_at').limit(1);
  if (error) { console.log('✗ reader_recovery_tokens MISSING —', error.message); ok = false; }
  else console.log('✓ reader_recovery_tokens table present');
}

// 3. Which existing readers still need an email backfilled?
if (ok) {
  const { data, error } = await db.from('readers').select('handle,display_name,email').order('created_at');
  if (error) console.log('? readers list error:', error.message);
  else {
    console.log('\nReaders / recovery-email status:');
    for (const r of data) console.log(`  ${r.email ? '✓' : '—'} ${r.handle.padEnd(22)} ${r.email || '(no email — recovery unavailable)'}`);
  }
}

console.log(ok ? '\nMIGRATION OK' : '\nMIGRATION INCOMPLETE — apply src/db/migrations/202606281000_reader_email_recovery.sql via scripts/migrate.mjs');
process.exit(ok ? 0 : 1);
