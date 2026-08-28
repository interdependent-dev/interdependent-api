import { randomBytes, createHash } from 'crypto';
import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { createRegistrationOptions, finishRegistration } from '../../services/passkeyService.js';
import {
  getReaderByHandle,
  getReaderById,
  getCredentialsByReaderId,
  createCredential,
  storeChallenge,
  consumeChallenge,
  createRecoveryToken,
  getRecoveryTokenByHash,
  consumeRecoveryToken,
} from '../../services/readerService.js';
import { sendRecoveryEmail } from '../../services/emailService.js';
import { normalizeEmail, issueActionToken, issueReaderSession } from './shared.js';
import {
  recoverRequestSchema,
  recoverBeginSchema,
  recoverCompleteSchema,
} from '../../schemas/reader.js';

const RECOVERY_TTL_MS = 30 * 60 * 1000; // 30 min

// Site origin for links in emails — the first configured CORS origin that is an
// interdependent.studio page (falls back to the first origin).
function siteOrigin() {
  return env.corsOrigins.find((o) => /interdependent\.studio/.test(o)) || env.corsOrigins[0];
}

// ─── Account recovery by email ───────────────────────────────────────────────
// For a reader who has lost every passkey. They prove ownership via the email
// on file, receive a one-time link, and register a fresh passkey under it.

// Generic response — never reveals whether the handle exists or the email
// matched (prevents account / email enumeration).
const RECOVERY_GENERIC = {
  ok: true,
  message:
    'If that account exists and the email matches the one on file, a recovery link is on its way.',
};

export async function recoverRequest(req, res, _next) {
  const parsed = recoverRequestSchema.safeParse(req.body);
  // Even malformed input returns the generic message — no enumeration signal.
  if (!parsed.success) return res.json(RECOVERY_GENERIC);

  const handle = String(parsed.data.handle).trim().toLowerCase();
  const email = normalizeEmail(parsed.data.email);

  try {
    const reader = await getReaderByHandle(handle).catch(() => null);
    // Only proceed when the account exists AND the supplied email matches the
    // one on file. Mismatch / no-email-on-file → silently do nothing.
    if (reader && reader.email && normalizeEmail(reader.email) === email) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + RECOVERY_TTL_MS).toISOString();
      await createRecoveryToken({
        readerId: reader.id,
        tokenHash,
        expiresAt,
        requestIp: req.ip ?? null,
      });

      const url = `${siteOrigin()}/recover.html?rid=${encodeURIComponent(reader.id)}&token=${rawToken}`;
      // Send to the address ON FILE (not the submitted one) — belt and braces.
      await sendRecoveryEmail({
        to: reader.email,
        displayName: reader.display_name,
        handle: reader.handle,
        recoverUrl: url,
        expiresMinutes: Math.round(RECOVERY_TTL_MS / 60000),
      });
    }
  } catch (err) {
    // Log, but still return the generic message so failures don't leak state.
    logger.error({ err }, 'recoverRequest failed');
  }

  res.json(RECOVERY_GENERIC);
}

// Validate the recovery token (hash match, right reader, unused, unexpired) and
// hand back passkey-registration options. The token is NOT consumed yet — it's
// spent on /recover/complete so a failed ceremony doesn't burn it.
async function validateRecoveryToken({ readerId, token }) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = await getRecoveryTokenByHash(tokenHash);
  if (!row || row.reader_id !== readerId) return { error: 'recovery_invalid' };
  if (row.used_at) return { error: 'recovery_used' };
  if (new Date(row.expires_at) < new Date()) return { error: 'recovery_expired' };
  return { row };
}

export async function recoverBegin(req, res, next) {
  const parsed = recoverBeginSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('Invalid recovery link', 400, 'recovery_invalid'));

  const { readerId, token } = parsed.data;
  const { error, row } = await validateRecoveryToken({ readerId, token }).catch(() => ({
    error: 'recovery_invalid',
  }));
  if (error) return next(new AppError('This recovery link is no longer valid', 400, error));

  const reader = await getReaderById(readerId).catch(() => null);
  if (!reader) return next(new AppError('Reader account not found', 404, 'reader_not_found'));

  const userID = new TextEncoder().encode(reader.id);
  const existingCreds = await getCredentialsByReaderId(reader.id).catch(() => []);

  let options;
  try {
    options = await createRegistrationOptions({
      userID,
      userName: reader.handle,
      userDisplayName: reader.display_name,
      excludeCredentials: existingCreds,
    });
  } catch (err) {
    return next(new AppError(`Failed to generate registration options: ${err.message}`, 500));
  }

  let challengeId;
  try {
    challengeId = await storeChallenge({
      challenge: options.challenge,
      readerId: reader.id,
      metadata: { recoverReaderId: reader.id, recoveryTokenId: row.id },
    });
  } catch (err) {
    return next(new AppError(`Failed to store challenge: ${err.message}`, 500));
  }

  res.json({ challengeId, options, handle: reader.handle, displayName: reader.display_name });
}

export async function recoverComplete(req, res, next) {
  const parsed = recoverCompleteSchema.safeParse(req.body);
  if (!parsed.success)
    return next(new AppError('challengeId (UUID) and credential are required', 400));

  const { challengeId, credential } = parsed.data;

  let stored;
  try {
    stored = await consumeChallenge(challengeId);
  } catch (err) {
    return next(new AppError(`Challenge lookup failed: ${err.message}`, 500));
  }
  if (!stored)
    return next(new AppError('Challenge not found or expired', 400, 'challenge_expired'));

  const readerId = stored.metadata?.recoverReaderId;
  const recoveryTokenId = stored.metadata?.recoveryTokenId;
  if (!readerId || !recoveryTokenId) {
    return next(
      new AppError(
        'Recovery challenge metadata missing — start recovery again',
        400,
        'recovery_invalid',
      ),
    );
  }

  let regInfo;
  try {
    regInfo = await finishRegistration({ credential, expectedChallenge: stored.challenge });
  } catch (err) {
    return next(
      new AppError(`Passkey verification failed: ${err.message}`, 400, 'passkey_verify_failed'),
    );
  }

  // Atomically spend the recovery token — the guarded update returns true only
  // for the first caller, so a replayed/concurrent completion can't double-add.
  let won;
  try {
    won = await consumeRecoveryToken(recoveryTokenId);
  } catch (err) {
    return next(new AppError(`Recovery token check failed: ${err.message}`, 500));
  }
  if (!won)
    return next(new AppError('This recovery link has already been used', 400, 'recovery_used'));

  try {
    await createCredential({
      readerId,
      credentialId: regInfo.credentialId,
      publicKey: regInfo.publicKey,
      counter: regInfo.counter,
      deviceType: regInfo.deviceType,
      backedUp: regInfo.backedUp,
      transports: regInfo.transports,
    });
  } catch (err) {
    if (/duplicate|unique/i.test(err.message)) {
      return next(
        new AppError(
          'That passkey is already registered — try signing in instead.',
          409,
          'already_registered',
        ),
      );
    }
    return next(new AppError(`Could not store credential: ${err.message}`, 500));
  }

  const reader = await getReaderById(readerId);
  if (!reader) return next(new AppError('Reader account not found', 404));

  const actionToken = issueActionToken(reader);
  const sessionToken = issueReaderSession(reader);
  res.status(201).json({
    actionToken,
    sessionToken,
    readerId: reader.id,
    handle: reader.handle,
    displayName: reader.display_name,
    hasRecoveryEmail: !!reader.email,
  });
}
