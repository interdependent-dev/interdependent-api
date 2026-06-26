import { Router } from 'express';
import {
  registerBegin,
  registerComplete,
  authBegin,
  authComplete,
  getReader,
} from '../controllers/readerController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getReaders, listReadEvents, getScriptTitles } from '../services/supabaseService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Registration — new reader + first passkey
router.post('/register/begin', registerBegin);
router.post('/register/complete', registerComplete);

// Authentication — returning reader, get action token
router.post('/auth/begin', authBegin);
router.post('/auth/complete', authComplete);

// The READERS list — every reader and what they've read (max depth %, newest first).
// Visible to all portal users (same passcode gate as the rest of the portal).
// NOTE: must be declared BEFORE '/:handle' or it would match handle === 'list'.
router.get('/list', requireAuth, async (req, res, next) => {
  try {
    const [readers, events, titles] = await Promise.all([
      getReaders(), listReadEvents(), getScriptTitles(),
    ]);
    const titleById = {};
    titles.forEach((t) => { titleById[t.id] = t.title; });

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

    const list = readers.map((r) => {
      const rd = byReader[r.id] || {};
      const reads = Object.entries(rd).map(([sid, v]) => ({
        title: titleById[sid] || 'Untitled',
        pct: Math.round(v.depth || 0),
        seconds: Math.round(v.seconds || 0),
        last: v.last,
      })).sort((a, b) => (a.last < b.last ? 1 : -1));
      return {
        handle: r.handle,
        name: r.display_name || r.handle,
        joinedAt: r.created_at || null,
        reads,
        scriptsRead: reads.length,
        finished: reads.filter((x) => x.pct >= 85).length,
      };
    }).sort((a, b) => b.finished - a.finished || b.scriptsRead - a.scriptsRead);

    res.json({ readers: list });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// Public reader profile
router.get('/:handle', getReader);

export default router;
