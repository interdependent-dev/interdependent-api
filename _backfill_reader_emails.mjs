// Backfill recovery emails for the readers who registered before the email
// field existed. DRY-RUN by default; set APPLY=1 to write.
//   Preview:  node --env-file=.env _backfill_reader_emails.mjs
//   Apply:    APPLY=1 node --env-file=.env _backfill_reader_emails.mjs
//
// Fill in the addresses below (leave blank to skip a reader). Until a reader has
// an email on file, account recovery is unavailable to them.
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.env.APPLY === '1';

const EMAILS = {
  'christopher-amell': '',   // Chris
  'macie-meredith':    '',   // Macie
  'zachary-baskin':    '',   // Zach
};

const norm = (e) => String(e || '').trim().toLowerCase();
console.log(`\n=== Backfill reader emails ${APPLY ? '(APPLY — writing)' : '(DRY RUN)'} ===`);

for (const [handle, raw] of Object.entries(EMAILS)) {
  const email = norm(raw);
  const { data: reader, error } = await db.from('readers').select('id, handle, email').eq('handle', handle).maybeSingle();
  if (error) { console.log(`  ? ${handle}: lookup error ${error.message}`); continue; }
  if (!reader) { console.log(`  ✗ ${handle}: no such reader`); continue; }
  if (!email) { console.log(`  – ${handle}: (no email provided — skipped; current: ${reader.email || 'none'})`); continue; }
  if (norm(reader.email) === email) { console.log(`  = ${handle}: already ${email}`); continue; }

  if (APPLY) {
    const { error: uerr } = await db.from('readers').update({ email }).eq('id', reader.id);
    console.log(uerr ? `  ✗ ${handle}: ${uerr.message}` : `  ✓ ${handle}: set -> ${email}`);
  } else {
    console.log(`  → ${handle}: would set -> ${email} (was: ${reader.email || 'none'})`);
  }
}

console.log(`\n=== ${APPLY ? 'DONE' : 'DRY RUN COMPLETE — fill EMAILS, then APPLY=1'} ===`);
