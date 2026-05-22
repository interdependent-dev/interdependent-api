import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listScripts, getScriptById } from '../services/supabaseService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// All script routes require authentication
router.use(requireAuth);

// GET /scripts?limit=50&offset=0
router.get('/', async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100);
  const offset = parseInt(req.query.offset ?? '0', 10);

  try {
    const scripts = await listScripts({ limit, offset });
    res.json({ data: scripts, limit, offset });
  } catch (err) {
    next(new AppError(err.message, 500));
  }
});

// GET /scripts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const script = await getScriptById(req.params.id);
    if (!script) return next(new AppError('Script not found', 404));
    res.json(script);
  } catch (err) {
    next(new AppError(err.message, 500));
  }
});

export default router;
