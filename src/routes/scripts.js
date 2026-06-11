import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  listScripts,
  getScriptById,
  downloadPDF,
  markScriptProcessing,
} from '../services/supabaseService.js';
import { extractText } from '../services/pdfService.js';
import { runEvaluation } from '../controllers/evaluateController.js';
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

// POST /scripts/:id/retry — re-run a failed evaluation from the stored PDF.
// Covers outages (e.g. exhausted API credits) without writers resubmitting.
router.post('/:id/retry', async (req, res, next) => {
  try {
    const row = await getScriptById(req.params.id);
    if (!row) return next(new AppError('Script not found', 404));
    if (row.status !== 'error') {
      return next(new AppError('Only failed evaluations can be retried', 409));
    }
    if (!row.storage_path) {
      return next(new AppError('No stored PDF for this submission — please resubmit the file', 422));
    }

    const buffer = await downloadPDF(row.storage_path);
    const pdfData = await extractText(buffer);
    await markScriptProcessing({ id: row.id });

    res.status(202).json({ id: row.id, status: 'processing', title: row.title });

    runEvaluation({
      script: { id: row.id },
      pdfText: pdfData.text,
      name: row.users?.name ?? 'Writer',
      email: row.users?.email ?? '',
      title: row.title,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
