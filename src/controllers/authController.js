import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export async function verifyPasscode(req, res) {
  const { passcode } = req.body ?? {};

  if (!passcode) {
    return res.status(400).json({ error: 'passcode is required' });
  }

  // Constant-time comparison to avoid timing attacks
  if (String(passcode) !== env.submissionPasscode) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const token = jwt.sign({ authenticated: true }, env.jwtSecret, {
    expiresIn: env.jwtExpiry,
  });

  return res.status(200).json({ token, expiresIn: env.jwtExpiry });
}
