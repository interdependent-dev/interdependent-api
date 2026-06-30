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
import { feedbackXpForRow, EARLY_CHAMPION_RANK } from './xpConfig.js';

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
    const s = m[key] || (m[key] = { opened: false, depth: 0, seconds: 0, script: e.script_id, readerId: null });
    if (e.event_type === 'recommend_open' || e.event_type === 'script_view' || e.event_type === 'reader_open') s.opened = true;
    if (e.event_type === 'read_progress') {
      if (e.depth_pct != null) s.depth = Math.max(s.depth, e.depth_pct);
      if (e.seconds != null) s.seconds = Math.max(s.seconds, e.seconds);
    }
    if (e.reader_id && !s.readerId) s.readerId = e.reader_id; // the signed-in reader who opened it (if any)
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

  // Feedback is scored per DISTINCT script (the best/most-thorough row per script),
  // so re-submitting or editing feedback on the same script can't farm XP or inflate
  // the `feedbacks` gate count — idempotent even against any legacy duplicate rows.
  const fbByReader = {};
  (feedback || []).forEach((f) => {
    if (!f.reader_id || !f.script_id) return;
    const xp = feedbackXpForRow({
      dimensions: f.dimensions,
      text: f.text,
      transcript: f.transcript,
      hasVoice: !!f.audio_path,
    });
    const a = fbByReader[f.reader_id] || (fbByReader[f.reader_id] = { byScript: {} });
    a.byScript[f.script_id] = Math.max(a.byScript[f.script_id] || 0, xp);
  });

  const statsByReader = {};
  for (const r of readers || []) {
    const rd = readsByReader[r.id] || {};
    const verifiedReads = Object.entries(rd).filter(([sid, v]) =>
      isFinishedRead(v.depth, v.seconds, pagesById[sid])
    ).length;

    const myChamps = champByReader[r.id] || [];
    // "Early" = among the FIRST few to champion a script (EARLY_CHAMPION_RANK) AND
    // the crowd later validated it (someone else championed after) — a scarce,
    // high-signal pick, not merely "any champion except the most recent one".
    const earlySpots = myChamps.filter((c) => {
      const all = champByScript[c.script_id] || [];
      const earlier = all.filter((o) => o.added_at < c.added_at).length;
      const laterByOther = all.some((o) => o.reader_id !== r.id && o.added_at > c.added_at);
      return earlier < EARLY_CHAMPION_RANK && laterByOther;
    }).length;

    const myFb = fbByReader[r.id] || { byScript: {} };
    const fbScripts = Object.keys(myFb.byScript);
    const fb = {
      count: fbScripts.length,
      xp: fbScripts.reduce((sum, sid) => sum + myFb.byScript[sid], 0),
      scripts: new Set(fbScripts),
    };

    // The Carrier gate: did this reader FINISH the featured script + leave feedback
    // on it? Falls back to "any read / any feedback" when no featured script is set.
    let featuredRead, featuredFeedback;
    if (featuredScriptId) {
      const fr = rd[featuredScriptId];
      featuredRead = fr && isFinishedRead(fr.depth, fr.seconds, pagesById[featuredScriptId]) ? 1 : 0;
      featuredFeedback = fb.scripts.has(featuredScriptId) ? 1 : 0;
    } else {
      // Fail CLOSED: with no featured script resolved, the Carrier-gated event perk
      // is simply unreachable — better than granting "free admission" to any reader.
      featuredRead = 0;
      featuredFeedback = 0;
    }

    // Recommendations are attributed by the reader's stable, unique HANDLE (not the
    // user-settable display_name), so readers can't cross-credit or impersonate.
    const recs = Object.values(recByName[String(r.handle || '').toLowerCase()] || {});
    const recsSent = recs.length;
    const recsOpened = recs.filter((s) => s.opened).length;
    // "Landed" = DISTINCT scripts that a session OTHER than the recommender's own
    // finished — so a burst of forged sessions on one script can't farm the (gated)
    // recsLanded signal, and you can't land your own recommendation.
    const landedScripts = new Set();
    recs.forEach((s) => {
      if (s.readerId && s.readerId === r.id) return;
      if (isFinishedRead(s.depth, s.seconds, pagesById[s.script])) landedScripts.add(s.script);
    });
    const recsLanded = landedScripts.size;
    const myRecScripts = new Set(recs.map((s) => s.script));
    const recsConverted = [...myRecScripts].filter((sid) =>
      (champByScript[sid] || []).some((c) => c.reader_id !== r.id) // championed by someone OTHER than the recommender
    ).length;

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
