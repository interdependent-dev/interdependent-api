import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listReadEvents, getScriptTitles, getReaders, getChampions } from '../services/supabaseService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth); // dashboard data is gated, same passcode as the portal

const OPEN = new Set(['script_view', 'reader_open']);

function aggregate(events, scripts, readers, champions) {
  const title = {}; scripts.forEach((s) => { title[s.id] = s.title; });
  const rname = {}; readers.forEach((r) => { rname[r.id] = r.display_name || r.handle; });

  const sessions = new Set();
  const counts = { script_view: 0, reader_open: 0, quick_preview: 0, read_complete: 0, new_tab: 0, download: 0, champion: 0, recommend_open: 0, browse_unlock: 0 };
  const per = {};
  const rec = {};
  const byDay = {};
  const readerAct = {};

  for (const e of events) {
    if (e.session_id) sessions.add(e.session_id);
    if (counts[e.event_type] != null) counts[e.event_type]++;
    const scr = e.script_id;
    if (scr) {
      const p = per[scr] || (per[scr] = { sessions: new Set(), opens: 0, depth: {}, completed: new Set(), recommends: 0 });
      if (e.session_id) p.sessions.add(e.session_id);
      if (OPEN.has(e.event_type)) p.opens++;
      if (e.event_type === 'read_progress' && e.depth_pct != null && e.session_id) p.depth[e.session_id] = Math.max(p.depth[e.session_id] || 0, e.depth_pct);
      if (e.event_type === 'read_complete' && e.session_id) p.completed.add(e.session_id);
      if (e.event_type === 'recommend_open') p.recommends++;
    }
    if (e.reader_id) {
      const a = readerAct[e.reader_id] || (readerAct[e.reader_id] = { scripts: new Set(), opens: 0 });
      if (e.script_id) a.scripts.add(e.script_id);
      if (OPEN.has(e.event_type)) a.opens++;
    }
    if (e.recommender || e.source === 'recommend') {
      const k = `${e.session_id}::${scr}`;
      const r = rec[k] || (rec[k] = { opened: false, maxDepth: 0, completed: false, championed: false, recommender: e.recommender || null });
      if (e.event_type === 'recommend_open' || OPEN.has(e.event_type)) r.opened = true;
      if (e.event_type === 'read_progress' && e.depth_pct != null) r.maxDepth = Math.max(r.maxDepth, e.depth_pct);
      if (e.event_type === 'read_complete') r.completed = true;
      if (e.event_type === 'champion') r.championed = true;
    }
    const day = (e.ts || '').slice(0, 10);
    if (day) { const d = byDay[day] || (byDay[day] = { reads: 0, champions: 0, recommends: 0 }); if (OPEN.has(e.event_type)) d.reads++; if (e.event_type === 'recommend_open') d.recommends++; }
  }

  // champions come from reader_leaderboard (authoritative), not the best-effort event
  const champByScript = {};
  champions.forEach((c) => { (champByScript[c.script_id] || (champByScript[c.script_id] = [])).push(c); });
  champions.forEach((c) => { const day = (c.added_at || '').slice(0, 10); if (day && byDay[day]) byDay[day].champions++; });
  const championList = champions.map((c) => ({ script_id: c.script_id, title: title[c.script_id] || '(unknown)', reader: rname[c.reader_id] || 'A reader', addedAt: c.added_at }))
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));

  const scriptIds = new Set([...Object.keys(per), ...Object.keys(champByScript)]);
  const perScript = [...scriptIds].map((scr) => {
    const p = per[scr] || { sessions: new Set(), opens: 0, depth: {}, completed: new Set(), recommends: 0 };
    const depths = Object.values(p.depth);
    const uniq = p.sessions.size;
    return {
      script_id: scr, title: title[scr] || '(unknown)',
      opens: p.opens, uniqueReaders: uniq,
      avgDepth: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0,
      completionRate: uniq ? Math.round((100 * p.completed.size) / uniq) : 0,
      champions: (champByScript[scr] || []).length, recommends: p.recommends,
    };
  }).sort((a, b) => b.opens - a.opens || b.champions - a.champions || b.uniqueReaders - a.uniqueReaders);

  const rs = Object.values(rec);
  const recommendFunnel = {
    total: rs.length, opened: rs.filter((r) => r.opened).length,
    read25: rs.filter((r) => r.maxDepth >= 25).length, read75: rs.filter((r) => r.maxDepth >= 75).length,
    completed: rs.filter((r) => r.completed).length, championed: rs.filter((r) => r.championed).length,
  };
  const byRecommender = {};
  rs.forEach((r) => { const n = r.recommender || '—'; const a = byRecommender[n] || (byRecommender[n] = { recommender: n, sent: 0, opened: 0, completed: 0, championed: 0 }); a.sent++; if (r.opened) a.opened++; if (r.completed) a.completed++; if (r.championed) a.championed++; });

  const readerList = readers.map((r) => ({
    reader_id: r.id, name: r.display_name || r.handle,
    championed: champions.filter((c) => c.reader_id === r.id).length,
    scriptsRead: readerAct[r.id] ? readerAct[r.id].scripts.size : 0,
    opens: readerAct[r.id] ? readerAct[r.id].opens : 0,
  })).filter((r) => r.championed > 0 || r.scriptsRead > 0).sort((a, b) => b.championed - a.championed || b.scriptsRead - a.scriptsRead);

  return {
    totals: {
      scriptViews: counts.script_view, readerOpens: counts.reader_open, quickPreviews: counts.quick_preview,
      completions: counts.read_complete, downloads: counts.download, newTabs: counts.new_tab,
      champions: champions.length, recommendOpens: counts.recommend_open,
      uniqueReaders: sessions.size, totalEvents: events.length,
    },
    perScript, recommendFunnel,
    byRecommender: Object.values(byRecommender).sort((a, b) => b.sent - a.sent),
    champions: championList,
    readers: readerList,
    overTime: Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

// Per-script drill-down: every reader/session that engaged, how deep, champions, recommenders, timeline.
function scriptDetail(id, events, scripts, readers, champions) {
  const title = (scripts.find((s) => s.id === id) || {}).title || '(unknown)';
  const rname = {}; readers.forEach((r) => { rname[r.id] = r.display_name || r.handle; });

  const sess = {};
  for (const e of events) {
    if (!e.session_id) continue;
    const s = sess[e.session_id] || (sess[e.session_id] = { session: e.session_id.slice(0, 10), reader: null, maxDepth: 0, opened: false, finished: false, championed: false, recommender: null, source: e.source || null, last: e.ts, first: e.ts, events: 0 });
    s.events++;
    if (e.reader_id) s.reader = rname[e.reader_id] || 'A reader';
    if (e.recommender) s.recommender = e.recommender;
    if (OPEN.has(e.event_type)) s.opened = true;
    if (e.event_type === 'read_progress' && e.depth_pct != null) s.maxDepth = Math.max(s.maxDepth, e.depth_pct);
    if (e.event_type === 'read_complete') { s.finished = true; s.maxDepth = Math.max(s.maxDepth, 100); }
    if (e.event_type === 'champion') s.championed = true;
    if (e.ts > s.last) s.last = e.ts;
  }
  const readerRows = Object.values(sess)
    .map((s) => ({ name: s.reader || 'Anonymous reader', identified: !!s.reader, maxDepth: s.maxDepth, opened: s.opened, finished: s.finished, championed: s.championed, recommender: s.recommender, last: s.last, events: s.events }))
    .sort((a, b) => (a.last < b.last ? 1 : -1));

  const champs = champions.filter((c) => c.script_id === id)
    .map((c) => ({ reader: rname[c.reader_id] || 'A reader', addedAt: c.added_at }))
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));

  const recBy = {};
  readerRows.forEach((s) => { if (s.recommender) { const a = recBy[s.recommender] || (recBy[s.recommender] = { recommender: s.recommender, sent: 0, opened: 0, finished: 0, championed: 0 }); a.sent++; if (s.opened) a.opened++; if (s.finished) a.finished++; if (s.championed) a.championed++; } });

  const timeline = events.slice(-50).reverse().map((e) => ({
    ts: e.ts, type: e.event_type,
    who: e.reader_id ? (rname[e.reader_id] || 'A reader') : (e.source === 'recommend' ? 'Guest (recommended)' : 'Anonymous'),
    recommender: e.recommender, depth: e.depth_pct,
  }));

  return {
    title,
    summary: {
      sessions: readerRows.length,
      opens: events.filter((e) => OPEN.has(e.event_type)).length,
      finished: readerRows.filter((s) => s.finished).length,
      champions: champs.length,
      avgDepth: readerRows.length ? Math.round(readerRows.reduce((a, s) => a + s.maxDepth, 0) / readerRows.length) : 0,
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
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

router.get('/script/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const [events, scripts, readers, champions] = await Promise.all([
      listReadEvents({ scriptId: id }), getScriptTitles(), getReaders(), getChampions(),
    ]);
    res.json(scriptDetail(id, events, scripts, readers, champions));
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
