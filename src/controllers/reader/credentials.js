import { AppError } from '../../middleware/errorHandler.js';
import { createRegistrationOptions, finishRegistration } from '../../services/passkeyService.js';
import {
  getReaderById,
  getCredentialsByReaderId,
  createCredential,
  storeChallenge,
  consumeChallenge,
} from '../../services/readerService.js';
import { issueActionToken, issueReaderSession } from './shared.js';
import { addDeviceCompleteSchema } from '../../schemas/reader.js';

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

export async function addDeviceComplete(req, res, next) {
  const parsed = addDeviceCompleteSchema.safeParse(req.body);
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

  // The challenge must belong to the reader who authenticated for this request.
  const ownerId = stored.metadata?.addDeviceReaderId ?? stored.reader_id;
  if (!ownerId || ownerId !== req.reader.id) {
    return next(
      new AppError('Challenge does not belong to this reader', 403, 'challenge_mismatch'),
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
      return next(
        new AppError(
          'This passkey is already registered to the account',
          409,
          'already_registered',
        ),
      );
    }
    return next(new AppError(`Could not store credential: ${err.message}`, 500));
  }

  const reader = await getReaderById(req.reader.id);
  const actionToken = reader ? issueActionToken(reader) : null;
  const sessionToken = reader ? issueReaderSession(reader) : null;
  res.status(201).json({
    ok: true,
    credentialAdded: true,
    actionToken,
    sessionToken,
    readerId: req.reader.id,
    handle: reader?.handle,
    displayName: reader?.display_name,
    hasRecoveryEmail: !!reader?.email,
  });
}
