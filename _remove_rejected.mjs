import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { basename } from 'path';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.env.APPLY === '1';
const DIR = '/Users/camell/Documents/interdependent-web/backups/rejected-2026-06-28';
mkdirSync(`${DIR}/pdfs`, { recursive: true });

const { data: rows } = await db.from('scripts').select('*').eq('status','rejected').order('submitted_at');
console.log(`Rejected submissions: ${rows.length}`);
writeFileSync(`${DIR}/rows.json`, JSON.stringify(rows, null, 2));

// Back up cascading read_events.
const ids = rows.map(r => r.id);
const { data: events } = await db.from('read_events').select('*').in('script_id', ids);
writeFileSync(`${DIR}/read_events.json`, JSON.stringify(events, null, 2));
console.log(`Backed up: rows.json (${rows.length}) + read_events.json (${events?.length||0})`);

// Download each PDF locally before we delete it from storage.
let dl = 0;
for (const s of rows) {
  if (!s.storage_path) { console.log(`  (no storage_path) ${s.id}`); continue; }
  const { data: blob, error } = await db.storage.from('scripts').download(s.storage_path);
  if (error) { console.log(`  ✗ download ${s.id}: ${error.message}`); continue; }
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(`${DIR}/pdfs/${s.id}__${basename(s.storage_path)}`, buf);
  dl++;
}
console.log(`Downloaded ${dl}/${rows.length} PDFs -> ${DIR}/pdfs/`);

if (!APPLY) { console.log('\nDRY RUN — backups written, nothing deleted. Re-run with APPLY=1.'); process.exit(0); }

// Delete storage objects.
const paths = rows.map(r => r.storage_path).filter(Boolean);
const { data: removed, error: sErr } = await db.storage.from('scripts').remove(paths);
console.log(`\nStorage: ${sErr ? 'ERROR '+sErr.message : `removed ${removed?.length||0} object(s)`}`);

// Delete the script rows (cascades read_events).
const { error: dErr } = await db.from('scripts').delete().in('id', ids);
if (dErr) { console.log('Row delete FAILED:', dErr.message); process.exit(1); }

// Verify.
const { count: rejLeft } = await db.from('scripts').select('*',{count:'exact',head:true}).eq('status','rejected');
const { count: evLeft } = await db.from('read_events').select('*',{count:'exact',head:true}).in('script_id', ids);
console.log(`✓ Deleted ${ids.length} rows. Rejected remaining: ${rejLeft}. Orphan read_events for those ids: ${evLeft}.`);
