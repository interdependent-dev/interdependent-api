import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireActionToken } from '../middleware/requireActionToken.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { isCuratorHandle } from '../services/xpService.js';
import { getScriptMessages, insertMessage, endorseMessage, getMessageMeta } from '../services/chatService.js';
import { getLeaderboardEntry } from '../services/leaderboardService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const UUID = /^[0-9a-fA-F-]{36}$/;

// The chat is the WARM AUDIENCE: readers who CHAMPIONED the script, plus top-XP
// Curators (who may join any). Fails safe (false) on any error.
async function canChat(reader, scriptId) {
  if (!reader?.id) return false;
  try {
    // Cheap check first: did they champion this script? Fall back to the heavier
    // Curator lookup (full XP aggregation) only when they haven't.
    const entry = await getLeaderboardEntry(reader.id, scriptId).catch(() => null);
    if (entry) return true;
    return await isCuratorHandle(reader.handle);
  } catch { return false; }
}

// GET /messages/:scriptId — read the chat (champions of the script, or Curators).
router.get('/:scriptId', requireAuth, optionalReader, async (req, res, next) => {
  try {
    const scriptId = req.params.scriptId;
    if (!UUID.test(scriptId)) return next(new AppError('Invalid script id', 400));
    if (!(await canChat(req.reader, scriptId))) return res.json({ messages: [], canChat: false });
    let messages = [];
    try { messages = await getScriptMessages(scriptId, req.reader.id); }
    catch { messages = []; } // chat tables not migrated yet → empty, not an error
    res.json({ messages, canChat: true });
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

// POST /messages/:scriptId — post to the chat (fresh action token + champion gate).
router.post('/:scriptId', requireActionToken, async (req, res, next) => {
  try {
    const scriptId = req.params.scriptId;
    if (!UUID.test(scriptId)) return next(new AppError('Invalid script id', 400));
    const body = String(req.body?.body || '').trim();
    if (!body) return next(new AppError('Message is empty', 400));
    if (body.length > 4000) return next(new AppError('Message is too long', 400));
    if (!(await canChat(req.reader, scriptId))) {
      return next(new AppError('Only readers who championed this script can join the chat', 403, 'not_a_champion'));
    }
    let parentId = UUID.test(String(req.body?.parentId || '')) ? req.body.parentId : null;
    if (parentId) {
      const pm = await getMessageMeta(parentId).catch(() => null);
      if (!pm || pm.script_id !== scriptId) parentId = null; // ignore cross-script / missing parents
    }
    let msg;
    try { msg = await insertMessage({ scriptId, readerId: req.reader.id, parentId, body }); }
    catch { return next(new AppError('The chat is not available right now', 503, 'chat_unavailable')); } // fail-open (e.g. tables not migrated); never leak the raw DB error
    res.status(201).json(msg);
  } catch (err) { next(err instanceof AppError ? err : new AppError('Could not post message', 500)); }
});

// POST /messages/:messageId/endorse — endorse a peer's message (fresh action token).
// Endorser must be a champion of the message's script and not the author.
router.post('/:messageId/endorse', requireActionToken, async (req, res, next) => {
  try {
    const messageId = req.params.messageId;
    if (!UUID.test(messageId)) return next(new AppError('Invalid message id', 400));
    const meta = await getMessageMeta(messageId).catch(() => null);
    if (!meta) return next(new AppError('Message not found', 404));
    if (meta.reader_id === req.reader.id) return next(new AppError('You cannot endorse your own message', 400, 'self_endorse'));
    if (!(await canChat(req.reader, meta.script_id))) {
      return next(new AppError('Only champions of this script can endorse', 403, 'not_a_champion'));
    }
    try { await endorseMessage({ messageId, endorserId: req.reader.id }); }
    catch { return next(new AppError('The chat is not available right now', 503, 'chat_unavailable')); }
    res.json({ ok: true });
  } catch (err) { next(err instanceof AppError ? err : new AppError('Could not endorse', 500)); }
});

export default router;
