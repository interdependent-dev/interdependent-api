// READ-ONLY: current state of the accounts involved in the 2026-06 account
// migration (handles, passkeys, read_events, leaderboard rows). Safe to re-run
// any time; writes nothing.
//   node --env-file=.env scripts/_state.mjs
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const handles = ['macie-meredith','chris-amell','christopher-amell','christophergilbert-amell','zachary-baskin','zachary-baskin-old','zach-baskin'];
const { data: readers } = await db.from('readers').select('id,handle,display_name,created_at').in('handle', handles).order('created_at');

for (const r of readers) {
  const { count: ev } = await db.from('read_events').select('*',{count:'exact',head:true}).eq('reader_id', r.id);
  const { count: fb } = await db.from('reader_feedback').select('*',{count:'exact',head:true}).eq('reader_id', r.id);
  const { data: creds } = await db.from('reader_credentials').select('credential_id,device_type,backed_up,created_at,last_used_at').eq('reader_id', r.id);
  const { data: lb } = await db.from('reader_leaderboard').select('script_id,position').eq('reader_id', r.id).order('position');
  console.log(`\n• ${r.display_name}  [${r.handle}]  id=${r.id}  created=${r.created_at}`);
  console.log(`  read_events=${ev}  feedback=${fb}  passkeys=${creds?.length||0}  leaderboard=${lb?.length||0}`);
  for (const c of creds||[]) console.log(`    cred ${c.credential_id.slice(0,12)}… ${c.device_type} backedUp=${c.backed_up} created=${c.created_at} lastUsed=${c.last_used_at??'never'}`);
}

// session ids on the chris-amell (renamed-Macie) account
const chris = readers.find(r=>r.handle==='chris-amell');
if (chris) {
  const { data: evs } = await db.from('read_events').select('session_id').eq('reader_id', chris.id);
  const counts = {}; (evs||[]).forEach(e=>{const s=e.session_id||'(none)'; counts[s]=(counts[s]||0)+1;});
  console.log(`\nchris-amell sessions:`, counts);
}
