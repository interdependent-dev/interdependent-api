import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';
import { publicPhotoUrl } from '../../services/readerService.js';
import { readingPct, isFinishedRead } from '../../lib/readGate.js';
import { getAllReaderXp, fetchXpRows } from '../../services/xpService.js';

// The TOP READERS list — readers who've genuinely finished at least MIN_FINISHED
// screenplays, with what they've read (honest read % = depth AND time) and the
// feedback they've left. Visible to all portal users (same passcode gate).
// ORDERED BY THE XP RUBRIC: the list order IS the XP ranking (totalXp desc), so
// this page can never disagree with /xp/leaderboard — one rubric, one order.
const MIN_FINISHED = 1; // a reader earns a spot once they finish a real read. Tunable.

export async function listTopReaders(req, res, next) {
  try {
    // ONE fetch powers both the XP ranking and the reads/feedback detail. The
    // rows use the XP engine's 365-day event window (fetchXpRows), so the
    // numbers shown here are exactly the ones the ranking was computed from.
    const rows = await fetchXpRows();
    const { readers, events, champions, feedback, scripts } = rows;
    const xpList = await getAllReaderXp(rows);
    const xpByReaderId = {};
    xpList.forEach((x) => { xpByReaderId[x.readerId] = x; });

    const titleById = {}, pagesById = {};
    scripts.forEach((t) => { titleById[t.id] = t.title; pagesById[t.id] = t.page_count; });

    // (reader, script) pairs the reader has championed — raw board-adds, so the
    // flag mirrors what the reader actually did (XP separately read-gates them).
    const champSet = new Set(champions.map((c) => `${c.reader_id}::${c.script_id}`));
    // (recommender-handle, script) pairs — this reader SENT a recommendation of
    // the script. Attributed exactly like the XP aggregator: the share link
    // carries ?by=<handle> into read_events.recommender (case-insensitive). The
    // legacy `recommendations` table is not written by any current flow, so
    // read_events is the single source here.
    const recSet = new Set();
    for (const e of events) {
      if (e.recommender && e.script_id) {
        recSet.add(`${String(e.recommender).toLowerCase()}::${e.script_id}`);
      }
    }

    // reader_id -> script_id -> { furthest depth, longest active time, last seen }
    const byReader = {};
    for (const e of events) {
      if (e.event_type !== 'read_progress' || !e.reader_id || !e.script_id) continue;
      const rd = byReader[e.reader_id] || (byReader[e.reader_id] = {});
      const sc = rd[e.script_id] || (rd[e.script_id] = { depth: 0, seconds: 0, last: e.ts });
      if (e.depth_pct != null) sc.depth = Math.max(sc.depth, e.depth_pct);
      if (e.seconds != null) sc.seconds = Math.max(sc.seconds, e.seconds);
      if (e.ts > sc.last) sc.last = e.ts;
    }

    // reader_id -> feedback they've left (rows come from the XP fetch — a
    // superset of the fields this display needs)
    const fbByReader = {};
    for (const f of feedback) {
      if (!f.reader_id) continue;
      (fbByReader[f.reader_id] || (fbByReader[f.reader_id] = [])).push({
        title: titleById[f.script_id] || 'Untitled',
        decision: f.champion_verdict || null,
        text: f.text || '',
        transcript: f.transcript && f.transcript !== f.text ? f.transcript : '',
        when: f.created_at,
      });
    }

    const list = readers.map((r) => {
      const rd = byReader[r.id] || {};
      const handleLc = String(r.handle || '').toLowerCase();
      const reads = Object.entries(rd).map(([sid, v]) => ({
        id: sid,                                                // script id → clickable to its detail
        title: titleById[sid] || 'Untitled',
        pct: readingPct(v.depth, v.seconds, pagesById[sid]),   // honest: depth AND time
        pages: pagesById[sid] || null,                          // total pages → render "read / total"
        finished: isFinishedRead(v.depth, v.seconds, pagesById[sid]),
        last: v.last,
        championed: champSet.has(`${r.id}::${sid}`),           // on this reader's board
        recommended: recSet.has(`${handleLc}::${sid}`),        // this reader shared it on
      })).sort((a, b) => (a.last < b.last ? 1 : -1));
      const fb = (fbByReader[r.id] || []).sort((a, b) => (a.when < b.when ? 1 : -1));
      const xp = xpByReaderId[r.id];
      return {
        handle: r.handle,
        name: r.display_name || r.handle,
        photoUrl: publicPhotoUrl(r.photo_path),
        joinedAt: r.created_at || null,
        staff: env.adminHandles.has(handleLc),   // team member (ADMIN_HANDLES)
        totalXp: xp ? xp.totalXp : 0,            // the ordering key — no second call needed
        recsLanded: xp ? xp.raw.recsLanded : 0,  // first tie-break (exposed for transparency)
        reads,
        scriptsRead: reads.length,
        finished: reads.filter((x) => x.finished).length,
        feedback: fb,
      };
    })
      .filter((r) => r.finished >= MIN_FINISHED)   // only readers who've earned a spot
      .sort((a, b) => b.totalXp - a.totalXp || b.recsLanded - a.recsLanded || b.finished - a.finished);

    res.json({ readers: list });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
}
