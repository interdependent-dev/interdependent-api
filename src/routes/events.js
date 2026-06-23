import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { insertReadEvent } from '../services/supabaseService.js';

const router = Router();

// PUBLIC, no auth — reader-analytics ingest from the portal + recommend pages.
// Generous limit (a reading session emits progress pings), best-effort, and it
// NEVER returns an error to the client: analytics must not affect the reader.
const limiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });

const TYPES = new Set([
  'recommend_open', 'script_view', 'reader_open', 'quick_preview',
  'read_progress', 'read_complete', 'new_tab', 'download', 'champion', 'browse_unlock',
]);
const UUID = /^[0-9a-fA-F-]{36}$/;
const num = (x, lo, hi) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null);

router.post('/', limiter, async (req, res) => {
  try {
    const b = req.body || {};
    if (!TYPES.has(b.event_type)) return res.status(204).end();
    if (b.script_id && !UUID.test(b.script_id)) return res.status(204).end();
    await insertReadEvent({
      eventType: b.event_type,
      scriptId: b.script_id || null,
      sessionId: typeof b.session_id === 'string' ? b.session_id.slice(0, 64) : null,
      readerId: b.reader_id && UUID.test(b.reader_id) ? b.reader_id : null,
      recommender: typeof b.recommender === 'string' ? b.recommender.slice(0, 120) : null,
      source: typeof b.source === 'string' ? b.source.slice(0, 20) : null,
      page: b.page != null ? Math.floor(num(b.page, 0, 100000)) : null,
      totalPages: b.total_pages != null ? Math.floor(num(b.total_pages, 0, 100000)) : null,
      depthPct: b.depth_pct != null ? num(b.depth_pct, 0, 100) : null,
      seconds: b.seconds != null ? Math.floor(num(b.seconds, 0, 1000000)) : null,
    });
  } catch (err) {
    console.error('read_event ingest failed:', err.message);
  }
  res.status(204).end();
});

export default router;
