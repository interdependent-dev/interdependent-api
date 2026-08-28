import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { getReaderByHandle } from '../services/readerService.js';
import { getScriptById } from '../services/supabaseService.js';
import { notifyReaderActivity } from '../services/xpEmailService.js';
import {
  getLeaderboardByReaderId,
  getLeaderboardEntry,
  addToLeaderboard,
  removeFromLeaderboard,
  reorderLeaderboard,
} from '../services/leaderboardService.js';

async function resolveReader(handle, next) {
  let reader;
  try {
    reader = await getReaderByHandle(handle);
  } catch (err) {
    next(new AppError(err.message, 500));
    return null;
  }
  if (!reader) {
    next(new AppError('Reader not found', 404, 'reader_not_found'));
    return null;
  }
  return reader;
}

function formatLeaderboard(reader, entries) {
  return {
    handle: reader.handle,
    displayName: reader.display_name,
    scripts: entries.map((e) => ({
      position: e.position,
      addedAt: e.added_at,
      script: e.scripts,
    })),
  };
}

// GET /leaderboard/:handle  — public
export async function getLeaderboard(req, res, next) {
  const reader = await resolveReader(req.params.handle, next);
  if (!reader) return;

  let entries;
  try {
    entries = await getLeaderboardByReaderId(reader.id);
  } catch (err) {
    return next(new AppError(err.message, 500));
  }

  res.json(formatLeaderboard(reader, entries));
}

// POST /leaderboard/:handle/scripts  — requires actionToken
export async function addScript(req, res, next) {
  const reader = await resolveReader(req.params.handle, next);
  if (!reader) return;

  if (req.reader.id !== reader.id) {
    return next(new AppError('You can only modify your own leaderboard', 403));
  }

  const parsed = z.object({ scriptId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return next(new AppError('scriptId (UUID) is required', 400));

  const { scriptId } = parsed.data;

  let script;
  try {
    script = await getScriptById(scriptId);
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
  if (!script) return next(new AppError('Script not found', 404));

  const existing = await getLeaderboardEntry(reader.id, scriptId).catch(() => null);
  if (existing)
    return next(
      new AppError('Script is already on this leaderboard', 409, 'already_on_leaderboard'),
    );

  try {
    await addToLeaderboard(reader.id, scriptId);
  } catch (err) {
    return next(new AppError(err.message, 500));
  }

  const entries = await getLeaderboardByReaderId(reader.id);
  res.status(201).json(formatLeaderboard(reader, entries));
  // fire-and-forget: a first-champion thank-you + any newly-unlocked perk emails.
  notifyReaderActivity({
    readerId: reader.id,
    handle: reader.handle,
    kind: 'champion',
    scriptTitle: script.title,
  });
}

// DELETE /leaderboard/:handle/scripts/:scriptId  — requires actionToken
export async function removeScript(req, res, next) {
  const reader = await resolveReader(req.params.handle, next);
  if (!reader) return;

  if (req.reader.id !== reader.id) {
    return next(new AppError('You can only modify your own leaderboard', 403));
  }

  let removed;
  try {
    removed = await removeFromLeaderboard(reader.id, req.params.scriptId);
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
  if (!removed) return next(new AppError('Script not found on leaderboard', 404));

  const entries = await getLeaderboardByReaderId(reader.id);
  res.json(formatLeaderboard(reader, entries));
}

// PUT /leaderboard/:handle/order  — requires actionToken
export async function reorderScripts(req, res, next) {
  const reader = await resolveReader(req.params.handle, next);
  if (!reader) return;

  if (req.reader.id !== reader.id) {
    return next(new AppError('You can only modify your own leaderboard', 403));
  }

  const parsed = z.object({ scriptIds: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
  if (!parsed.success)
    return next(new AppError('scriptIds must be a non-empty array of UUIDs', 400));

  try {
    await reorderLeaderboard(reader.id, parsed.data.scriptIds);
  } catch (err) {
    return next(new AppError(err.message, 400));
  }

  const entries = await getLeaderboardByReaderId(reader.id);
  res.json(formatLeaderboard(reader, entries));
}
