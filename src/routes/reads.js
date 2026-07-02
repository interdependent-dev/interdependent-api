import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getReaderScriptRead, getScriptPageCount } from '../services/supabaseService.js';
import { isFinishedRead } from '../lib/readGate.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth); // same passcode gate as the portal

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /reads/status?script=<uuid>&reader=<uuid>
// Has this reader finished this script? Computed from read_events via the
// canonical gate (lib/readGate.js): the honest read % is min(depth, timePct)
// where timePct paces active seconds against PACE_SEC_PER_PAGE = 20s/page, and
// finished means that % ≥ 85 — reached (near) the end AND spent the time to
// read it, never scroll alone. This is what makes a finished read on one device
// unlock the actions on another. Read-only; never mutates anything.
router.get('/status', async (req, res, next) => {
  try {
    const script = String(req.query.script || '');
    const reader = String(req.query.reader || '');
    if (!UUID.test(script) || !UUID.test(reader)) return res.json({ finished: false });

    const [{ depth, seconds }, pages] = await Promise.all([
      getReaderScriptRead(reader, script),
      getScriptPageCount(script),
    ]);
    res.json({ finished: isFinishedRead(depth, seconds, pages), depth, seconds });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
