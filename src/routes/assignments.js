// ─────────────────────────────────────────────────────────────────────────────
// Assigned reads — STAFF surface. Staff (handle ∈ ADMIN_HANDLES) assign a
// script to a reader, list every assignment, or withdraw one. The reader-facing
// side lives on /readers/me/assignments + /readers/me/inbox (routes/readers.js).
//
// Auth follows the house pattern (see POST /scripts/:id/surface): identity comes
// from the reader token, authority from the handle — here ADMIN_HANDLES
// membership, NOT Curator XP (a high-XP reader must not assign work). Writes
// require a fresh passkey ACTION token (like every other reader write); the
// read uses the portal passcode + the long-lived session identity.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireActionToken } from '../middleware/requireActionToken.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { env } from '../config/env.js';
import { getReaderByHandle } from '../services/readerService.js';
import { getScriptById } from '../services/supabaseService.js';
import {
  createAssignment,
  listAssignments,
  deleteAssignment,
} from '../services/assignmentService.js';
import { AppError } from '../middleware/errorHandler.js';
import { UUID } from '../lib/ids.js';

const router = Router();

// Staff = the caller's PROVEN handle is on the admin allowlist. req.reader must
// have been attached by requireActionToken (writes) or optionalReader (reads).
function requireStaff(req, _res, next) {
  const handle = String(req.reader?.handle || '').toLowerCase();
  if (!handle || !env.adminHandles.has(handle)) {
    return next(new AppError('Staff access required', 403, 'staff_required'));
  }
  next();
}

// POST /assignments { readerHandle, scriptId, note? } — assign a script to a reader.
router.post('/', requireActionToken, requireStaff, async (req, res, next) => {
  try {
    const { readerHandle, scriptId, note } = req.body || {};
    if (typeof readerHandle !== 'string' || !readerHandle.trim()) {
      return next(new AppError('readerHandle is required', 400));
    }
    if (typeof scriptId !== 'string' || !UUID.test(scriptId)) {
      return next(new AppError('A valid scriptId is required', 400));
    }
    const wanted = readerHandle.trim();
    const reader =
      (await getReaderByHandle(wanted).catch(() => null)) ||
      (await getReaderByHandle(wanted.toLowerCase()).catch(() => null));
    if (!reader) return next(new AppError('Reader not found', 404));
    const script = await getScriptById(scriptId).catch(() => null);
    if (!script) return next(new AppError('Script not found', 404));

    let row;
    try {
      row = await createAssignment({
        readerId: reader.id,
        scriptId,
        assignedBy: req.reader.handle,
        note: typeof note === 'string' && note.trim() ? note.slice(0, 2000) : null,
      });
    } catch (e) {
      if (e.duplicate) {
        return next(
          new AppError('This script is already assigned to that reader', 409, 'assignment_exists'),
        );
      }
      throw e;
    }
    res.status(201).json({
      id: row.id,
      readerHandle: reader.handle,
      readerName: reader.display_name || reader.handle,
      scriptId: row.script_id,
      title: script.title ?? null,
      note: row.note,
      assignedBy: row.assigned_by,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// GET /assignments — every assignment with reader + script + decided state.
router.get('/', requireAuth, optionalReader, requireStaff, async (_req, res, next) => {
  try {
    const rows = await listAssignments();
    res.json({
      assignments: rows.map((a) => ({
        id: a.id,
        readerHandle: a.readers?.handle ?? null,
        readerName: a.readers?.display_name || a.readers?.handle || null,
        scriptId: a.script_id,
        title: a.scripts?.title ?? null,
        note: a.note,
        assignedBy: a.assigned_by,
        createdAt: a.created_at,
        decidedAt: a.decided_at,
        decided: !!a.decided_at,
      })),
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// DELETE /assignments/:id — withdraw an assignment.
router.delete('/:id', requireActionToken, requireStaff, async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return next(new AppError('Invalid assignment id', 400));
    const removed = await deleteAssignment(req.params.id);
    if (!removed) return next(new AppError('Assignment not found', 404));
    res.json({ ok: true });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
