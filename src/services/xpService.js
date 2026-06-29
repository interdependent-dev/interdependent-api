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

import { scoreReader } from '../lib/xpConfig.js';
import { aggregateReaderStats } from '../lib/xpAggregate.js';
import {
  getReaders,
  listReadEvents,
  getChampions,
  getFeedbackForXp,
  getScriptTitles,
} from './supabaseService.js';
import { getReaderByHandle } from './readerService.js';

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
    role: 'Reader',
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
  const statsByReader = aggregateReaderStats({ readers: [reader], events, champions, feedback, scripts });
  return shapeReader(statsByReader[reader.id], reader);
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
  const statsByReader = aggregateReaderStats({ readers, events, champions, feedback, scripts });
  const list = readers
    .map((r) => shapeReader(statsByReader[r.id], r))
    .filter((r) => r.totalXp > 0 || r.raw.verifiedReads > 0 || r.raw.champions > 0)
    .sort((a, b) => b.totalXp - a.totalXp || b.raw.recsLanded - a.raw.recsLanded);
  return list;
}
