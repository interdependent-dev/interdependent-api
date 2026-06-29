import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { publicConfig } from '../lib/xpConfig.js';
import { getAllReaderXp } from '../services/xpService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Public — the static economy (levels, colors, rewards, points) the XP bar
// fetches once to render its zones. No reader data, safe to expose.
router.get('/config', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(publicConfig());
});

// Gated — every reader ranked by XP, for the leaderboard (same portal passcode
// as the rest of the dashboard surfaces).
router.get('/leaderboard', requireAuth, async (_req, res, next) => {
  try {
    res.json({ readers: await getAllReaderXp() });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
