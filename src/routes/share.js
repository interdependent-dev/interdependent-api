import { Router } from 'express';
import { getScriptById, createSignedPdfUrl } from '../services/supabaseService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// GET /share/:id — PUBLIC, no auth. A read-only, recommend-this-screenplay view.
// The UUID in the link is the access gate (unguessable). Deliberately omits all
// PII (submitter name/email) and internal fields; returns only what a recipient
// needs to evaluate the recommendation, plus a fresh short-lived signed URL so
// they can read the script. Any evaluated script is shareable by its link.
router.get('/:id', async (req, res, next) => {
  try {
    let row;
    try {
      row = await getScriptById(req.params.id);
    } catch {
      row = null; // bad id / not found
    }
    if (!row || row.status !== 'evaluated' || !row.evaluation_json) {
      return next(new AppError('This recommendation is not available', 404));
    }
    const ev = row.evaluation_json;

    let pdfUrl = null;
    if (row.storage_path) {
      // fresh signed URL on every load so the link never goes stale
      try { pdfUrl = await createSignedPdfUrl(row.storage_path, 3600); } catch { /* non-fatal */ }
    }

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      title: row.title,
      pageCount: row.page_count ?? null,
      genre: ev.genre ?? null,
      budget: ev.budget ?? (ev.max_budget != null ? `$${Number(ev.max_budget).toLocaleString()}` : null),
      decision: ev.decision ?? null,
      logline: ev.logline ?? null,
      readVerified: ev.read_verified ?? null,
      // BARAKA evaluation (craft_score + championability_rating). Legacy fields
      // included defensively for any not-yet-converted row.
      evaluation: ev.evaluation ?? null,
      scores: ev.scores ?? null,
      weightedScore: ev.weighted_score ?? null,
      comparableFilms: ev.comparable_films ?? null,
      pdfUrl,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
