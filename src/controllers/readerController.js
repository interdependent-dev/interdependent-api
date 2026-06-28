import { randomUUID, randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import {
  createRegistrationOptions,
  finishRegistration,
  createAuthenticationOptions,
  finishAuthentication,
} from '../services/passkeyService.js';
import {
  getReaderByHandle,
  getReaderById,
  createReader,
  updateReaderEmail,
  getCredentialsByReaderId,
  getCredentialById,
  createCredential,
  updateCredentialCounter,
  storeChallenge,
  consumeChallenge,
  createRecoveryToken,
  getRecoveryTokenByHash,
  consumeRecoveryToken,
} from '../services/readerService.js';
import { sendRecoveryEmail } from '../services/emailService.js';

function buildHandle(firstName, lastName) {
  return `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Recovery email is the one channel that proves account ownership without a
// passkey, so normalize it consistently (trim + lowercase) everywhere it's
// stored or compared.
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const RECOVERY_TTL_MS = 30 * 60 * 1000; // 30 min

// Site origin for links in emails — the first configured CORS origin that is an
// interdependent.studio page (falls back to the first origin).
function siteOrigin() {
  return env.corsOrigins.find((o) => /interdependent\.studio/.test(o)) || env.corsOrigins[0];
}

function issueActionToken(reader) {
  return jwt.sign(
    { purpose: 'leaderboard_action', readerId: reader.id, handle: reader.handle },
    env.jwtSecret,
    { expiresIn: env.actionTokenExpiry },
  );
}

// ─── Registration ────────────────────────────────────────────────────────────

const registerBeginSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  // A recovery email is collected at registration so a reader who later loses
  // every passkey can prove ownership and add a new one.
  email: z.string().email('A valid email is required').max(254),
});

export async function registerBegin(req, res, next) {
  const parsed = registerBeginSchema.safeParse(req.body);
  if (!parsed.success) {
    const hasEmail = parsed.error.issues.find((i) => i.path[0] === 'email');
    const msg = parsed.error.issues.map((i) => i.message).join('; ');
    return next(new AppError(msg, 400, hasEmail ? 'email_required' : undefined));
  }

  const { firstName, lastName } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const handle = buildHandle(firstName, lastName);
  if (!handle) return next(new AppError('Handle could not be derived from the provided names', 400));

  const displayName = `${firstName} ${lastName}`;
  const tempReaderId = randomUUID();
  const userID = new TextEncoder().encode(tempReaderId);

  // Exclude existing credentials for this handle to avoid duplicate device registration
  let existingCreds = [];
  const existing = await getReaderByHandle(handle).catch(() => null);
  if (existing) {
    existingCreds = await getCredentialsByReaderId(existing.id).catch(() => []);
  }

  let options;
  try {
    options = await createRegistrationOptions({
      userID,
      userName: handle,
      userDisplayName: displayName,
      excludeCredentials: existingCreds,
    });
  } catch (err) {
    return next(new AppError(`Failed to generate registration options: ${err.message}`, 500));
  }

  let challengeId;
  try {
    challengeId = await storeChallenge({
      challenge: options.challenge,
      metadata: { tempReaderId, handle, displayName, email },
    });
  } catch (err) {
    return next(new AppError(`Failed to store challenge: ${err.message}`, 500));
  }

  res.json({ challengeId, options });
}

const registerCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

export async function registerComplete(req, res, next) {
  const parsed = registerCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError('challengeId (UUID) and credential are required', 400));
  }

  const { challengeId, credential } = parsed.data;

  let stored;
  try {
    stored = await consumeChallenge(challengeId);
  } catch (err) {
    return next(new AppError(`Challenge lookup failed: ${err.message}`, 500));
  }
  if (!stored) return next(new AppError('Challenge not found or expired', 400, 'challenge_expired'));

  const { tempReaderId, handle, displayName, email } = stored.metadata ?? {};
  if (!tempReaderId || !handle) {
    return next(new AppError('Challenge metadata missing — start registration again', 400));
  }

  let regInfo;
  try {
    regInfo = await finishRegistration({ credential, expectedChallenge: stored.challenge });
  } catch (err) {
    return next(new AppError(`Passkey verification failed: ${err.message}`, 400, 'passkey_verify_failed'));
  }

  // Reject if handle is already taken — returning readers on a new device
  // should use the discoverable auth flow, not re-register.
  const existing = await getReaderByHandle(handle).catch(() => null);
  if (existing) {
    return next(new AppError(`Handle '${handle}' is already registered`, 409, 'handle_taken'));
  }

  let reader;
  try {
    reader = await createReader({ id: tempReaderId, handle, displayName, email: email || null });
  } catch (err) {
    if (/duplicate|unique/i.test(err.message)) {
      return next(new AppError(`Handle '${handle}' is already registered`, 409, 'handle_taken'));
    }
    return next(new AppError(`Could not create reader: ${err.message}`, 500));
  }

  try {
    await createCredential({
      readerId: reader.id,
      credentialId: regInfo.credentialId,
      publicKey: regInfo.publicKey,
      counter: regInfo.counter,
      deviceType: regInfo.deviceType,
      backedUp: regInfo.backedUp,
      transports: regInfo.transports,
    });
  } catch (err) {
    return next(new AppError(`Could not store credential: ${err.message}`, 500));
  }

  // Mint an action token right away — the create() ceremony just proved user
  // presence, so the first write (e.g. Champion) shouldn't demand a second
  // passkey prompt immediately after registering.
  const actionToken = issueActionToken(reader);
  res.status(201).json({
    actionToken,
    readerId: reader.id,
    handle: reader.handle,
    displayName: reader.display_name,
    hasRecoveryEmail: !!reader.email,
  });
}

// ─── Authentication ──────────────────────────────────────────────────────────

const authBeginSchema = z.object({
  handle: z.string().optional(),
});

export async function authBegin(req, res, next) {
  const parsed = authBeginSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('Invalid request body', 400));

  const { handle } = parsed.data;

  let reader = null;
  let allowCredentials = [];

  if (handle) {
    reader = await getReaderByHandle(handle).catch(() => null);
    if (!reader) return next(new AppError('Reader not found', 404, 'reader_not_found'));
    allowCredentials = await getCredentialsByReaderId(reader.id).catch(() => []);
  }
  // If no handle — empty allowCredentials → discoverable credential flow

  let options;
  try {
    options = await createAuthenticationOptions({ allowCredentials });
  } catch (err) {
    return next(new AppError(`Failed to generate auth options: ${err.message}`, 500));
  }

  let challengeId;
  try {
    challengeId = await storeChallenge({
      challenge: options.challenge,
      readerId: reader?.id ?? null,
    });
  } catch (err) {
    return next(new AppError(`Failed to store challenge: ${err.message}`, 500));
  }

  res.json({ challengeId, options });
}

const authCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

export async function authComplete(req, res, next) {
  const parsed = authCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError('challengeId (UUID) and credential are required', 400));
  }

  const { challengeId, credential } = parsed.data;

  let stored;
  try {
    stored = await consumeChallenge(challengeId);
  } catch (err) {
    return next(new AppError(`Challenge lookup failed: ${err.message}`, 500));
  }
  if (!stored) return next(new AppError('Challenge not found or expired', 400, 'challenge_expired'));

  // The credential.id or credential.rawId tells us which credential was used
  const credentialId = credential.id;
  if (!credentialId) return next(new AppError('Missing credential id', 400));

  const storedCredential = await getCredentialById(credentialId).catch(() => null);
  if (!storedCredential) {
    return next(new AppError('Credential not recognized', 401, 'credential_not_found'));
  }

  let authInfo;
  try {
    authInfo = await finishAuthentication({
      credential,
      expectedChallenge: stored.challenge,
      storedCredential,
    });
  } catch (err) {
    return next(new AppError(`Passkey verification failed: ${err.message}`, 401, 'passkey_verify_failed'));
  }

  await updateCredentialCounter({ id: storedCredential.id, counter: authInfo.newCounter }).catch(() => {});

  // Cross-check userHandle when the browser returned one — it should decode
  // to the reader's UUID (set as userID bytes during registration).
  const userHandle = credential?.response?.userHandle;
  if (userHandle) {
    try {
      const { isoBase64URL } = await import('@simplewebauthn/server/helpers');
      const decoded = new TextDecoder().decode(isoBase64URL.toBuffer(userHandle));
      if (decoded !== storedCredential.reader_id) {
        return next(new AppError('Credential user binding mismatch', 401, 'passkey_verify_failed'));
      }
    } catch {
      // Malformed userHandle — treat as a verification failure
      return next(new AppError('Invalid userHandle in credential response', 401, 'passkey_verify_failed'));
    }
  }

  const reader = await getReaderById(storedCredential.reader_id);
  if (!reader) return next(new AppError('Reader account not found', 404));

  const actionToken = issueActionToken(reader);

  res.json({
    actionToken,
    readerId: reader.id,
    handle: reader.handle,
    displayName: reader.display_name,
    hasRecoveryEmail: !!reader.email,
  });
}

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
  res.json({ readerId: reader.id, handle: reader.handle, displayName: reader.display_name, createdAt: reader.created_at });
}

// ─── Set / update recovery email (authenticated) ─────────────────────────────
// Lets a signed-in reader add or change their recovery email. This is how the
// pre-recovery accounts backfill an email — sign in, then add one. Requires a
// fresh action token (requireActionToken sets req.reader).

const setEmailSchema = z.object({ email: z.string().email('A valid email is required').max(254) });

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

// ─── Add a device (authenticated) ────────────────────────────────────────────
// Register an ADDITIONAL passkey on an existing account. The reader must first
// authenticate with a passkey they already hold (requireActionToken), then this
// runs a normal create() ceremony bound to their existing reader id. Use when a
// reader wants a second passkey on a device they can already sign in on.

export async function addDeviceBegin(req, res, next) {
  let reader;
  try {
    reader = await getReaderById(req.reader.id);
  } catch (err) {
    return next(new AppError(`Reader lookup failed: ${err.message}`, 500));
  }
  if (!reader) return next(new AppError('Reader account not found', 404, 'reader_not_found'));

  const userID = new TextEncoder().encode(reader.id);
  const existingCreds = await getCredentialsByReaderId(reader.id).catch(() => []);

  let options;
  try {
    options = await createRegistrationOptions({
      userID,
      userName: reader.handle,
      userDisplayName: reader.display_name,
      excludeCredentials: existingCreds, // can't add a passkey this authenticator already holds
    });
  } catch (err) {
    return next(new AppError(`Failed to generate registration options: ${err.message}`, 500));
  }

  let challengeId;
  try {
    challengeId = await storeChallenge({
      challenge: options.challenge,
      readerId: reader.id,
      metadata: { addDeviceReaderId: reader.id },
    });
  } catch (err) {
    return next(new AppError(`Failed to store challenge: ${err.message}`, 500));
  }

  res.json({ challengeId, options });
}

const addDeviceCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

export async function addDeviceComplete(req, res, next) {
  const parsed = addDeviceCompleteSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('challengeId (UUID) and credential are required', 400));

  const { challengeId, credential } = parsed.data;

  let stored;
  try {
    stored = await consumeChallenge(challengeId);
  } catch (err) {
    return next(new AppError(`Challenge lookup failed: ${err.message}`, 500));
  }
  if (!stored) return next(new AppError('Challenge not found or expired', 400, 'challenge_expired'));

  // The challenge must belong to the reader who authenticated for this request.
  const ownerId = stored.metadata?.addDeviceReaderId ?? stored.reader_id;
  if (!ownerId || ownerId !== req.reader.id) {
    return next(new AppError('Challenge does not belong to this reader', 403, 'challenge_mismatch'));
  }

  let regInfo;
  try {
    regInfo = await finishRegistration({ credential, expectedChallenge: stored.challenge });
  } catch (err) {
    return next(new AppError(`Passkey verification failed: ${err.message}`, 400, 'passkey_verify_failed'));
  }

  try {
    await createCredential({
      readerId: req.reader.id,
      credentialId: regInfo.credentialId,
      publicKey: regInfo.publicKey,
      counter: regInfo.counter,
      deviceType: regInfo.deviceType,
      backedUp: regInfo.backedUp,
      transports: regInfo.transports,
    });
  } catch (err) {
    if (/duplicate|unique/i.test(err.message)) {
      return next(new AppError('This passkey is already registered to the account', 409, 'already_registered'));
    }
    return next(new AppError(`Could not store credential: ${err.message}`, 500));
  }

  const reader = await getReaderById(req.reader.id);
  const actionToken = reader ? issueActionToken(reader) : null;
  res.status(201).json({
    ok: true,
    credentialAdded: true,
    actionToken,
    readerId: req.reader.id,
    handle: reader?.handle,
    displayName: reader?.display_name,
    hasRecoveryEmail: !!reader?.email,
  });
}

// ─── Account recovery by email ───────────────────────────────────────────────
// For a reader who has lost every passkey. They prove ownership via the email
// on file, receive a one-time link, and register a fresh passkey under it.

const recoverRequestSchema = z.object({
  handle: z.string().min(1).max(80),
  email: z.string().email().max(254),
});

// Generic response — never reveals whether the handle exists or the email
// matched (prevents account / email enumeration).
const RECOVERY_GENERIC = {
  ok: true,
  message: 'If that account exists and the email matches the one on file, a recovery link is on its way.',
};

export async function recoverRequest(req, res, next) {
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
    console.error('recoverRequest error:', err.message);
  }

  res.json(RECOVERY_GENERIC);
}

const recoverBeginSchema = z.object({
  readerId: z.string().uuid(),
  token: z.string().min(32).max(128),
});

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
  const { error, row } = await validateRecoveryToken({ readerId, token }).catch(() => ({ error: 'recovery_invalid' }));
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

const recoverCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

export async function recoverComplete(req, res, next) {
  const parsed = recoverCompleteSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('challengeId (UUID) and credential are required', 400));

  const { challengeId, credential } = parsed.data;

  let stored;
  try {
    stored = await consumeChallenge(challengeId);
  } catch (err) {
    return next(new AppError(`Challenge lookup failed: ${err.message}`, 500));
  }
  if (!stored) return next(new AppError('Challenge not found or expired', 400, 'challenge_expired'));

  const readerId = stored.metadata?.recoverReaderId;
  const recoveryTokenId = stored.metadata?.recoveryTokenId;
  if (!readerId || !recoveryTokenId) {
    return next(new AppError('Recovery challenge metadata missing — start recovery again', 400, 'recovery_invalid'));
  }

  let regInfo;
  try {
    regInfo = await finishRegistration({ credential, expectedChallenge: stored.challenge });
  } catch (err) {
    return next(new AppError(`Passkey verification failed: ${err.message}`, 400, 'passkey_verify_failed'));
  }

  // Atomically spend the recovery token — the guarded update returns true only
  // for the first caller, so a replayed/concurrent completion can't double-add.
  let won;
  try {
    won = await consumeRecoveryToken(recoveryTokenId);
  } catch (err) {
    return next(new AppError(`Recovery token check failed: ${err.message}`, 500));
  }
  if (!won) return next(new AppError('This recovery link has already been used', 400, 'recovery_used'));

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
      return next(new AppError('That passkey is already registered — try signing in instead.', 409, 'already_registered'));
    }
    return next(new AppError(`Could not store credential: ${err.message}`, 500));
  }

  const reader = await getReaderById(readerId);
  if (!reader) return next(new AppError('Reader account not found', 404));

  const actionToken = issueActionToken(reader);
  res.status(201).json({
    actionToken,
    readerId: reader.id,
    handle: reader.handle,
    displayName: reader.display_name,
    hasRecoveryEmail: !!reader.email,
  });
}
