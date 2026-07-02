import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {
  registerBegin,
  registerComplete,
  authBegin,
  authComplete,
  getReader,
  getRecoveryEmail,
  setRecoveryEmail,
  addDeviceBegin,
  addDeviceComplete,
  recoverRequest,
  recoverBegin,
  recoverComplete,
  uploadPhoto,
} from '../controllers/readerController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireActionToken } from '../middleware/requireActionToken.js';
import { publicPhotoUrl } from '../services/readerService.js';
import { readingPct, isFinishedRead } from '../lib/readGate.js';
import { getReaderXp, getAllReaderXp, fetchXpRows, isCuratorHandle } from '../services/xpService.js';
import { getTasteMatches } from '../services/discoveryService.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';

const router = Router();

// Registration — new reader + first passkey
router.post('/register/begin', registerBegin);
router.post('/register/complete', registerComplete);

// Authentication — returning reader, get action token
router.post('/auth/begin', authBegin);
router.post('/auth/complete', authComplete);

// Recovery email — read the address on file, or set/update it on a signed-in
// account (also how the pre-recovery accounts backfill one). Both halves need a
// fresh action token and derive the reader from the token (never a path param),
// so a reader can only ever touch their OWN email. Declared before '/:handle'
// so 'email' can't be mistaken for a reader handle.
router.get('/email', requireActionToken, getRecoveryEmail);
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

// Profile photo — upload/replace this reader's avatar (multipart 'photo').
// Action-token gated. multer holds the file in memory; surface its size/type
// errors as a clean 400 rather than a 500.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });
function photoUpload(req, res, next) {
  avatarUpload.single('photo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image too large — max 3 MB' : err.message;
      return next(new AppError(msg, 400, 'bad_image'));
    }
    next();
  });
}
router.post('/photo', requireActionToken, photoUpload, uploadPhoto);

// The TOP READERS list — readers who've genuinely finished at least MIN_FINISHED
// screenplays, with what they've read (honest read % = depth AND time) and the
// feedback they've left. Visible to all portal users (same passcode gate).
// ORDERED BY THE XP RUBRIC: the list order IS the XP ranking (totalXp desc), so
// this page can never disagree with /xp/leaderboard — one rubric, one order.
// NOTE: must be declared BEFORE '/:handle' or it would match handle === 'list'.
const MIN_FINISHED = 1; // a reader earns a spot once they finish a real read. Tunable.

router.get('/list', requireAuth, async (req, res, next) => {
  try {
    // ONE fetch powers both the XP ranking and the reads/feedback detail. The
    // rows use the XP engine's 365-day event window (fetchXpRows), so the
    // numbers shown here are exactly the ones the ranking was computed from.
    const rows = await fetchXpRows();
    const { readers, events, champions, feedback, scripts } = rows;
    const xpList = await getAllReaderXp(rows);
    const xpByReaderId = {};
    xpList.forEach((x) => { xpByReaderId[x.readerId] = x; });

    const titleById = {}, pagesById = {};
    scripts.forEach((t) => { titleById[t.id] = t.title; pagesById[t.id] = t.page_count; });

    // (reader, script) pairs the reader has championed — raw board-adds, so the
    // flag mirrors what the reader actually did (XP separately read-gates them).
    const champSet = new Set(champions.map((c) => `${c.reader_id}::${c.script_id}`));
    // (recommender-handle, script) pairs — this reader SENT a recommendation of
    // the script. Attributed exactly like the XP aggregator: the share link
    // carries ?by=<handle> into read_events.recommender (case-insensitive). The
    // legacy `recommendations` table is not written by any current flow, so
    // read_events is the single source here.
    const recSet = new Set();
    for (const e of events) {
      if (e.recommender && e.script_id) {
        recSet.add(`${String(e.recommender).toLowerCase()}::${e.script_id}`);
      }
    }

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

    // reader_id -> feedback they've left (rows come from the XP fetch — a
    // superset of the fields this display needs)
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
      const handleLc = String(r.handle || '').toLowerCase();
      const reads = Object.entries(rd).map(([sid, v]) => ({
        id: sid,                                                // script id → clickable to its detail
        title: titleById[sid] || 'Untitled',
        pct: readingPct(v.depth, v.seconds, pagesById[sid]),   // honest: depth AND time
        pages: pagesById[sid] || null,                          // total pages → render "read / total"
        finished: isFinishedRead(v.depth, v.seconds, pagesById[sid]),
        last: v.last,
        championed: champSet.has(`${r.id}::${sid}`),           // on this reader's board
        recommended: recSet.has(`${handleLc}::${sid}`),        // this reader shared it on
      })).sort((a, b) => (a.last < b.last ? 1 : -1));
      const fb = (fbByReader[r.id] || []).sort((a, b) => (a.when < b.when ? 1 : -1));
      const xp = xpByReaderId[r.id];
      return {
        handle: r.handle,
        name: r.display_name || r.handle,
        photoUrl: publicPhotoUrl(r.photo_path),
        joinedAt: r.created_at || null,
        staff: env.adminHandles.has(handleLc),   // team member (ADMIN_HANDLES)
        totalXp: xp ? xp.totalXp : 0,            // the ordering key — no second call needed
        recsLanded: xp ? xp.raw.recsLanded : 0,  // first tie-break (exposed for transparency)
        reads,
        scriptsRead: reads.length,
        finished: reads.filter((x) => x.finished).length,
        feedback: fb,
      };
    })
      .filter((r) => r.finished >= MIN_FINISHED)   // only readers who've earned a spot
      .sort((a, b) => b.totalXp - a.totalXp || b.recsLanded - a.recsLanded || b.finished - a.finished);

    res.json({ readers: list });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// Public reader XP — drives the curator's XP bar on their profile and anywhere
// their standing is shown. Read-only projection of their real activity; safe to
// expose (no email, no private data). Declared before '/:handle' for clarity
// (the two-segment path can't collide with the one-segment profile route).
router.get('/:handle/xp', async (req, res, next) => {
  try {
    const xp = await getReaderXp(req.params.handle);
    if (!xp) return next(new AppError('Reader not found', 404));
    res.set('Cache-Control', 'public, max-age=30');
    res.json(xp);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// GET /readers/:handle/taste — "readers who read like you" (taste match from verdicts).
// Personal: only the reader themselves (proven via the session token) or a Curator sees it.
router.get('/:handle/taste', optionalReader, async (req, res, next) => {
  try {
    const handle = req.params.handle;
    const self = req.reader?.handle && req.reader.handle.toLowerCase() === String(handle).toLowerCase();
    const allowed = self || (await isCuratorHandle(req.reader?.handle));
    if (!allowed) return res.json({ matches: [], canSee: false });
    const matches = await getTasteMatches(handle);
    res.set('Cache-Control', 'private, max-age=30');  // per-reader result — private cache only
    res.json({ matches, canSee: true });
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

// Public reader profile
router.get('/:handle', getReader);

export default router;
