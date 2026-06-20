import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function requireActionToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Action token required', code: 'action_token_missing' });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.purpose !== 'leaderboard_action') {
      return res.status(401).json({ error: 'Invalid token purpose', code: 'action_token_invalid' });
    }
    req.reader = { id: payload.readerId, handle: payload.handle };
    next();
  } catch {
    res.status(401).json({ error: 'Action token expired or invalid', code: 'action_token_expired' });
  }
}
