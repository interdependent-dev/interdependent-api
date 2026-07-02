import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listReadEvents, getScriptTitles, getReaders, getChampions } from '../services/supabaseService.js';
import { getAllReaderXp } from '../services/xpService.js';
import { isFinishedRead } from '../lib/readGate.js';
import { publicConfig } from '../lib/xpConfig.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth); // dashboard data is gated, same passcode as the portal

const OPEN = new Set(['script_view', 'reader_open']);

// A read is judged from DEPTH *and* TIME, never scroll alone — scrolling to the
// bottom of a 100-page script in 30s is a skim, not a read. Two tiers,
// deliberately different:
//   - `finished` — the CANONICAL read gate (lib/readGate.js: min(depth, timePct)
//     ≥ 85 at PACE_SEC_PER_PAGE = 20s/page), the same rule XP, /reads/status and
//     /readers/list apply, so dashboard finished-counts match the economy.
//   - `engaged` — a deliberately SOFTER, dashboard-only interest tier (reached
//     40%+ at a plausible ≥6s/page pace with ≥60s real time). It carries no
//     economy weight and intentionally stays looser than the gate.
function quality(depth, seconds, pages) {
  const d = depth || 0, s = seconds || 0;
  const reachedPages = Math.max(1, (pages || 100) * (d / 100));
  const secPerPage = s / reachedPages;
  const engaged = d >= 40 && s >= 60 && secPerPage >= 6;
  const finished = isFinishedRead(d, s, pages);
  return { engaged, finished, secPerPage: Math.round(secPerPage) };
}
// per (session,script): furthest depth + longest single active-read time
function sessionReads(events) {
  const m = {};
  for (const e of events) {
    if (e.event_type !== 'read_progress' || !e.session_id || !e.script_id) continue;
    const k = `${e.session_id}::${e.script_id}`;
    const r = m[k] || (m[k] = { session: e.session_id, script: e.script_id, depth: 0, seconds: 0 });
    if (e.depth_pct != null) r.depth = Math.max(r.depth, e.depth_pct);
    if (e.seconds != null) r.seconds = Math.max(r.seconds, e.seconds);
  }
  return m;
}

function aggregate(events, scripts, readers, champions) {
  const title = {}, pages = {};
  scripts.forEach((s) => { title[s.id] = s.title; pages[s.id] = s.page_count; });
  const rname = {}; readers.forEach((r) => { rname[r.id] = r.display_name || r.handle; });

  const sessions = new Set();
  const counts = { script_view: 0, reader_open: 0, quick_preview: 0, new_tab: 0, download: 0, recommend_open: 0, browse_unlock: 0 };
  const per = {};
  const byDay = {};
  const readerAct = {};

  for (const e of events) {
    if (e.session_id) sessions.add(e.session_id);
    if (counts[e.event_type] != null) counts[e.event_type]++;
    const scr = e.script_id;
    if (scr) {
      const p = per[scr] || (per[scr] = { sessions: new Set(), opens: 0, recommends: 0 });
      if (e.session_id) p.sessions.add(e.session_id);
      if (OPEN.has(e.event_type)) p.opens++;
      if (e.event_type === 'recommend_open') p.recommends++;
    }
    if (e.reader_id) { const a = readerAct[e.reader_id] || (readerAct[e.reader_id] = { scripts: new Set(), opens: 0 }); if (e.script_id) a.scripts.add(e.script_id); if (OPEN.has(e.event_type)) a.opens++; }
    const day = (e.ts || '').slice(0, 10);
    if (day) { const d = byDay[day] || (byDay[day] = { reads: 0, champions: 0, recommends: 0 }); if (OPEN.has(e.event_type)) d.reads++; if (e.event_type === 'recommend_open') d.recommends++; }
  }

  // read depth + time per (session,script), and the recommendation funnel
  const reads = sessionReads(events);
  const perRead = {};
  let completions = 0;
  const rec = {};
  // index recommend context by session::script for funnel
  const recCtx = {};
  events.forEach((e) => { if ((e.recommender || e.source === 'recommend') && e.script_id) { const k = `${e.session_id}::${e.script_id}`; (recCtx[k] = recCtx[k] || { opened: false, recommender: e.recommender || null }); if (e.event_type === 'recommend_open' || OPEN.has(e.event_type)) recCtx[k].opened = true; } });
  Object.values(reads).forEach((r) => {
    const q = quality(r.depth, r.seconds, pages[r.script]);
    if (q.finished) completions++;
    (perRead[r.script] || (perRead[r.script] = [])).push({ ...r, ...q });
    const k = `${r.session}::${r.script}`;
    if (recCtx[k]) { recCtx[k].depth = r.depth; recCtx[k].seconds = r.seconds; recCtx[k].finished = q.finished; recCtx[k].engaged = q.engaged; }
  });
  Object.entries(recCtx).forEach(([k, c]) => { rec[k] = c; });

  const champByScript = {};
  champions.forEach((c) => { (champByScript[c.script_id] || (champByScript[c.script_id] = [])).push(c); });
  champions.forEach((c) => { const day = (c.added_at || '').slice(0, 10); if (day && byDay[day]) byDay[day].champions++; });
  const championList = champions.map((c) => ({ script_id: c.script_id, title: title[c.script_id] || '(unknown)', reader: rname[c.reader_id] || 'A reader', addedAt: c.added_at }))
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));

  const scriptIds = new Set([...Object.keys(per), ...Object.keys(champByScript), ...Object.keys(perRead)]);
  const perScript = [...scriptIds].map((scr) => {
    const p = per[scr] || { sessions: new Set(), opens: 0, recommends: 0 };
    const rd = perRead[scr] || [];
    const depthAvg = rd.length ? Math.round(rd.reduce((a, r) => a + r.depth, 0) / rd.length) : 0;
    const timeAvg = rd.length ? Math.round(rd.reduce((a, r) => a + r.seconds, 0) / rd.length) : 0;
    return {
      script_id: scr, title: title[scr] || '(unknown)',
      opens: p.opens, uniqueReaders: p.sessions.size,
      reachedAvg: depthAvg, avgSeconds: timeAvg,
      engaged: rd.filter((r) => r.engaged).length, finished: rd.filter((r) => r.finished).length,
      champions: (champByScript[scr] || []).length, recommends: p.recommends,
    };
  }).sort((a, b) => b.opens - a.opens || b.finished - a.finished || b.uniqueReaders - a.uniqueReaders);

  const rs = Object.values(rec);
  const recommendFunnel = {
    total: rs.length, opened: rs.filter((r) => r.opened).length,
    read25: rs.filter((r) => (r.depth || 0) >= 25).length, read75: rs.filter((r) => (r.depth || 0) >= 75).length,
    engaged: rs.filter((r) => r.engaged).length, finished: rs.filter((r) => r.finished).length,
  };
  const byRecommender = {};
  rs.forEach((r) => { const n = r.recommender || '—'; const a = byRecommender[n] || (byRecommender[n] = { recommender: n, sent: 0, opened: 0, engaged: 0, finished: 0 }); a.sent++; if (r.opened) a.opened++; if (r.engaged) a.engaged++; if (r.finished) a.finished++; });

  const readerList = readers.map((r) => ({
    reader_id: r.id, name: r.display_name || r.handle,
    championed: champions.filter((c) => c.reader_id === r.id).length,
    scriptsRead: readerAct[r.id] ? readerAct[r.id].scripts.size : 0,
  })).filter((r) => r.championed > 0 || r.scriptsRead > 0).sort((a, b) => b.championed - a.championed || b.scriptsRead - a.scriptsRead);

  return {
    totals: {
      scriptViews: counts.script_view, readerOpens: counts.reader_open, quickPreviews: counts.quick_preview,
      finishedReads: completions, downloads: counts.download, newTabs: counts.new_tab,
      champions: champions.length, recommendOpens: counts.recommend_open,
      uniqueReaders: sessions.size, totalEvents: events.length,
    },
    perScript, recommendFunnel,
    byRecommender: Object.values(byRecommender).sort((a, b) => b.sent - a.sent),
    champions: championList, readers: readerList,
    overTime: Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

function scriptDetail(id, events, scripts, readers, champions) {
  const sc = scripts.find((s) => s.id === id) || {};
  const title = sc.title || '(unknown)'; const pageCount = sc.page_count;
  const rname = {}; readers.forEach((r) => { rname[r.id] = r.display_name || r.handle; });

  const sess = {};
  for (const e of events) {
    if (!e.session_id) continue;
    const s = sess[e.session_id] || (sess[e.session_id] = { reader: null, depth: 0, seconds: 0, opened: false, recommender: null, last: e.ts, events: 0 });
    s.events++;
    if (e.reader_id) s.reader = rname[e.reader_id] || 'A reader';
    if (e.recommender) s.recommender = e.recommender;
    if (OPEN.has(e.event_type)) s.opened = true;
    if (e.event_type === 'read_progress') { if (e.depth_pct != null) s.depth = Math.max(s.depth, e.depth_pct); if (e.seconds != null) s.seconds = Math.max(s.seconds, e.seconds); }
    if (e.ts > s.last) s.last = e.ts;
  }
  const readerRows = Object.values(sess).map((s) => {
    const q = quality(s.depth, s.seconds, pageCount);
    const verdict = q.finished ? 'finished' : q.engaged ? 'engaged' : s.depth >= 25 ? 'skimmed' : 'opened';
    return { name: s.reader || 'Anonymous reader', depth: s.depth, seconds: s.seconds, verdict, recommender: s.recommender, last: s.last };
  }).sort((a, b) => (a.last < b.last ? 1 : -1));

  const champs = champions.filter((c) => c.script_id === id).map((c) => ({ reader: rname[c.reader_id] || 'A reader', addedAt: c.added_at })).sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  const recBy = {};
  readerRows.forEach((s) => { if (s.recommender) { const a = recBy[s.recommender] || (recBy[s.recommender] = { recommender: s.recommender, sent: 0, opened: 0, engaged: 0, finished: 0 }); a.sent++; if (s.verdict !== 'opened') a.opened++; if (s.verdict === 'engaged' || s.verdict === 'finished') a.engaged++; if (s.verdict === 'finished') a.finished++; } });
  const timeline = events.slice(-50).reverse().map((e) => ({ ts: e.ts, type: e.event_type, who: e.reader_id ? (rname[e.reader_id] || 'A reader') : (e.source === 'recommend' ? 'Guest (recommended)' : 'Anonymous'), depth: e.depth_pct, seconds: e.seconds }));

  return {
    title,
    summary: {
      sessions: readerRows.length,
      opens: events.filter((e) => OPEN.has(e.event_type)).length,
      finished: readerRows.filter((s) => s.verdict === 'finished').length,
      engaged: readerRows.filter((s) => s.verdict === 'engaged' || s.verdict === 'finished').length,
      avgDepth: readerRows.length ? Math.round(readerRows.reduce((a, s) => a + s.depth, 0) / readerRows.length) : 0,
      avgSeconds: readerRows.length ? Math.round(readerRows.reduce((a, s) => a + s.seconds, 0) / readerRows.length) : 0,
    },
    readers: readerRows, champions: champs, recommenders: Object.values(recBy), timeline,
  };
}

router.get('/summary', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days ?? '90', 10) || 90, 365);
    const sinceISO = new Date(Date.now() - days * 864e5).toISOString();
    const [events, scripts, readers, champions] = await Promise.all([
      listReadEvents({ sinceISO }), getScriptTitles(), getReaders(), getChampions(),
    ]);
    res.json(aggregate(events, scripts, readers, champions));
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

router.get('/script/:id', async (req, res, next) => {
  try {
    const [events, scripts, readers, champions] = await Promise.all([
      listReadEvents({ scriptId: req.params.id }), getScriptTitles(), getReaders(), getChampions(),
    ]);
    res.json(scriptDetail(req.params.id, events, scripts, readers, champions));
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

// ── Reader reputation & spotlight ────────────────────────────────────────────
// The full XP engine now lives in services/xpService.js (single source of truth,
// shared with the public bar at /readers/:handle/xp). This endpoint delegates to
// it so the dashboard and the bar can never diverge. Returns every reader's
// scored XP plus the static economy config.
router.get('/readers', async (_req, res, next) => {
  try {
    const readers = await getAllReaderXp();
    res.json({ readers, config: publicConfig() });
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

export default router;
