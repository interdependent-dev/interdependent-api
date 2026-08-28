// Pure sanitization for the PUBLIC read-event ingest (POST /events). No I/O —
// takes an untrusted request body plus the VERIFIED reader id (if any) and
// returns either a clean insertReadEvent payload or null (silently drop).
//
// SECURITY / trust model: `readerId` must come from the verified reader session
// (optionalReader → X-Reader-Session JWT), NEVER from the body. Any `reader_id`
// in the body is ignored entirely — reader ids are public (GET /readers/:handle),
// so trusting the body would let anyone forge verified reads (and read-gated XP)
// for any reader. Anonymous events are still accepted; they simply carry no
// reader attribution. `recommender` stays a body field on purpose: it is
// display-name attribution only, and is anti-gamed separately in the XP layer.

import { UUID } from './ids.js';

export const EVENT_TYPES = new Set([
  'recommend_open', 'script_view', 'reader_open', 'quick_preview',
  'read_progress', 'read_complete', 'new_tab', 'download', 'champion', 'browse_unlock',
]);

const num = (x, lo, hi) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null);
// Free-text from the PUBLIC ingest — strip control chars so it's clean at rest,
// independent of whether every future render sink remembers to HTML-escape it.
// eslint-disable-next-line no-control-regex -- the control-char range is the point
const clean = (s, n) => (typeof s === 'string' ? s.replace(/[\x00-\x1f\x7f]/g, '').slice(0, n) : null);

export function sanitizeReadEvent(body, readerId = null) {
  const b = body || {};
  if (!EVENT_TYPES.has(b.event_type)) return null;
  if (b.script_id && !UUID.test(b.script_id)) return null;
  return {
    eventType: b.event_type,
    scriptId: b.script_id || null,
    sessionId: clean(b.session_id, 64),
    readerId: readerId || null, // verified session identity ONLY — b.reader_id is never read
    recommender: clean(b.recommender, 120),
    source: clean(b.source, 20),
    page: b.page != null ? Math.floor(num(b.page, 0, 100000)) : null,
    totalPages: b.total_pages != null ? Math.floor(num(b.total_pages, 0, 100000)) : null,
    depthPct: b.depth_pct != null ? num(b.depth_pct, 0, 100) : null,
    seconds: b.seconds != null ? Math.floor(num(b.seconds, 0, 1000000)) : null,
  };
}
