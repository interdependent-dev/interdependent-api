import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getReaderScriptRead, getScriptPageCount } from '../services/supabaseService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth); // same passcode gate as the portal

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /reads/status?script=<uuid>&reader=<uuid>
// Has this reader finished this script? Computed from read_events, mirroring the
// portal's forgiving completion bar (reached the end AND spent real active time —
// never scroll alone): depth >= 85 AND active seconds >= ~3s per page reached
// (min 90s). This is what makes a finished read on one device unlock the actions
// on another. Read-only; never mutates anything.
router.get('/status', async (req, res, next) => {
  try {
    const script = String(req.query.script || '');
    const reader = String(req.query.reader || '');
    if (!UUID.test(script) || !UUID.test(reader)) return res.json({ finished: false });

    const [{ depth, seconds }, pages] = await Promise.all([
      getReaderScriptRead(reader, script),
      getScriptPageCount(script),
    ]);
    const reached   = pages ? Math.max(1, Math.round(pages * (depth / 100))) : 0;
    const timeFloor = Math.max(90, reached * 3);
    const finished  = depth >= 85 && seconds >= timeFloor;

    res.json({ finished, depth, seconds });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
