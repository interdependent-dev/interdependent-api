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
  listTopReaders,
} from '../controllers/readerController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireActionToken } from '../middleware/requireActionToken.js';
import { getReaderXp, isCuratorHandle } from '../services/xpService.js';
import { getTasteMatches } from '../services/discoveryService.js';
import { getReaderAssignments } from '../services/assignmentService.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { AppError } from '../middleware/errorHandler.js';

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

// The TOP READERS list — the aggregation lives in the list controller.
// NOTE: must be declared BEFORE '/:handle' or it would match handle === 'list'.
router.get('/list', requireAuth, listTopReaders);

// The signed-in reader's own ASSIGNED READS. Identity comes from the reader
// SESSION token (X-Reader-Session via optionalReader) — same resolution as the
// taste endpoint — so a reader can only ever see their OWN assignments.
// "Decided" self-heals: an assignment whose script already has this reader's
// feedback is reported decided even if the stamp was missed.
// NOTE: the "decide before reading on" gate is CLIENT-side (soft gate, like the
// finished-read gate) — this endpoint only reports state.
router.get('/me/assignments', optionalReader, async (req, res, next) => {
  try {
    if (!req.reader?.id) return next(new AppError('Reader session required', 401, 'reader_session_required'));
    const { pending, decided } = await getReaderAssignments(req.reader.id);
    res.set('Cache-Control', 'private, max-age=15');
    res.json({ pending, decided });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// The signed-in reader's INBOX — everything waiting on them, as a tagged union
// ({ kind: 'assignment' | 'recommendation', ... }). Today it carries pending
// assignments ONLY: the legacy `recommendations` table is not written by any
// current flow (recommendation attribution lives in read_events.recommender),
// so there are no peer-recommendation rows to merge. The shape is future-proof
// for when peer recs get a real write path.
router.get('/me/inbox', optionalReader, async (req, res, next) => {
  try {
    if (!req.reader?.id) return next(new AppError('Reader session required', 401, 'reader_session_required'));
    const { pending } = await getReaderAssignments(req.reader.id);
    res.set('Cache-Control', 'private, max-age=15');
    res.json({ items: pending.map((a) => ({ kind: 'assignment', ...a })) });
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
