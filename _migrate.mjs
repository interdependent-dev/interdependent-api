// Consolidation migration. DRY-RUN by default; set APPLY=1 to execute.
// Safe order: move reads/feedback -> merge leaderboards -> (Amell) move passkeys -> delete empty old readers.
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.env.APPLY === '1';

const IDS = {
  MACIE_NEW:    '14d7edf1-7464-450b-9026-3f9d16e60bf5',
  CHRIS_SRC:    '223cec67-b9a2-4f62-be95-b9de1e88110d', // renamed-Macie shared acct (handle chris-amell)
  CHRIS_TARGET: '26631cb2-b7ab-4a17-a425-66b794f0e923', // christopher-amell
  CGILBERT:     '6c0ef5c7-d831-4e03-8e24-d33e271ec40a', // christophergilbert-amell
  ZACH_NEW:     'a586a8c1-c12d-430a-b993-89e8776dbf37',
  ZACH_OLD1:    'ee458813-4d71-4fa1-9fb4-8b17eba128f0', // zachary-baskin-old
  ZACH_OLD2:    'afcad5a9-91c3-4cd5-8b45-00f9c43183e8', // zach-baskin
};
const SESSION_A = 's_5hj3es6aupcmqqr1wg7';

const { data: scriptRows } = await db.from('scripts').select('id,title');
const title = {}; (scriptRows||[]).forEach(s=>title[s.id]=s.title);
const t = id => title[id] || `(unknown ${String(id).slice(0,8)})`;

const exists = async id => !!(await db.from('readers').select('id').eq('id', id).maybeSingle()).data;
const credCount = async id => (await db.from('reader_credentials').select('*',{count:'exact',head:true}).eq('reader_id', id)).count;
const evCount = async (id, session) => {
  let q = db.from('read_events').select('*',{count:'exact',head:true}).eq('reader_id', id);
  if (session) q = q.eq('session_id', session);
  return (await q).count;
};
const lbRows = async id => (await db.from('reader_leaderboard').select('script_id,position').eq('reader_id', id).order('position')).data || [];

function mergeLB(target, sources) {
  const seen = new Set(); const merged = [];
  const add = rows => rows.slice().sort((a,b)=>a.position-b.position).forEach(r=>{ if(!seen.has(r.script_id)){seen.add(r.script_id);merged.push(r.script_id);} });
  add(target); sources.forEach(add);
  return merged.map((script_id,i)=>({script_id, position:i+1}));
}

const log = (...a)=>console.log(...a);
log(`\n=== MIGRATION ${APPLY ? '(APPLY — writing)' : '(DRY RUN — no writes)'} ===`);

// ---- guard ----
for (const [k,id] of [['MACIE_NEW',IDS.MACIE_NEW],['ZACH_NEW',IDS.ZACH_NEW]]) {
  if (!(await exists(id))) { console.error(`ABORT: ${k} reader ${id} not found`); process.exit(1); }
  const c = await credCount(id);
  if (!c) { console.error(`ABORT: ${k} has 0 passkeys — not safely registered`); process.exit(1); }
  log(`guard ok: ${k} exists with ${c} passkey(s)`);
}

const move = async (table, from, to, session) => {
  let sel = db.from(table).select('id', {count:'exact'}).eq('reader_id', from);
  if (session) sel = sel.eq('session_id', session);
  const n = (await sel).count || 0;
  if (APPLY && n) {
    let upd = db.from(table).update({ reader_id: to }).eq('reader_id', from);
    if (session) upd = upd.eq('session_id', session);
    const { error } = await upd; if (error) throw new Error(`${table} move ${from}->${to}: ${error.message}`);
  }
  log(`  ${APPLY?'moved':'would move'} ${n} ${table} : ${from.slice(0,8)}${session?` [${session.slice(0,10)}…]`:''} -> ${to.slice(0,8)}`);
  return n;
};

// ---- Phase 1: Macie's Session A reads ----
log(`\n[1] Macie — Session A reads (chris-amell -> macie-meredith)`);
await move('read_events', IDS.CHRIS_SRC, IDS.MACIE_NEW, SESSION_A);

// ---- Phase 2: Amell consolidation into christopher-amell ----
log(`\n[2] Amell consolidation -> christopher-amell`);
if (await exists(IDS.CHRIS_SRC) || await exists(IDS.CGILBERT)) {
  await move('read_events', IDS.CHRIS_SRC, IDS.CHRIS_TARGET);     // remaining = Session B
  await move('read_events', IDS.CGILBERT, IDS.CHRIS_TARGET);
  await move('reader_feedback', IDS.CHRIS_SRC, IDS.CHRIS_TARGET);
  await move('reader_feedback', IDS.CGILBERT, IDS.CHRIS_TARGET);
  // leaderboard merge
  const mergedA = mergeLB(await lbRows(IDS.CHRIS_TARGET), [await lbRows(IDS.CHRIS_SRC), await lbRows(IDS.CGILBERT)]);
  log(`  leaderboard -> ${mergedA.map(r=>`${r.position}.${t(r.script_id)}`).join('  ')}`);
  if (APPLY) {
    await db.from('reader_leaderboard').delete().eq('reader_id', IDS.CHRIS_TARGET);
    if (mergedA.length) { const { error } = await db.from('reader_leaderboard').insert(mergedA.map(r=>({reader_id:IDS.CHRIS_TARGET, script_id:r.script_id, position:r.position}))); if (error) throw new Error(`Amell LB insert: ${error.message}`); }
  }
  // move passkeys (KEEP for Chris)
  await move('reader_credentials', IDS.CHRIS_SRC, IDS.CHRIS_TARGET);
  await move('reader_credentials', IDS.CGILBERT, IDS.CHRIS_TARGET);
  // delete now-empty source readers
  if (APPLY) { const { error } = await db.from('readers').delete().in('id', [IDS.CHRIS_SRC, IDS.CGILBERT]); if (error) throw new Error(`Amell reader delete: ${error.message}`); }
  log(`  ${APPLY?'deleted':'would delete'} empty readers: chris-amell, christophergilbert-amell`);
} else log('  (sources already gone — skipped)');

// ---- Phase 3: Zach consolidation into fresh zachary-baskin ----
log(`\n[3] Zach consolidation -> zachary-baskin (old passkeys deleted via reader delete)`);
if (await exists(IDS.ZACH_OLD1) || await exists(IDS.ZACH_OLD2)) {
  await move('read_events', IDS.ZACH_OLD1, IDS.ZACH_NEW);
  await move('read_events', IDS.ZACH_OLD2, IDS.ZACH_NEW);
  await move('reader_feedback', IDS.ZACH_OLD1, IDS.ZACH_NEW);
  await move('reader_feedback', IDS.ZACH_OLD2, IDS.ZACH_NEW);
  const mergedZ = mergeLB(await lbRows(IDS.ZACH_NEW), [await lbRows(IDS.ZACH_OLD1), await lbRows(IDS.ZACH_OLD2)]);
  log(`  leaderboard -> ${mergedZ.map(r=>`${r.position}.${t(r.script_id)}`).join('  ')}`);
  if (APPLY) {
    await db.from('reader_leaderboard').delete().eq('reader_id', IDS.ZACH_NEW);
    if (mergedZ.length) { const { error } = await db.from('reader_leaderboard').insert(mergedZ.map(r=>({reader_id:IDS.ZACH_NEW, script_id:r.script_id, position:r.position}))); if (error) throw new Error(`Zach LB insert: ${error.message}`); }
  }
  // delete old readers -> cascades their passkeys (Chris approved deleting Zach's old passkeys)
  if (APPLY) { const { error } = await db.from('readers').delete().in('id', [IDS.ZACH_OLD1, IDS.ZACH_OLD2]); if (error) throw new Error(`Zach reader delete: ${error.message}`); }
  log(`  ${APPLY?'deleted':'would delete'} old readers + their passkeys: zachary-baskin-old, zach-baskin`);
} else log('  (sources already gone — skipped)');

log(`\n=== ${APPLY ? 'APPLY COMPLETE' : 'DRY RUN COMPLETE — re-run with APPLY=1'} ===`);
