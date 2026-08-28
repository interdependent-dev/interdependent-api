// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME SEED — run once, right after applying 2026-06-30_reader_notifications.sql
// and before/at the moment the XP-email feature goes live.
//
//   node --env-file=.env src/db/seed_reader_notifications.mjs
//
// It marks every reader's CURRENTLY-satisfied milestone as already-notified, so the
// first action after launch does NOT blast historical "first review / first champion"
// and already-earned perk emails to long-time readers. Idempotent (the UNIQUE
// constraint makes re-runs no-ops) and additive (only inserts idempotency markers —
// to undo, just DELETE FROM reader_notifications).
// ─────────────────────────────────────────────────────────────────────────────

import { getAllReaderXp } from '../services/xpService.js';
import { getFeedbackForXp, getChampions, claimNotification } from '../services/supabaseService.js';
import { logger } from '../lib/logger.js';

const [readers, feedback, champions] = await Promise.all([
  getAllReaderXp(),
  getFeedbackForXp(),
  getChampions(),
]);

const hasFeedback = new Set(feedback.filter((f) => f.reader_id).map((f) => f.reader_id));
const hasChampion = new Set(champions.filter((c) => c.reader_id).map((c) => c.reader_id));

let seeded = 0;
const bump = async (id, kind, ref) => {
  if (await claimNotification(id, kind, ref)) seeded += 1;
};

for (const id of hasFeedback) await bump(id, 'first_feedback', '');
for (const id of hasChampion) await bump(id, 'first_champion', '');
for (const r of readers) {
  for (const lvl of r.levels || []) {
    if (lvl.min > 0 && lvl.unlocked) await bump(r.readerId, 'unlock', lvl.key);
  }
}

logger.info(
  {
    seeded,
    readers: readers.length,
    withFeedback: hasFeedback.size,
    withChampions: hasChampion.size,
  },
  'Seeded notification claims — re-running is safe',
);
process.exit(0);
