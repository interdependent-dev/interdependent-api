import { randomBytes } from 'crypto';
import { AppError } from '../../middleware/errorHandler.js';
import {
  getReaderByHandle,
  getReaderById,
  updateReaderEmail,
  uploadReaderAvatar,
  deleteReaderAvatar,
  updateReaderPhoto,
  publicPhotoUrl,
} from '../../services/readerService.js';
import { normalizeEmail } from './shared.js';
import { setEmailSchema } from '../../schemas/reader.js';

// ─── Public reader profile ───────────────────────────────────────────────────
// Public — never leak the recovery email here.

export async function getReader(req, res, next) {
  let reader;
  try {
    reader = await getReaderByHandle(req.params.handle);
  } catch (err) {
    return next(new AppError(err.message, 500));
  }
  if (!reader) return next(new AppError('Reader not found', 404));
  res.json({
    readerId: reader.id,
    handle: reader.handle,
    displayName: reader.display_name,
    photoUrl: publicPhotoUrl(reader.photo_path),
    createdAt: reader.created_at,
  });
}

// ─── Profile photo (authenticated) ───────────────────────────────────────────
// Upload/replace this reader's avatar. multipart field 'photo'. Stored in a
// public bucket; only the object key lives on the reader. Requires a fresh
// action token (requireActionToken sets req.reader).

const PHOTO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function uploadPhoto(req, res, next) {
  if (!req.file || !req.file.buffer) return next(new AppError('No image uploaded', 400, 'no_file'));
  const ext = PHOTO_EXT[req.file.mimetype];
  if (!ext) return next(new AppError('Photo must be a PNG, JPEG, or WebP image', 400, 'bad_image'));

  let reader;
  try {
    reader = await getReaderById(req.reader.id);
  } catch (err) {
    return next(new AppError(`Reader lookup failed: ${err.message}`, 500));
  }
  if (!reader) return next(new AppError('Reader account not found', 404, 'reader_not_found'));

  const oldPath = reader.photo_path;
  // New random key each upload → the public URL changes, so caches never serve a stale avatar.
  const key = `${reader.id}-${randomBytes(4).toString('hex')}.${ext}`;

  try {
    await uploadReaderAvatar({ path: key, buffer: req.file.buffer, contentType: req.file.mimetype });
  } catch (err) {
    return next(new AppError(`Upload failed: ${err.message}`, 500));
  }

  let updated;
  try {
    updated = await updateReaderPhoto({ id: reader.id, photoPath: key });
  } catch (err) {
    await deleteReaderAvatar(key); // don't orphan the just-uploaded object
    return next(new AppError(`Could not save photo: ${err.message}`, 500));
  }

  if (oldPath && oldPath !== key) await deleteReaderAvatar(oldPath);
  res.json({ ok: true, handle: updated.handle, photoUrl: publicPhotoUrl(updated.photo_path) });
}

// ─── Set / update recovery email (authenticated) ─────────────────────────────
// Lets a signed-in reader add or change their recovery email. This is how the
// pre-recovery accounts backfill an email — sign in, then add one. Requires a
// fresh action token (requireActionToken sets req.reader).

// Read the signed-in reader's saved recovery email (or null). Same trust level
// as setRecoveryEmail (requireActionToken) — the reader is derived from the
// action token, never a path param, so one reader can't read another's email.
export async function getRecoveryEmail(req, res, next) {
  let reader;
  try {
    reader = await getReaderById(req.reader.id);
  } catch (err) {
    return next(new AppError(`Could not load recovery email: ${err.message}`, 500));
  }
  if (!reader) return next(new AppError('Reader account not found', 404, 'reader_not_found'));
  res.json({ email: reader.email || null });
}

export async function setRecoveryEmail(req, res, next) {
  const parsed = setEmailSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('A valid email is required', 400, 'email_required'));

  const email = normalizeEmail(parsed.data.email);
  try {
    const reader = await updateReaderEmail({ id: req.reader.id, email });
    res.json({ ok: true, handle: reader.handle, hasRecoveryEmail: !!reader.email });
  } catch (err) {
    next(new AppError(`Could not save recovery email: ${err.message}`, 500));
  }
}
