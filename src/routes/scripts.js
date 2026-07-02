import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { isCuratorHandle } from '../services/xpService.js';
import {
  listScripts,
  getScriptById,
  downloadPDF,
  createSignedPdfUrl,
  markScriptProcessing,
  mergeScriptEvaluationJson,
  setScriptSurfaced,
} from '../services/supabaseService.js';
import { extractText } from '../services/pdfService.js';
import { runEvaluation } from '../controllers/evaluateController.js';
import { generateLogline } from '../services/anthropicService.js';
import { extractSynopsis, extractGenre } from '../lib/evalSynopsis.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// All script routes require the portal passcode. optionalReader ALSO attaches the
// caller's reader identity (if a reader session token is present) so we can gate
// the AI evaluation: regular Readers NEVER receive evaluation_json/evaluation_result
// — only Curators (earned XP tier) and admins do. Read-first, server-enforced.
router.use(requireAuth, optionalReader);

// Reader-safe fields projected onto every outgoing script row (ALL viewers,
// Curators included, so the shape is uniform): `synopsis` = the spoiler-free
// logline from the evaluation (never the spoiler-full summary, never
// scores/decision/championability; null when absent) and `genre`.
function withReaderSafeFields(script) {
  if (!script) return script;
  return {
    ...script,
    synopsis: extractSynopsis(script.evaluation_json, script.evaluation_result),
    genre: extractGenre(script.evaluation_json, script.evaluation_result),
  };
}

// Reader-safe projection for non-Curator callers: remove the AI evaluation
// (read-first wall) AND the submitter PII — readers must never receive the
// writer's name/email (submitter_* columns or the joined users row).
function stripEval(script) {
  if (!script) return script;
  const { evaluation_json, evaluation_result, submitter_name, submitter_email, users, ...rest } = script;
  return rest;
}

// GET /scripts?limit=50&offset=0
router.get('/', async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100);
  const offset = parseInt(req.query.offset ?? '0', 10);

  try {
    const canSeeEval = await isCuratorHandle(req.reader?.handle);
    // Read-first surfacing: Readers only see surfaced scripts; Curators see all (to curate).
    const scripts = (await listScripts({ limit, offset, surfacedOnly: !canSeeEval }))
      .map(withReaderSafeFields);
    res.json({ data: canSeeEval ? scripts : scripts.map(stripEval), limit, offset });
  } catch (err) {
    next(new AppError(err.message, 500));
  }
});

// POST /scripts/:id/surface  { surfaced?: boolean }  — a Curator/admin toggles whether
// Readers see this script in their slate. Identity comes from the reader session token
// (optionalReader); authority from isCuratorHandle. Defaults to surfacing (true).
router.post('/:id/surface', async (req, res, next) => {
  try {
    if (!(await isCuratorHandle(req.reader?.handle))) {
      return next(new AppError('Curator access required', 403, 'curator_required'));
    }
    const surfaced = req.body?.surfaced !== false;
    const row = await setScriptSurfaced({ id: req.params.id, surfaced });
    res.json(row);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// GET /scripts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const script = await getScriptById(req.params.id);
    if (!script) return next(new AppError('Script not found', 404));
    const canSeeEval = await isCuratorHandle(req.reader?.handle);
    const shaped = withReaderSafeFields(script);
    res.json(canSeeEval ? shaped : stripEval(shaped));
  } catch (err) {
    next(new AppError(err.message, 500));
  }
});

// GET /scripts/:id/pdf-url        → { url }  short-lived signed URL to read the PDF
// GET /scripts/:id/pdf-url?dl=1   → { url }  same, but forces a download with a clean name
// The bucket is private, so the browser reads the file through this signed URL
// rather than directly. URL expires in 10 minutes.
router.get('/:id/pdf-url', async (req, res, next) => {
  try {
    const row = await getScriptById(req.params.id);
    if (!row) return next(new AppError('Script not found', 404));
    if (!row.storage_path) {
      return next(new AppError('No stored PDF for this submission', 404));
    }
    const downloadName = req.query.dl === '1'
      ? `${String(row.title || 'script').replace(/[^\w.-]+/g, '_').slice(0, 80)}.pdf`
      : undefined;
    const url = await createSignedPdfUrl(row.storage_path, 600, downloadName);
    res.json({ url });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// POST /scripts/:id/retry        — re-run a failed/unscored evaluation from the stored PDF.
// POST /scripts/:id/retry?force=1 — re-evaluate ANY submission (even a good one), e.g.
//   after a rubric/prompt change. Covers outages and deliberate re-scoring.
router.post('/:id/retry', async (req, res, next) => {
  try {
    const row = await getScriptById(req.params.id);
    if (!row) return next(new AppError('Script not found', 404));
    // Retryable: failed outright, "evaluated" with no parsed scores, or an
    // explicit force re-evaluation.
    const retryable = req.query.force === '1'
      || row.status === 'error'
      || (row.status === 'evaluated' && !row.evaluation_json);
    if (!retryable) {
      return next(new AppError('Only failed or unscored evaluations can be retried (use ?force=1 to re-evaluate)', 409));
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
      pageCount: pdfData.pageCount,
      name: row.users?.name ?? 'Writer',
      email: row.users?.email ?? '',
      title: row.title,
      // A forced re-evaluation is an admin action — don't re-email the submitter.
      // A plain retry (first successful eval after a failure) still notifies.
      notify: req.query.force !== '1',
    }).catch((e) => console.error('background runEvaluation (retry) failed:', e?.message || e));
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

// POST /scripts/:id/logline — full-read pass that ADDS a spoiler-free logline
// (verified against the ending) without re-scoring. Backfills loglines onto
// already-scored submissions; existing scores/decision/summary are untouched.
router.post('/:id/logline', async (req, res, next) => {
  try {
    const row = await getScriptById(req.params.id);
    if (!row) return next(new AppError('Script not found', 404));
    if (!row.evaluation_json) {
      return next(new AppError('Script has no evaluation to attach a logline to', 409));
    }
    if (!req.query.force && row.evaluation_json.logline) {
      return next(new AppError('Script already has a logline (use ?force=1 to regenerate)', 409));
    }
    if (!row.storage_path) {
      return next(new AppError('No stored PDF for this submission', 422));
    }

    const buffer = await downloadPDF(row.storage_path);
    const pdfData = await extractText(buffer);

    res.status(202).json({ id: row.id, status: 'generating-logline', title: row.title });

    generateLogline(pdfData.text)
      .then((r) =>
        mergeScriptEvaluationJson({
          id: row.id,
          patch: { logline: r.logline, read_verified: r.readVerified },
        }).then(() =>
          console.log(`Logline for ${row.id} ("${row.title}") by ${r.modelUsed} (verified: ${r.readVerified})`),
        ),
      )
      .catch((err) => console.error(`Logline for ${row.id} ("${row.title}") failed: ${err.message}`));
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
