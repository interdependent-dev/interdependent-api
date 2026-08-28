import { getFeedbackForXp, getReaders } from './supabaseService.js';
import { getReaderByHandle } from './readerService.js';

// "Readers who read like you" — taste match from human verdicts. For a reader,
// find OTHER readers whose PASS/CONSIDER/RECOMMEND verdicts on the SAME scripts
// agree most. Pure aggregation over reader_feedback; no AI, no new tables.
//
// Anti-noise: a match needs a minimum SHARED overlap, so a single coincidental
// agreement can't top the list.
export const MIN_SHARED = 2;

// Pure ranking (unit-testable): feedback rows + a target readerId + an id→info map.
export function rankTasteMatches({ readerId, feedback, info, limit = 8 }) {
  const byReader = {};
  (feedback || []).forEach((f) => {
    const v = String(f.champion_verdict || '')
      .toLowerCase()
      .trim();
    if (!f.reader_id || !f.script_id || !v) return;
    (byReader[f.reader_id] || (byReader[f.reader_id] = {}))[f.script_id] = v;
  });

  const mine = byReader[readerId] || {};
  const mineScripts = Object.keys(mine);
  if (!mineScripts.length) return [];

  const matches = [];
  for (const [rid, verdicts] of Object.entries(byReader)) {
    if (rid === readerId || !info[rid]) continue;
    let shared = 0;
    let agreed = 0;
    for (const sid of mineScripts) {
      if (verdicts[sid]) {
        shared += 1;
        if (verdicts[sid] === mine[sid]) agreed += 1;
      }
    }
    if (shared >= MIN_SHARED) {
      matches.push({
        handle: info[rid].handle,
        name: info[rid].name,
        shared,
        agreed,
        score: agreed / shared,
      });
    }
  }
  // Highest agreement rate first, then more shared reads, then more agreements.
  matches.sort((a, b) => b.score - a.score || b.shared - a.shared || b.agreed - a.agreed);
  return matches.slice(0, limit);
}

export async function getTasteMatches(handle, { limit = 8 } = {}) {
  const reader = await getReaderByHandle(handle).catch(() => null);
  if (!reader) return [];
  const [feedback, readers] = await Promise.all([getFeedbackForXp(), getReaders()]);
  const info = {};
  (readers || []).forEach((r) => {
    info[r.id] = { handle: r.handle, name: r.display_name || r.handle };
  });
  return rankTasteMatches({ readerId: reader.id, feedback, info, limit });
}
