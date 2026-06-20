import { Router } from 'express';
import { requireActionToken } from '../middleware/requireActionToken.js';
import {
  getLeaderboard,
  addScript,
  removeScript,
  reorderScripts,
} from '../controllers/leaderboardController.js';

const router = Router();

// Public — anyone can view a reader's leaderboard
router.get('/:handle', getLeaderboard);

// Write operations — require a valid action token from /readers/auth/complete
router.post('/:handle/scripts', requireActionToken, addScript);
router.delete('/:handle/scripts/:scriptId', requireActionToken, removeScript);
router.put('/:handle/order', requireActionToken, reorderScripts);

export default router;
