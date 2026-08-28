import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

// Recovery email is the one channel that proves account ownership without a
// passkey, so normalize it consistently (trim + lowercase) everywhere it's
// stored or compared.
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function issueActionToken(reader) {
  return jwt.sign(
    { purpose: 'leaderboard_action', readerId: reader.id, handle: reader.handle },
    env.jwtSecret,
    { expiresIn: env.actionTokenExpiry },
  );
}

// A long-lived reader IDENTITY token — proves who the reader is for READ
// personalization (AI-eval gating, surfacing, chat visibility). It is NOT
// accepted for writes; those still require a fresh leaderboard_action token.
export function issueReaderSession(reader) {
  return jwt.sign(
    { purpose: 'reader_session', readerId: reader.id, handle: reader.handle },
    env.jwtSecret,
    { expiresIn: env.readerSessionExpiry },
  );
}
