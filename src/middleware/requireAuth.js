import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function requireAuth(req, res, next) {
  let token;

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.cookies?.session) {
    token = req.cookies.session;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    // The portal passcode token (authController mints `{ authenticated: true }`) is the
    // ONLY credential for portal access. Reject reader identity/action tokens
    // (reader_session / leaderboard_action) — signed with the same secret but carrying a
    // `purpose` — if they're replayed here as Authorization to skip the passcode gate.
    if (payload.authenticated !== true) {
      return res
        .status(401)
        .json({ error: 'Invalid or expired session — please re-enter the passcode' });
    }
    req.auth = payload;
    next();
  } catch {
    return res
      .status(401)
      .json({ error: 'Invalid or expired session — please re-enter the passcode' });
  }
}
