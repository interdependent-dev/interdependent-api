import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireActionToken } from '../middleware/requireActionToken.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { isCuratorHandle } from '../services/xpService.js';
import {
  getScriptById, insertFeedback, setFeedbackAudio, uploadFeedbackAudio, listFeedback,
  createSignedPdfUrl, mergeScriptEvaluationJson, getReaderScriptRead, getScriptPageCount,
} from '../services/supabaseService.js';
import { isFinishedRead } from '../lib/readGate.js';
import { recalibrateWithFeedback } from '../services/anthropicService.js';
import { notifyReaderActivity } from '../services/xpEmailService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const UUID = /^[0-9a-fA-F-]{36}$/;

// Reader submits feedback — authenticated by a passkey action token (same as
// Champion). Body may carry a base64 voice note (this router is mounted with a
// larger JSON limit). Stored against the script + the reader.
router.post('/:scriptId', requireActionToken, async (req, res, next) => {
  try {
    const scriptId = req.params.scriptId;
    if (!UUID.test(scriptId)) return next(new AppError('Invalid script id', 400));
    const { championVerdict, dimensions, text, transcript, audioBase64, audioExt } = req.body || {};
    if (!championVerdict && !text && !transcript && !audioBase64) {
      return next(new AppError('Feedback is empty', 400));
    }
    const script = await getScriptById(scriptId).catch(() => null);
    if (!script) return next(new AppError('Script not found', 404));

    const id = await insertFeedback({
      scriptId, readerId: req.reader.id,
      championVerdict: typeof championVerdict === 'string' ? championVerdict.slice(0, 24) : null,
      dimensions: dimensions && typeof dimensions === 'object' ? dimensions : null,
      text: typeof text === 'string' ? text.slice(0, 8000) : null,
      transcript: typeof transcript === 'string' ? transcript.slice(0, 16000) : null,
    });

    if (audioBase64) {
      try {
        const buf = Buffer.from(String(audioBase64).split(',').pop(), 'base64');
        if (buf.length > 1000 && buf.length < 8_000_000) {
          const path = await uploadFeedbackAudio({ scriptId, feedbackId: id, buffer: buf, ext: audioExt });
          await setFeedbackAudio({ id, audioPath: path });
        }
      } catch (e) { console.error('feedback audio upload failed:', e.message); }
    }
    res.status(201).json({ id });
    // fire-and-forget: a first-review thank-you + any newly-unlocked perk emails.
    // Never blocks or fails the response.
    notifyReaderActivity({ readerId: req.reader.id, handle: req.reader.handle, kind: 'feedback', scriptTitle: script.title });
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

// List a script's feedback + any persisted calibration. `calibration` is
// AI-verdict-derived, so it is CURATOR-ONLY (read-first wall) — stripped for Readers.
router.get('/:scriptId', requireAuth, optionalReader, async (req, res, next) => {
  try {
    const scriptId = req.params.scriptId;
    const [fb, script, canSeeEval] = await Promise.all([
      listFeedback(scriptId),
      getScriptById(scriptId).catch(() => null),
      isCuratorHandle(req.reader?.handle),
    ]);
    // Read-first: you see OTHER readers' opinions only AFTER your own finished read
    // (or as a Curator) — the human verdicts can't bias you before you read either.
    let canSeeOpinions = canSeeEval;
    if (!canSeeOpinions && req.reader?.id) {
      try {
        const [{ depth, seconds }, pages] = await Promise.all([
          getReaderScriptRead(req.reader.id, scriptId),
          getScriptPageCount(scriptId),
        ]);
        canSeeOpinions = isFinishedRead(depth, seconds, pages);
      } catch { canSeeOpinions = false; } // read-status hiccup → withhold (fail-safe), never 500 the endpoint
    }
    const out = canSeeOpinions ? await Promise.all(fb.map(async (f) => ({
      id: f.id,
      reader: f.readers?.display_name || f.readers?.handle || 'A reader',
      handle: f.readers?.handle || null, // for "who agreed/disagreed" discovery
      createdAt: f.created_at,
      championVerdict: f.champion_verdict,
      dimensions: f.dimensions,
      text: f.text,
      transcript: f.transcript,
      audioUrl: f.audio_path ? await createSignedPdfUrl(f.audio_path, 3600).catch(() => null) : null,
    }))) : [];
    // The COUNT is safe to show pre-read (it signals "there's a conversation here"
    // without revealing any verdict) — it encourages the read.
    res.json({
      feedback: out,
      canSeeOpinions,
      totalOpinions: fb.filter((f) => (f.champion_verdict || '').trim()).length, // verdict-bearing only (matches the panel)
      calibration: canSeeEval ? (script?.evaluation_json?.calibration ?? null) : null,
    });
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

// Re-calibrate the AI evaluation against reader feedback — a CURATOR/admin action
// (it exposes + persists the AI verdict and runs a live model call). Curator-gated.
router.post('/:scriptId/recalibrate', requireAuth, optionalReader, async (req, res, next) => {
  try {
    if (!(await isCuratorHandle(req.reader?.handle))) {
      return next(new AppError('Curator access required', 403, 'curator_required'));
    }
    const scriptId = req.params.scriptId;
    const script = await getScriptById(scriptId).catch(() => null);
    if (!script || !script.evaluation_json) return next(new AppError('Script has no evaluation', 404));
    const fb = await listFeedback(scriptId);
    if (!fb.length) return next(new AppError('No reader feedback to calibrate from yet', 400));

    const ev = script.evaluation_json;
    const calibration = await recalibrateWithFeedback({
      title: script.title,
      evaluation: ev.evaluation || { scores: ev.scores, weighted_score: ev.weighted_score, decision: ev.decision },
      feedback: fb.map((f) => ({ verdict: f.champion_verdict, dimensions: f.dimensions, note: f.text || f.transcript || '' })),
    });
    await mergeScriptEvaluationJson({
      id: scriptId,
      patch: { calibration: { ...calibration, readerCount: fb.length, calibratedAt: new Date().toISOString() } },
    });
    res.json({ calibration, readerCount: fb.length });
  } catch (err) { next(err instanceof AppError ? err : new AppError(err.message, 500)); }
});

export default router;
