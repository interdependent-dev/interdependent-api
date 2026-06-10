import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyPasscode } from '../controllers/authController.js';

// A 4-digit passcode has only 10,000 combinations — without a limiter it can
// be brute-forced in minutes. Successful sign-ins don't count toward the
// limit, so several writers behind one office IP won't lock each other out.
const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a few minutes and try again' },
});

const router = Router();

// POST /auth/verify  — exchange a 4-digit passcode for a JWT
router.post('/verify', verifyLimiter, verifyPasscode);

export default router;
