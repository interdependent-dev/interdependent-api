import { Router } from 'express';
import { getScriptById, createSignedPdfUrl } from '../services/supabaseService.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { isCuratorHandle } from '../services/xpService.js';
import { extractSynopsis } from '../lib/evalSynopsis.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// GET /share/:id — PUBLIC, no auth. A read-only, recommend-this-screenplay view.
// The UUID in the link is the access gate (unguessable). Deliberately omits all
// PII (submitter name/email) and internal fields; returns only what a recipient
// needs to evaluate the recommendation, plus a fresh short-lived signed URL so
// they can read the script. Any evaluated script is shareable by its link.
router.get('/:id', optionalReader, async (req, res, next) => {
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

    const canSeeEval = await isCuratorHandle(req.reader?.handle);
    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      title: row.title,
      pageCount: row.page_count ?? null,
      genre: ev.genre ?? null,
      logline: ev.logline ?? null, // spoiler-free hook — helps a recipient decide to READ; not a verdict
      // `synopsis` = the same spoiler-free logline under the uniform field name
      // the portal uses on /scripts responses (defensively re-extracted so a
      // fenced-string row still yields it).
      synopsis: extractSynopsis(ev, row.evaluation_result),
      pdfUrl,
      // The AI verdict is Curator-only. A recommend recipient (a Reader) never sees
      // the decision/score/coverage — they read it first, unbiased.
      ...(canSeeEval ? {
        budget: ev.budget ?? (ev.max_budget != null ? `$${Number(ev.max_budget).toLocaleString()}` : null),
        decision: ev.decision ?? null,
        readVerified: ev.read_verified ?? null,
        // BARAKA evaluation (craft_score + championability_rating). Legacy fields
        // included defensively for any not-yet-converted row.
        evaluation: ev.evaluation ?? null,
        scores: ev.scores ?? null,
        weightedScore: ev.weighted_score ?? null,
        comparableFilms: ev.comparable_films ?? null,
      } : {}),
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});

export default router;
