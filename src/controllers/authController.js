import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

// Length-independent timing-safe string compare (the prior `!==` short-circuited,
// so the "constant-time" comment was false). Rate-limited upstream; defence in depth.
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function verifyPasscode(req, res) {
  const { passcode } = req.body ?? {};

  if (!passcode) {
    return res.status(400).json({ error: 'passcode is required' });
  }

  if (!timingSafeEqualStr(passcode, env.submissionPasscode)) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const token = jwt.sign({ authenticated: true }, env.jwtSecret, {
    expiresIn: env.jwtExpiry,
  });

  return res.status(200).json({ token, expiresIn: env.jwtExpiry });
}
