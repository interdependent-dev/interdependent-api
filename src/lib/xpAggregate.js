// ─────────────────────────────────────────────────────────────────────────────
// Pure aggregation: raw rows (read_events, reader_feedback, reader_leaderboard)
// → per-reader `stats`. No DB, no Express — imports only the read gate and the
// XP config, so it is unit-testable in isolation (test/xp.test.js).
//
// TRUSTWORTHY READS: read XP is only credited from read_events that carry a
// reader_id (a signed-in reader was present) AND meet the canonical finish gate
// (readingPct ≥ 85 — depth AND time). The spoofable anonymous POST /events
// traffic earns nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { isFinishedRead } from './readGate.js';
import { feedbackXpForRow } from './xpConfig.js';

// Per (reader, script): furthest depth + longest active time, attributed reads only.
function readsByReaderFromEvents(events) {
  const byReader = {};
  for (const e of events) {
    if (e.event_type !== 'read_progress' || !e.reader_id || !e.script_id) continue;
    const rd = byReader[e.reader_id] || (byReader[e.reader_id] = {});
    const sc = rd[e.script_id] || (rd[e.script_id] = { depth: 0, seconds: 0 });
    if (e.depth_pct != null) sc.depth = Math.max(sc.depth, e.depth_pct);
    if (e.seconds != null) sc.seconds = Math.max(sc.seconds, e.seconds);
  }
  return byReader;
}

// Recommendations are attributed by the recommender's display-name string in
// read_events (the share link carries ?by=<name>). Per (recommender, session,
// script): whether it was opened and how far it was read.
function recsByNameFromEvents(events) {
  const byName = {};
  for (const e of events) {
    if (!e.recommender || !e.script_id) continue;
    const rn = String(e.recommender).toLowerCase();
    const key = `${e.session_id}::${e.script_id}`;
    const m = byName[rn] || (byName[rn] = {});
    const s = m[key] || (m[key] = { opened: false, depth: 0, seconds: 0, script: e.script_id });
    if (e.event_type === 'recommend_open' || e.event_type === 'script_view' || e.event_type === 'reader_open') s.opened = true;
    if (e.event_type === 'read_progress') {
      if (e.depth_pct != null) s.depth = Math.max(s.depth, e.depth_pct);
      if (e.seconds != null) s.seconds = Math.max(s.seconds, e.seconds);
    }
  }
  return byName;
}

// Build per-reader `stats` from raw rows. Pure given its inputs.
//   { readers[], events[], champions[], feedback[], scripts[], featuredScriptId? }
//   → { [readerId]: stats }
// featuredScriptId (The Carrier) gates the event perk: featuredRead/featuredFeedback
// reflect activity on that specific script. If it's null/unknown, they fall back to
// "any read / any feedback" so the perk is never permanently unreachable.
export function aggregateReaderStats({ readers, events, champions, feedback, scripts, featuredScriptId = null }) {
  const pagesById = {};
  (scripts || []).forEach((s) => { pagesById[s.id] = s.page_count; });

  const readsByReader = readsByReaderFromEvents(events || []);
  const recByName = recsByNameFromEvents(events || []);

  const champByReader = {};
  const champByScript = {};
  (champions || []).forEach((c) => {
    (champByReader[c.reader_id] || (champByReader[c.reader_id] = [])).push(c);
    (champByScript[c.script_id] || (champByScript[c.script_id] = [])).push(c);
  });

  const fbByReader = {};
  (feedback || []).forEach((f) => {
    if (!f.reader_id) return;
    const xp = feedbackXpForRow({
      dimensions: f.dimensions,
      text: f.text,
      transcript: f.transcript,
      hasVoice: !!f.audio_path,
    });
    const a = fbByReader[f.reader_id] || (fbByReader[f.reader_id] = { count: 0, xp: 0, scripts: new Set() });
    a.count += 1;
    a.xp += xp;
    if (f.script_id) a.scripts.add(f.script_id);
  });

  const statsByReader = {};
  for (const r of readers || []) {
    const rd = readsByReader[r.id] || {};
    const verifiedReads = Object.entries(rd).filter(([sid, v]) =>
      isFinishedRead(v.depth, v.seconds, pagesById[sid])
    ).length;

    const myChamps = champByReader[r.id] || [];
    const earlySpots = myChamps.filter((c) =>
      (champByScript[c.script_id] || []).some((o) => o.reader_id !== r.id && o.added_at > c.added_at)
    ).length;

    const fb = fbByReader[r.id] || { count: 0, xp: 0, scripts: new Set() };

    // The Carrier gate: did this reader FINISH the featured script + leave feedback
    // on it? Falls back to "any read / any feedback" when no featured script is set.
    let featuredRead, featuredFeedback;
    if (featuredScriptId) {
      const fr = rd[featuredScriptId];
      featuredRead = fr && isFinishedRead(fr.depth, fr.seconds, pagesById[featuredScriptId]) ? 1 : 0;
      featuredFeedback = fb.scripts.has(featuredScriptId) ? 1 : 0;
    } else {
      featuredRead = verifiedReads >= 1 ? 1 : 0;
      featuredFeedback = fb.count >= 1 ? 1 : 0;
    }

    const recs = Object.values(recByName[String(r.display_name || r.handle || '').toLowerCase()] || {});
    const recsSent = recs.length;
    const recsOpened = recs.filter((s) => s.opened).length;
    const recsLanded = recs.filter((s) => isFinishedRead(s.depth, s.seconds, pagesById[s.script])).length;
    const myRecScripts = new Set(recs.map((s) => s.script));
    const recsConverted = [...myRecScripts].filter((sid) => (champByScript[sid] || []).length > 0).length;

    statsByReader[r.id] = {
      reader: r,
      verifiedReads,
      feedbacks: fb.count,
      feedbackXp: fb.xp,
      champions: myChamps.length,
      earlySpots,
      recsSent,
      recsOpened,
      recsLanded,
      recsConverted,
      featuredRead,
      featuredFeedback,
      writerLikes: 0, // dormant until the writer surface ships
      investorFollows: 0, // dormant until the investor surface ships
    };
  }
  return statsByReader;
}
