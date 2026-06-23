import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listReadEvents, getScriptTitles } from '../services/supabaseService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth); // dashboard data is gated, same passcode as the portal

const OPEN = new Set(['script_view', 'reader_open']);

function aggregate(events, scripts) {
  const title = {};
  scripts.forEach((s) => { title[s.id] = s.title; });
  const sessions = new Set();
  const counts = { script_view: 0, reader_open: 0, quick_preview: 0, read_complete: 0, new_tab: 0, download: 0, champion: 0, recommend_open: 0, browse_unlock: 0 };
  const per = {};   // script_id → aggregate
  const rec = {};   // "session::script" that came from a recommendation → funnel state
  const byDay = {};

  for (const e of events) {
    if (e.session_id) sessions.add(e.session_id);
    if (counts[e.event_type] != null) counts[e.event_type]++;
    const scr = e.script_id;
    if (scr) {
      const p = per[scr] || (per[scr] = { sessions: new Set(), opens: 0, depth: {}, completed: new Set(), champions: 0, recommends: 0 });
      if (e.session_id) p.sessions.add(e.session_id);
      if (OPEN.has(e.event_type)) p.opens++;
      if (e.event_type === 'read_progress' && e.depth_pct != null && e.session_id) p.depth[e.session_id] = Math.max(p.depth[e.session_id] || 0, e.depth_pct);
      if (e.event_type === 'read_complete' && e.session_id) p.completed.add(e.session_id);
      if (e.event_type === 'champion') p.champions++;
      if (e.event_type === 'recommend_open') p.recommends++;
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
    if (day) { const d = byDay[day] || (byDay[day] = { reads: 0, champions: 0, recommends: 0 }); if (OPEN.has(e.event_type)) d.reads++; if (e.event_type === 'champion') d.champions++; if (e.event_type === 'recommend_open') d.recommends++; }
  }

  const perScript = Object.entries(per).map(([scr, p]) => {
    const depths = Object.values(p.depth);
    const uniq = p.sessions.size;
    return {
      script_id: scr, title: title[scr] || '(unknown)',
      opens: p.opens, uniqueReaders: uniq,
      avgDepth: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0,
      completionRate: uniq ? Math.round((100 * p.completed.size) / uniq) : 0,
      champions: p.champions, recommends: p.recommends,
    };
  }).sort((a, b) => b.opens - a.opens || b.uniqueReaders - a.uniqueReaders);

  const rs = Object.values(rec);
  const recommendFunnel = {
    total: rs.length,
    opened: rs.filter((r) => r.opened).length,
    read25: rs.filter((r) => r.maxDepth >= 25).length,
    read75: rs.filter((r) => r.maxDepth >= 75).length,
    completed: rs.filter((r) => r.completed).length,
    championed: rs.filter((r) => r.championed).length,
  };
  const byRecommender = {};
  rs.forEach((r) => { const n = r.recommender || '—'; const a = byRecommender[n] || (byRecommender[n] = { recommender: n, sent: 0, opened: 0, completed: 0, championed: 0 }); a.sent++; if (r.opened) a.opened++; if (r.completed) a.completed++; if (r.championed) a.championed++; });

  return {
    totals: {
      scriptViews: counts.script_view, readerOpens: counts.reader_open, quickPreviews: counts.quick_preview,
      completions: counts.read_complete, downloads: counts.download, newTabs: counts.new_tab,
      champions: counts.champion, recommendOpens: counts.recommend_open,
      uniqueReaders: sessions.size, totalEvents: events.length,
    },
    perScript,
    recommendFunnel,
    byRecommender: Object.values(byRecommender).sort((a, b) => b.sent - a.sent),
    overTime: Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

router.get('/summary', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days ?? '90', 10) || 90, 365);
    const sinceISO = new Date(Date.now() - days * 864e5).toISOString();
    const [events, scripts] = await Promise.all([listReadEvents({ sinceISO }), getScriptTitles()]);
    res.json(aggregate(events, scripts));
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
