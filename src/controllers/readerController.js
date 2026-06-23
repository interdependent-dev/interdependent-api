import { randomUUID } from 'crypto';
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
  getCredentialsByReaderId,
  getCredentialById,
  createCredential,
  updateCredentialCounter,
  storeChallenge,
  consumeChallenge,
} from '../services/readerService.js';

function buildHandle(firstName, lastName) {
  return `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
});

export async function registerBegin(req, res, next) {
  const parsed = registerBeginSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join('; ');
    return next(new AppError(msg, 400));
  }

  const { firstName, lastName } = parsed.data;
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
      metadata: { tempReaderId, handle, displayName },
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

  const { tempReaderId, handle, displayName } = stored.metadata ?? {};
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
    reader = await createReader({ id: tempReaderId, handle, displayName });
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
  res.status(201).json({ actionToken, readerId: reader.id, handle: reader.handle, displayName: reader.display_name });
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

  res.json({ actionToken, readerId: reader.id, handle: reader.handle, displayName: reader.display_name });
}

// ─── Public reader profile ───────────────────────────────────────────────────

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
