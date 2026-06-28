import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  registerBegin,
  registerComplete,
  authBegin,
  authComplete,
  getReader,
  setRecoveryEmail,
  addDeviceBegin,
  addDeviceComplete,
  recoverRequest,
  recoverBegin,
  recoverComplete,
} from '../controllers/readerController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireActionToken } from '../middleware/requireActionToken.js';
import { getReaders, listReadEvents, getScriptTitles, getAllFeedback } from '../services/supabaseService.js';
import { readingPct, isFinishedRead } from '../lib/readGate.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Registration — new reader + first passkey
router.post('/register/begin', registerBegin);
router.post('/register/complete', registerComplete);

// Authentication — returning reader, get action token
router.post('/auth/begin', authBegin);
router.post('/auth/complete', authComplete);

// Recovery email — set/update on a signed-in account (also how the
// pre-recovery accounts backfill one). Needs a fresh action token.
router.post('/email', requireActionToken, setRecoveryEmail);

// Add a device — register an additional passkey while signed in. Both halves
// require a fresh action token (proves an existing passkey first).
router.post('/credentials/add/begin', requireActionToken, addDeviceBegin);
router.post('/credentials/add/complete', requireActionToken, addDeviceComplete);

// Account recovery (lost every passkey) — email a one-time link, then register
// a new passkey under it. The request endpoint is rate-limited and
// anti-enumeration; begin/complete are gated by the one-time token itself.
const recoverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,                       // per IP — a real reader needs one or two
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many recovery requests — please wait a few minutes and try again' },
});
router.post('/recover/request', recoverLimiter, recoverRequest);
router.post('/recover/begin', recoverBegin);
router.post('/recover/complete', recoverComplete);

// The TOP READERS list — readers who've genuinely finished at least MIN_FINISHED
// screenplays, with what they've read (honest read % = depth AND time) and the
// feedback they've left. Visible to all portal users (same passcode gate).
// NOTE: must be declared BEFORE '/:handle' or it would match handle === 'list'.
const MIN_FINISHED = 1; // a reader earns a spot once they finish a real read. Tunable.

router.get('/list', requireAuth, async (req, res, next) => {
  try {
    const [readers, events, titles, feedback] = await Promise.all([
      getReaders(), listReadEvents(), getScriptTitles(), getAllFeedback(),
    ]);
    const titleById = {}, pagesById = {};
    titles.forEach((t) => { titleById[t.id] = t.title; pagesById[t.id] = t.page_count; });

    // reader_id -> script_id -> { furthest depth, longest active time, last seen }
    const byReader = {};
    for (const e of events) {
      if (e.event_type !== 'read_progress' || !e.reader_id || !e.script_id) continue;
      const rd = byReader[e.reader_id] || (byReader[e.reader_id] = {});
      const sc = rd[e.script_id] || (rd[e.script_id] = { depth: 0, seconds: 0, last: e.ts });
      if (e.depth_pct != null) sc.depth = Math.max(sc.depth, e.depth_pct);
      if (e.seconds != null) sc.seconds = Math.max(sc.seconds, e.seconds);
      if (e.ts > sc.last) sc.last = e.ts;
    }

    // reader_id -> feedback they've left
    const fbByReader = {};
    for (const f of feedback) {
      if (!f.reader_id) continue;
      (fbByReader[f.reader_id] || (fbByReader[f.reader_id] = [])).push({
        title: titleById[f.script_id] || 'Untitled',
        decision: f.champion_verdict || null,
        text: f.text || '',
        transcript: f.transcript && f.transcript !== f.text ? f.transcript : '',
        when: f.created_at,
      });
    }

    const list = readers.map((r) => {
      const rd = byReader[r.id] || {};
      const reads = Object.entries(rd).map(([sid, v]) => ({
        title: titleById[sid] || 'Untitled',
        pct: readingPct(v.depth, v.seconds, pagesById[sid]),   // honest: depth AND time
        finished: isFinishedRead(v.depth, v.seconds, pagesById[sid]),
        last: v.last,
      })).sort((a, b) => (a.last < b.last ? 1 : -1));
      const fb = (fbByReader[r.id] || []).sort((a, b) => (a.when < b.when ? 1 : -1));
      return {
        handle: r.handle,
        name: r.display_name || r.handle,
        joinedAt: r.created_at || null,
        reads,
        scriptsRead: reads.length,
        finished: reads.filter((x) => x.finished).length,
        feedback: fb,
      };
    })
      .filter((r) => r.finished >= MIN_FINISHED)   // only readers who've earned a spot
      .sort((a, b) => b.finished - a.finished || b.scriptsRead - a.scriptsRead);

    res.json({ readers: list });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// Public reader profile
router.get('/:handle', getReader);

export default router;
