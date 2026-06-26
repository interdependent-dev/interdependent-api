// Canonical reading-progress logic — kept byte-for-byte in sync with the portal's
// site/lib/read-gate.js so the client (display) and the server (READERS list) agree.
//
// The honest read % is the SMALLER of how far you scrolled (depth) and how much
// ACTIVE time you spent relative to a genuine read. Reading is paced by content,
// not scrolling — flicking to the bottom in 30s is ~2% read, not 100%.

// Seconds of active reading per page a genuine read takes (~3.5 pages/min). Tunable.
export const PACE_SEC_PER_PAGE = 20;

// Honest "how much did you actually read" %, capped by BOTH depth and time.
export function readingPct(depth, seconds, pages) {
  const d = Math.max(0, Math.min(100, depth || 0));
  const s = Math.max(0, seconds || 0);
  const p = pages && pages > 0 ? pages : 100;
  const timePct = Math.min(100, Math.round((s / (p * PACE_SEC_PER_PAGE)) * 100));
  return Math.min(d, timePct);
}

// A finished read = reached (near) the end AND spent the time to read it.
export function isFinishedRead(depth, seconds, pages) {
  return readingPct(depth, seconds, pages) >= 85;
}
