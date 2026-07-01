// ─────────────────────────────────────────────────────────────────────────────
// Reader XP service — the ONE engine that turns raw rows into XP.
//
// It aggregates the authoritative tables (read_events, reader_feedback,
// reader_leaderboard) into per-reader `stats`, then hands them to the pure
// scorer in lib/xpConfig.js. Both the public bar (GET /readers/:handle/xp) and
// the gated dashboard (GET /analytics/readers) call through here, so there is a
// single rubric and the numbers can never diverge.
//
// TRUSTWORTHY READS: read XP is only ever credited from read_events that carry a
// reader_id (i.e. a signed-in reader was present) and only when the canonical
// gate (readingPct ≥ 85 — depth AND time) is met. Anonymous, reader-less events —
// the spoofable public POST /events traffic — earn nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { scoreReader, CREDIT_WEIGHTS, CREDIT_SLOTS_PER_FILM, EARLY_CHAMPION_RANK } from '../lib/xpConfig.js';
import { aggregateReaderStats } from '../lib/xpAggregate.js';
import { isFinishedRead } from '../lib/readGate.js';
import { roleName } from '../lib/roleRegistry.js';
import {
  getReaders,
  listReadEvents,
  getChampions,
  getFeedbackForXp,
  getScriptTitles,
} from './supabaseService.js';
import { getReaderByHandle } from './readerService.js';
import { env } from '../config/env.js';

// Shape one reader's scored XP for the API.
function shapeReader(stats, reader) {
  const scored = scoreReader(stats);
  return {
    readerId: reader.id,
    handle: reader.handle,
    name: reader.display_name || reader.handle,
    // ONE role; the XP number is the identity. The bar shows role + number and a
    // gradient of commitment — no named sub-levels. `levels` are the perk
    // MILESTONES along the bar (thresholds + rewards + gates), not separate roles.
    // Sourced from the role registry (still 'Reader' today) so the OA §16.3
    // roster is the single source of truth, not a bare string literal here.
    role: roleName('reader'),
    // May this reader see AI evaluations + curate? (admin-allowlisted, or reached
    // the Curator XP threshold). Drives the read-first "wall" client-side; the
    // server enforces the SAME rule when stripping evals from /scripts and /share.
    curator: env.adminHandles.has(String(reader.handle || '').toLowerCase()) || scored.totalXp >= env.curatorMinXp,
    totalXp: scored.totalXp,
    barMax: scored.barMax,
    level: scored.level,
    nextLevel: scored.nextLevel,
    levels: scored.levels,
    badges: scored.badges,
    breakdown: scored.breakdown,
    stats: scored.stats,
    raw: {
      verifiedReads: stats.verifiedReads,
      feedbacks: stats.feedbacks,
      champions: stats.champions,
      earlySpots: stats.earlySpots,
      recsSent: stats.recsSent,
      recsOpened: stats.recsOpened,
      recsLanded: stats.recsLanded,
      recsConverted: stats.recsConverted,
    },
  };
}

// Resolve the featured script (The Carrier) that gates the event perk: an
// explicit FEATURED_SCRIPT_ID, else the first script whose title matches
// FEATURED_SCRIPT_TITLE (default "carrier"), else null (gate falls back to
// any-read/any-feedback in the aggregator).
function resolveFeaturedScriptId(scripts) {
  if (process.env.FEATURED_SCRIPT_ID) return process.env.FEATURED_SCRIPT_ID;
  // Substring match (no RegExp → no metacharacter throw on a bad env value), and a
  // deterministic tie-break so the pick is stable when several titles match.
  const needle = String(process.env.FEATURED_SCRIPT_TITLE || 'carrier').toLowerCase();
  const hits = (scripts || []).filter((s) => String(s.title || '').toLowerCase().includes(needle));
  if (!hits.length) return null;
  hits.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return hits[0].id;
}

// The featured (Carrier) script id, for clients that want to open it in ONE
// fetch (e.g. the site's Carrier deep-link) instead of resolving it themselves.
// Best-effort and SILENT: any failure (DB hiccup, no match) returns null so the
// public /xp/config endpoint can surface featuredScriptId without ever 500-ing.
export async function getFeaturedScriptId() {
  try {
    const scripts = await getScriptTitles();
    return resolveFeaturedScriptId(scripts);
  } catch {
    return null;
  }
}

// One reader's XP, by handle. Returns null if the handle doesn't exist.
export async function getReaderXp(handle) {
  const reader = await getReaderByHandle(handle).catch(() => null);
  if (!reader) return null;

  const sinceISO = new Date(Date.now() - 365 * 864e5).toISOString();
  const [events, champions, feedback, scripts] = await Promise.all([
    listReadEvents({ sinceISO }),
    getChampions(),
    getFeedbackForXp(),
    getScriptTitles(),
  ]);
  // We only need this reader's stats, but recommend-funnel attribution needs the
  // full event set, so aggregate over a one-reader list.
  const featuredScriptId = resolveFeaturedScriptId(scripts);
  const statsByReader = aggregateReaderStats({ readers: [reader], events, champions, feedback, scripts, featuredScriptId });
  return shapeReader(statsByReader[reader.id], reader);
}

// Is this reader handle a Curator (may see AI evals / curate)? Admin-allowlisted
// handles always qualify; otherwise the reader must have reached the Curator XP
// threshold. A missing/unknown handle is false — anonymous callers never see evals.
export async function isCuratorHandle(handle) {
  if (!handle) return false;
  if (env.adminHandles.has(String(handle).toLowerCase())) return true;
  const xp = await getReaderXp(handle).catch(() => null);
  return !!(xp && xp.totalXp >= env.curatorMinXp);
}

// Every reader's XP, ranked. Powers the leaderboard + the dashboard. Mirrors the
// legacy /analytics/readers response shape ({ readers, ... }) so that endpoint
// can delegate here.
export async function getAllReaderXp() {
  const sinceISO = new Date(Date.now() - 365 * 864e5).toISOString();
  const [readers, events, champions, feedback, scripts] = await Promise.all([
    getReaders(),
    listReadEvents({ sinceISO }),
    getChampions(),
    getFeedbackForXp(),
    getScriptTitles(),
  ]);
  const featuredScriptId = resolveFeaturedScriptId(scripts);
  const statsByReader = aggregateReaderStats({ readers, events, champions, feedback, scripts, featuredScriptId });
  const list = readers
    .map((r) => shapeReader(statsByReader[r.id], r))
    .filter((r) => r.totalXp > 0 || r.raw.verifiedReads > 0 || r.raw.champions > 0)
    .sort((a, b) => b.totalXp - a.totalXp || b.raw.recsLanded - a.raw.recsLanded);
  return list;
}

// Per-film "Story Scout" screen-credit contenders. The credit for a film is
// SCARCE (CREDIT_SLOTS_PER_FILM slots) and goes to the curators who contributed
// most to THAT film — ranked by the actions we reward (spotting it early, a
// recommendation that landed, championing it, reading + reviewing it) — among the
// eligible (those who reached the Story Scout tier globally). Decides WHO is
// credited on each film and HOW MANY.
export async function filmCreditContenders(scriptId) {
  const sinceISO = new Date(Date.now() - 365 * 864e5).toISOString();
  const [readers, events, champions, feedback, scripts] = await Promise.all([
    getReaders(), listReadEvents({ sinceISO }), getChampions(), getFeedbackForXp(), getScriptTitles(),
  ]);
  const script = (scripts || []).find((s) => s.id === scriptId) || {};
  const pages = script.page_count;
  const featuredScriptId = resolveFeaturedScriptId(scripts);

  // global standing → who is ELIGIBLE for screen credit (reached the credit tier)
  const allStats = aggregateReaderStats({ readers, events, champions, feedback, scripts, featuredScriptId });
  const standing = {};
  readers.forEach((r) => {
    const scored = scoreReader(allStats[r.id]);
    const credit = scored.levels.find((l) => l.key === 'credit');
    standing[r.id] = { totalXp: scored.totalXp, eligible: !!(credit && credit.unlocked) };
  });

  // per-film signals
  const champs = (champions || []).filter((c) => c.script_id === scriptId);
  const reads = {}; // reader_id -> furthest depth/seconds on this film
  for (const e of events) {
    if (e.event_type === 'read_progress' && e.reader_id && e.script_id === scriptId) {
      const x = reads[e.reader_id] || (reads[e.reader_id] = { depth: 0, seconds: 0 });
      if (e.depth_pct != null) x.depth = Math.max(x.depth, e.depth_pct);
      if (e.seconds != null) x.seconds = Math.max(x.seconds, e.seconds);
    }
  }
  const fedBack = new Set((feedback || []).filter((f) => f.script_id === scriptId && f.reader_id).map((f) => f.reader_id));
  // landed recommenders for this film (their share link drove a finished read)
  const recReads = {};
  for (const e of events) {
    if (e.recommender && e.script_id === scriptId) {
      const rn = String(e.recommender).toLowerCase();
      const k = rn + '::' + e.session_id;
      const x = recReads[k] || (recReads[k] = { depth: 0, seconds: 0, rec: rn });
      if (e.event_type === 'read_progress') {
        if (e.depth_pct != null) x.depth = Math.max(x.depth, e.depth_pct);
        if (e.seconds != null) x.seconds = Math.max(x.seconds, e.seconds);
      }
    }
  }
  const landedRec = new Set();
  Object.values(recReads).forEach((x) => { if (isFinishedRead(x.depth, x.seconds, pages)) landedRec.add(x.rec); });

  const byId = {};
  readers.forEach((r) => { byId[r.id] = r; });
  const contrib = {};
  const ensure = (id) => (byId[id] ? (contrib[id] || (contrib[id] = { early: false, recLanded: false, champion: false, readFeedback: false })) : null);
  champs.forEach((c) => {
    const x = ensure(c.reader_id); if (!x) return;
    x.champion = true;
    // early = among the first EARLY_CHAMPION_RANK to champion this film AND the crowd
    // later validated it (someone else championed after) — scarce, not "all-but-last".
    const earlier = champs.filter((o) => o.added_at < c.added_at).length;
    const laterByOther = champs.some((o) => o.reader_id !== c.reader_id && o.added_at > c.added_at);
    if (earlier < EARLY_CHAMPION_RANK && laterByOther) x.early = true;
  });
  Object.entries(reads).forEach(([id, v]) => {
    if (isFinishedRead(v.depth, v.seconds, pages) && fedBack.has(id)) { const x = ensure(id); if (x) x.readFeedback = true; }
  });
  readers.forEach((r) => {
    // attribute by stable handle (not the user-settable display_name)
    if (landedRec.has(String(r.handle || '').toLowerCase())) { const x = ensure(r.id); if (x) x.recLanded = true; }
  });

  const contenders = Object.entries(contrib).map(([id, x]) => {
    const r = byId[id];
    const score = (x.early ? CREDIT_WEIGHTS.earlySpot : 0) + (x.recLanded ? CREDIT_WEIGHTS.recLanded : 0)
      + (x.champion ? CREDIT_WEIGHTS.champion : 0) + (x.readFeedback ? CREDIT_WEIGHTS.readFeedback : 0);
    return {
      handle: r.handle, name: r.display_name || r.handle,
      score, ...x,
      eligible: standing[id].eligible, totalXp: standing[id].totalXp,
    };
  }).filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.totalXp - a.totalXp);

  // award the limited slots to the top ELIGIBLE contenders
  const awarded = [];
  for (const c of contenders) {
    if (c.eligible && awarded.length < CREDIT_SLOTS_PER_FILM) { c.awarded = true; awarded.push(c.handle); }
  }
  return { scriptId, title: script.title || null, slotsPerFilm: CREDIT_SLOTS_PER_FILM, awarded, contenders };
}
