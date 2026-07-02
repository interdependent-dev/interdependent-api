// Locks the reader XP economy: per-action points, feedback thoroughness scaling,
// level thresholds, the action-gates (XP alone can't buy a level), and the
// aggregation from raw rows (reader-attributed + finished reads only).
// Run: `npm test` (from interdependent-api/).
import test from 'node:test';
import assert from 'node:assert';
import {
  ACTIONS,
  FEEDBACK_MAX,
  LEVELS,
  feedbackXpForRow,
  levelForXp,
  gateMet,
  unmetGate,
  scoreReader,
  badgesFor,
} from '../src/lib/xpConfig.js';
import { aggregateReaderStats } from '../src/lib/xpAggregate.js';

// ── feedback thoroughness ────────────────────────────────────────────────────

test('bare verdict earns only the base', () => {
  assert.strictEqual(feedbackXpForRow({}), ACTIONS.feedbackBase);
});

test('complete feedback (dims + notes + voice) ≈ 55 and equals FEEDBACK_MAX', () => {
  const dims = { a: 5, b: 4, c: 3, d: 5, e: 2, f: 4, g: 5, h: 3 }; // 8 dims → caps the dim bonus
  const xp = feedbackXpForRow({ dimensions: dims, text: 'x'.repeat(200), hasVoice: true });
  assert.strictEqual(xp, ACTIONS.feedbackBase + ACTIONS.feedbackDimensionsCap + ACTIONS.feedbackNotes + ACTIONS.feedbackVoice);
  assert.strictEqual(xp, FEEDBACK_MAX);
  assert.strictEqual(xp, 55);
});

test('dimension bonus is capped', () => {
  const elevenDims = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`d${i}`, 5]));
  const xp = feedbackXpForRow({ dimensions: elevenDims });
  assert.strictEqual(xp, ACTIONS.feedbackBase + ACTIONS.feedbackDimensionsCap);
});

test('short notes do not earn the notes bonus', () => {
  assert.strictEqual(feedbackXpForRow({ text: 'too short' }), ACTIONS.feedbackBase);
});

test('null dimension values are not counted', () => {
  assert.strictEqual(feedbackXpForRow({ dimensions: { a: null, b: 5 } }), ACTIONS.feedbackBase + 2);
});

// ── level math ───────────────────────────────────────────────────────────────

test('levelForXp picks the highest threshold reached', () => {
  assert.strictEqual(levelForXp(0).key, 'reader');
  assert.strictEqual(levelForXp(59).key, 'reader');
  assert.strictEqual(levelForXp(60).key, 'event');
  assert.strictEqual(levelForXp(279).key, 'event');
  assert.strictEqual(levelForXp(280).key, 'podcast');
  assert.strictEqual(levelForXp(9999).key, 'credit');
});

test('thresholds are strictly increasing', () => {
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].min > LEVELS[i - 1].min);
});

test('gateMet / unmetGate', () => {
  assert.strictEqual(gateMet(null, {}), true);
  assert.strictEqual(gateMet({ reads: 5 }, { reads: 5 }), true);
  assert.strictEqual(gateMet({ reads: 5 }, { reads: 4 }), false);
  assert.deepStrictEqual(unmetGate({ reads: 5, feedbacks: 3 }, { reads: 6, feedbacks: 1 }), [
    { key: 'feedbacks', need: 3, have: 1 },
  ]);
});

// ── scoreReader: the hook ────────────────────────────────────────────────────

test('reading + reviewing The Carrier unlocks the event perk (first reward)', () => {
  const r = scoreReader({ verifiedReads: 1, feedbacks: 1, feedbackXp: 55, featuredRead: 1, featuredFeedback: 1 });
  assert.strictEqual(r.totalXp, ACTIONS.read + 55); // 65
  assert.strictEqual(r.level.key, 'event');
  const ev = r.levels.find((l) => l.key === 'event');
  assert.strictEqual(ev.unlocked, true);
  assert.strictEqual(r.nextLevel.key, 'podcast');
  assert.strictEqual(r.nextLevel.xpToGo, 280 - 65);
});

test('XP alone cannot buy a level — the gate must be met', () => {
  // 100 reads = 1000 XP (past several thresholds) but no Carrier read/feedback ⇒
  // even the event perk (read The Carrier + feedback on it) stays locked.
  const r = scoreReader({ verifiedReads: 100, feedbacks: 0, feedbackXp: 0 });
  assert.strictEqual(r.totalXp, 1000);
  const ev = r.levels.find((l) => l.key === 'event');
  assert.strictEqual(ev.reached, true);
  assert.strictEqual(ev.gateMet, false);
  assert.strictEqual(ev.unlocked, false);
  assert.strictEqual(r.level.key, 'reader'); // current level = highest UNLOCKED
  assert.ok(ev.unmet.some((u) => u.key === 'featuredRead' || u.key === 'featuredFeedback'));
});

test('reading + championing can only take you so far — voting needs a landed rec', () => {
  // Plenty of reads/feedback/champions (+ Carrier done) → enough XP for voting
  // (1400) and its champions gate, but no recommendation has LANDED ⇒ stays at chat.
  const r = scoreReader({ verifiedReads: 60, feedbacks: 12, feedbackXp: 600, champions: 12, recsLanded: 0, featuredRead: 1, featuredFeedback: 1 });
  assert.ok(r.totalXp >= 1400);
  const voting = r.levels.find((l) => l.key === 'voting');
  assert.strictEqual(voting.reached, true);
  assert.strictEqual(voting.gateMet, false);
  assert.ok(voting.unmet.some((u) => u.key === 'recsLanded'));
  assert.strictEqual(r.level.key, 'chat');
});

test('badges fire on their thresholds', () => {
  assert.deepStrictEqual(badgesFor({ verifiedReads: 5 }).sort(), ['deep-reader']);
  assert.ok(badgesFor({ recsLanded: 1 }).includes('tastemaker'));
  assert.ok(badgesFor({ feedbacks: 3 }).includes('calibrator'));
  assert.ok(badgesFor({ verifiedReads: 10 }).includes('prolific'));
});

// ── aggregateReaderStats: raw rows → stats ───────────────────────────────────

const READER = { id: 'r1', handle: 'jane-doe', display_name: 'Jane Doe' };
const SCRIPTS = [{ id: 's1', page_count: 100 }, { id: 's2', page_count: 100 }];

test('only reader-attributed, finished reads count toward XP', () => {
  const events = [
    // finished read by our reader on s1 (depth 96, plenty of time for 100pp)
    { event_type: 'read_progress', reader_id: 'r1', script_id: 's1', depth_pct: 96, seconds: 4000 },
    // a skim by our reader on s2 (scrolled to bottom in 40s) → NOT finished
    { event_type: 'read_progress', reader_id: 'r1', script_id: 's2', depth_pct: 100, seconds: 40 },
    // a finished read but with NO reader_id (anonymous/forgeable) → ignored
    { event_type: 'read_progress', reader_id: null, script_id: 's1', depth_pct: 99, seconds: 5000 },
  ];
  const stats = aggregateReaderStats({ readers: [READER], events, champions: [], feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.verifiedReads, 1);
});

test('feedback thoroughness aggregates per reader', () => {
  const feedback = [
    { reader_id: 'r1', script_id: 's1', dimensions: { a: 5, b: 4 }, text: 'short', audio_path: null }, // 15 + 4 = 19
    { reader_id: 'r1', script_id: 's2', dimensions: null, text: 'x'.repeat(200), audio_path: 'feedback/s2.webm' }, // 15 + 10 + 15 = 40
  ];
  const stats = aggregateReaderStats({ readers: [READER], events: [], champions: [], feedback, scripts: SCRIPTS });
  assert.strictEqual(stats.r1.feedbacks, 2);
  assert.strictEqual(stats.r1.feedbackXp, 19 + 40);
});

test('early spot = championed before another reader did (with the read to back it)', () => {
  // Champions are READ-GATED: r1's champion only counts because r1 also has a
  // verified finished read of s1.
  const events = [
    { event_type: 'read_progress', reader_id: 'r1', script_id: 's1', depth_pct: 96, seconds: 4000 },
  ];
  const champions = [
    { reader_id: 'r1', script_id: 's1', added_at: '2026-01-01T00:00:00Z' }, // first
    { reader_id: 'r2', script_id: 's1', added_at: '2026-02-01T00:00:00Z' }, // later → r1 was early
  ];
  const stats = aggregateReaderStats({ readers: [READER], events, champions, feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.champions, 1);
  assert.strictEqual(stats.r1.earlySpots, 1);
});

test('champion WITHOUT a verified read earns no champion XP and no early spot — but shows in championsAll', () => {
  // The farm pattern: board-adds with zero verified reads. No read ⇒ the champion
  // row is display-only (championsAll) and worth 0 XP; it can't be an early spot.
  const champions = [
    { reader_id: 'r1', script_id: 's1', added_at: '2026-01-01T00:00:00Z' },
    { reader_id: 'r2', script_id: 's1', added_at: '2026-02-01T00:00:00Z' }, // crowd followed — still no credit without the read
  ];
  const stats = aggregateReaderStats({ readers: [READER], events: [], champions, feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.champions, 0);
  assert.strictEqual(stats.r1.earlySpots, 0);
  assert.strictEqual(stats.r1.championsAll, 1); // the raw row is still visible…
  assert.strictEqual(scoreReader(stats.r1).totalXp, 0); // …but earns nothing
});

test('champion WITH a verified read earns exactly as before', () => {
  const events = [
    { event_type: 'read_progress', reader_id: 'r1', script_id: 's1', depth_pct: 96, seconds: 4000 },
  ];
  const champions = [
    { reader_id: 'r1', script_id: 's1', added_at: '2026-01-01T00:00:00Z' },
    { reader_id: 'r2', script_id: 's1', added_at: '2026-02-01T00:00:00Z' },
  ];
  const stats = aggregateReaderStats({ readers: [READER], events, champions, feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.champions, 1);
  assert.strictEqual(stats.r1.championsAll, 1);
  assert.strictEqual(stats.r1.earlySpots, 1);
  assert.strictEqual(
    scoreReader(stats.r1).totalXp,
    ACTIONS.read + ACTIONS.champion + ACTIONS.earlySpot,
  );
});

test('recommend funnel: opened / landed / converted attributed by handle', () => {
  // Recommendations are attributed by the reader's stable HANDLE (the share link
  // carries ?by=<handle>), never the user-settable display_name.
  const events = [
    // Jane recommended s1; a guest opened it and finished it
    { event_type: 'recommend_open', recommender: 'jane-doe', script_id: 's1', session_id: 'guestA' },
    { event_type: 'read_progress', recommender: 'jane-doe', script_id: 's1', session_id: 'guestA', depth_pct: 95, seconds: 4000 },
    // Jane recommended s2; opened but only skimmed → opened but not landed
    { event_type: 'recommend_open', recommender: 'jane-doe', script_id: 's2', session_id: 'guestB' },
    { event_type: 'read_progress', recommender: 'jane-doe', script_id: 's2', session_id: 'guestB', depth_pct: 100, seconds: 30 },
  ];
  // s1 later championed by someone else → Jane's recommend converted
  const champions = [{ reader_id: 'r2', script_id: 's1', added_at: '2026-03-01T00:00:00Z' }];
  const stats = aggregateReaderStats({ readers: [READER], events, champions, feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.recsSent, 2);
  assert.strictEqual(stats.r1.recsOpened, 2);
  assert.strictEqual(stats.r1.recsLanded, 1);
  assert.strictEqual(stats.r1.recsConverted, 1);
});

test('display_name collisions can no longer cross-credit recommendations', () => {
  // Two readers share a display name; the share link used jane-doe's handle.
  const readers = [READER, { id: 'r9', handle: 'jane-d', display_name: 'Jane Doe' }];
  const events = [
    { event_type: 'recommend_open', recommender: 'jane-doe', script_id: 's1', session_id: 'g1' },
    { event_type: 'read_progress', recommender: 'jane-doe', script_id: 's1', session_id: 'g1', depth_pct: 95, seconds: 4000 },
  ];
  const stats = aggregateReaderStats({ readers, events, champions: [], feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.recsLanded, 1); // the real recommender
  assert.strictEqual(stats.r9.recsLanded, 0); // the name-twin gets nothing
});

test('you cannot land your own recommendation', () => {
  // A finished read on a recommended script by the recommender's OWN reader_id
  // doesn't count as landed (no self-farming the gated recsLanded signal).
  const events = [
    { event_type: 'recommend_open', recommender: 'jane-doe', script_id: 's1', session_id: 'self' },
    { event_type: 'read_progress', recommender: 'jane-doe', reader_id: 'r1', script_id: 's1', session_id: 'self', depth_pct: 99, seconds: 4000 },
  ];
  const stats = aggregateReaderStats({ readers: [READER], events, champions: [], feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.recsLanded, 0);
});

test('forged-session burst on one script cannot farm recsLanded (deduped per script)', () => {
  // 5 distinct forged sessions all "finishing" the same recommended script count
  // as ONE landed script, not five.
  const events = [];
  for (let i = 0; i < 5; i++) {
    events.push({ event_type: 'read_progress', recommender: 'jane-doe', script_id: 's1', session_id: `forge${i}`, depth_pct: 100, seconds: 5000 });
  }
  const stats = aggregateReaderStats({ readers: [READER], events, champions: [], feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.recsLanded, 1);
});

test('early spot is scarce: only the first few champions, and only if the crowd follows', () => {
  const champers = [READER,
    { id: 'r2', handle: 'r2' }, { id: 'r3', handle: 'r3' }, { id: 'r4', handle: 'r4' }, { id: 'r5', handle: 'r5' }];
  // Every champion here has a verified finished read of s1, so the ONLY thing
  // separating them is the early-rank/crowd rule under test.
  const events = champers.map((r) => (
    { event_type: 'read_progress', reader_id: r.id, script_id: 's1', depth_pct: 96, seconds: 4000 }
  ));
  // r1..r5 champion s1 in order; r1/r2/r3 are within the first 3 AND have later
  // champions → early. r4 (4th) is past the rank; r5 (last) has no one after → not early.
  const champions = champers.map((r, i) => ({ reader_id: r.id, script_id: 's1', added_at: `2026-0${i + 1}-01T00:00:00Z` }));
  const stats = aggregateReaderStats({ readers: champers, events, champions, feedback: [], scripts: SCRIPTS });
  assert.strictEqual(stats.r1.earlySpots, 1);
  assert.strictEqual(stats.r2.earlySpots, 1);
  assert.strictEqual(stats.r3.earlySpots, 1);
  assert.strictEqual(stats.r4.earlySpots, 0); // past EARLY_CHAMPION_RANK
  assert.strictEqual(stats.r5.earlySpots, 0); // last — the crowd never followed
});

test('re-submitting feedback on the same script does not farm XP (idempotent per script)', () => {
  // Two feedback rows for the same (reader, script) — e.g. a legacy duplicate or an
  // edit — count as ONE script at the BEST (max) thoroughness, not summed.
  const feedback = [
    { reader_id: 'r1', script_id: 's1', dimensions: { a: 5, b: 4 }, text: 'short', audio_path: null }, // 15 + 4 = 19
    { reader_id: 'r1', script_id: 's1', dimensions: null, text: 'x'.repeat(200), audio_path: 'feedback/s1.webm' }, // 15 + 10 + 15 = 40
  ];
  const stats = aggregateReaderStats({ readers: [READER], events: [], champions: [], feedback, scripts: SCRIPTS });
  assert.strictEqual(stats.r1.feedbacks, 1); // one distinct script
  assert.strictEqual(stats.r1.feedbackXp, 40); // the best of the two, not 19 + 40
});

test('the event perk fails CLOSED when no featured script is resolved', () => {
  // Without a featured (Carrier) script, reading/reviewing ANYTHING must NOT grant
  // the Carrier-gated free-admission perk.
  const events = [{ event_type: 'read_progress', reader_id: 'r1', script_id: 's1', depth_pct: 96, seconds: 4000 }];
  const feedback = [{ reader_id: 'r1', script_id: 's1', dimensions: { a: 5 }, text: 'x'.repeat(200) }];
  const stats = aggregateReaderStats({ readers: [READER], events, champions: [], feedback, scripts: SCRIPTS, featuredScriptId: null });
  assert.strictEqual(stats.r1.featuredRead, 0);
  assert.strictEqual(stats.r1.featuredFeedback, 0);
});
