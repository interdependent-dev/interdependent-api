import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Permissive reader-identity middleware. If the request carries a valid reader
// SESSION token (in the `X-Reader-Session` header), attach
// `req.reader = { id, handle }`; otherwise leave it undefined. It NEVER fails the
// request — it only PERSONALIZES read responses (AI-eval gating, surfacing, chat
// visibility). Writes still require a fresh leaderboard_action token elsewhere.
export function optionalReader(req, _res, next) {
  const raw = req.headers['x-reader-session'];
  const token = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  if (token && typeof token === 'string') {
    try {
      const payload = jwt.verify(token, env.jwtSecret);
      if (payload.purpose === 'reader_session' && payload.readerId) {
        req.reader = { id: payload.readerId, handle: payload.handle };
      }
    } catch {
      /* invalid / expired → stay anonymous, no eval */
    }
  }
  next();
}
