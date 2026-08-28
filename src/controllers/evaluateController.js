import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';
import { extractText } from '../services/pdfService.js';
import {
  evaluateScreenplay,
  detectTranslation,
  verifyRecommendation,
} from '../services/anthropicService.js';
import { screenplayFormatGate } from '../services/formatGate.js';
import {
  sendEvaluationEmail,
  sendFailureAlert,
  sendRevisionRequest,
} from '../services/emailService.js';
import {
  upsertUser,
  saveScript,
  uploadPDF,
  updateScriptStoragePath,
  updateScriptEvaluation,
  markScriptError,
  markScriptRejected,
} from '../services/supabaseService.js';

const submitSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email('email must be a valid email address'),
  title: z.string().min(1, 'title is required'),
});

/**
 * Runs after the 202 response is sent. Every outcome is persisted: success
 * marks the row evaluated, any failure marks it errored with the reason and
 * alerts the admin — a submission can never silently vanish.
 * Exported so the retry route can re-run stored submissions.
 */
export async function runEvaluation({
  script,
  pdfText,
  name,
  email,
  title,
  pageCount = 0,
  notify = true,
}) {
  try {
    // ── Pre-evaluation gates ──────────────────────────────────────────────────
    // A malformed or clearly-translated submission is REJECTED before it is ever
    // scored — so a broken file can never be evaluated, recommended, or shown with
    // a score. The writer is asked to fix it and resubmit.

    // 1) Formatting (pure code, no API cost): not in standard screenplay format.
    const fmt = screenplayFormatGate(pdfText, { pageCount });
    if (!fmt.ok) {
      return rejectSubmission({
        script,
        name,
        email,
        title,
        notify,
        kind: 'format',
        reason: fmt.reasons.map((r) => r.detail).join(' '),
        detail: { kind: 'format', reasons: fmt.reasons, metrics: fmt.metrics },
      });
    }

    // 2) Translation (cheap screen): a clumsy English translation. Strict threshold
    //    (significant + high confidence) so intentional dialect is never rejected.
    const tr = await detectTranslation(pdfText);
    if (tr.translated && tr.severity === 'significant' && (tr.confidence ?? 0) >= 0.85) {
      const lang = tr.original_language ? ` from ${tr.original_language}` : '';
      return rejectSubmission({
        script,
        name,
        email,
        title,
        notify,
        kind: 'translation',
        reason: `The screenplay reads as a clumsy English translation${lang}${(tr.evidence || []).length ? ` (e.g. ${tr.evidence.slice(0, 3).join('; ')})` : ''}.`,
        detail: { kind: 'translation', ...tr },
      });
    }

    // ── Full evaluation ───────────────────────────────────────────────────────
    const { rawText, evaluationJson, modelUsed } = await evaluateScreenplay(pdfText);

    // ── Opus verifier: a RECOMMEND must survive an adversarial second pass ──────
    if (evaluationJson && evaluationJson.decision === 'RECOMMEND') {
      try {
        const v = await verifyRecommendation(pdfText, evaluationJson);
        evaluationJson.verifier = { decision_in: 'RECOMMEND', ...v };
        if (v.veto) {
          evaluationJson.decision = v.recommended_decision || 'CONSIDER';
          logger.info(
            {
              scriptId: script.id,
              title,
              verifierModel: v.modelUsed,
              decision: evaluationJson.decision,
              reasons: v.reasons || [],
            },
            'RECOMMEND vetoed by verifier',
          );
        }
      } catch (err) {
        logger.error({ scriptId: script.id, err }, 'Verifier failed — leaving RECOMMEND'); // fail open
      }
    }

    await updateScriptEvaluation({ id: script.id, evaluationResult: rawText, evaluationJson });
    logger.info(
      { scriptId: script.id, title, model: modelUsed, decision: evaluationJson?.decision },
      'Script evaluated',
    );

    // notify=false on admin re-evaluations (rubric conversions, etc.) — the
    // submitter already received their result and shouldn't be re-emailed.
    if (notify) {
      sendEvaluationEmail({
        submitterName: name,
        submitterEmail: email,
        title,
        evaluationJson,
        rawText,
      }).catch((err) =>
        logger.error({ scriptId: script.id, title, err }, 'Evaluation email failed'),
      );
    }
  } catch (err) {
    const reason = err.message || 'Unknown evaluation error';
    logger.error({ scriptId: script.id, title, err }, 'Script evaluation failed');
    await markScriptError({ id: script.id, reason }).catch((e) =>
      logger.error(
        { scriptId: script.id, err: e },
        'markScriptError failed after evaluation failure',
      ),
    );
    if (notify) {
      sendFailureAlert({
        title,
        submitterName: name,
        submitterEmail: email,
        reason,
      }).catch((e) =>
        logger.error({ scriptId: script.id, title, err: e }, 'Failure-alert email failed'),
      );
    }
  }
}

/**
 * Reject a submission pre-evaluation: no score is produced, the row is marked
 * 'rejected' with the reason, and (when notify) the writer gets a revise-and-
 * resubmit email. A rejection is a content decision, not a server error.
 */
async function rejectSubmission({ script, name, email, title, notify, kind, reason, detail }) {
  const message =
    kind === 'translation'
      ? `This screenplay reads as a translation into English, so it isn't ready for evaluation yet. Please resubmit it in its original language — our reviewer reads and evaluates every language natively — or in fully idiomatic, professionally edited English.`
      : `This file isn't in standard screenplay format, so it can't be evaluated yet. ${reason} Re-export your screenplay from screenwriting software as a PDF and resubmit.`;
  await markScriptRejected({ id: script.id, reason, detail: { ...detail, message } }).catch((e) =>
    logger.error({ scriptId: script.id, err: e }, 'markScriptRejected failed'),
  );
  logger.info({ scriptId: script.id, title, kind, reason }, 'Script REJECTED pre-evaluation');
  if (notify) {
    sendRevisionRequest({
      submitterName: name,
      submitterEmail: email,
      title,
      kind,
      message,
      reason,
    }).catch((err) =>
      logger.error({ scriptId: script.id, title, err }, 'Revision-request email failed'),
    );
  }
}

/**
 * Accepts the submission, stores everything, and responds 202 immediately.
 * The Claude evaluation runs in the background — it can take minutes, which
 * is longer than proxies keep an idle HTTP request alive. The client polls
 * GET /scripts/:id until status becomes 'evaluated' or 'error'.
 */
export async function submitAndEvaluate(req, res, next) {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message).join('; ');
    return next(new AppError(messages, 400));
  }

  if (!req.file) {
    return next(new AppError('script PDF file is required', 400));
  }

  const { name, email, title } = parsed.data;
  const { buffer, originalname } = req.file;

  let user;
  try {
    user = await upsertUser({ name, email });
  } catch (err) {
    return next(new AppError(err.message, 500));
  }

  let pdfData;
  try {
    pdfData = await extractText(buffer);
  } catch (err) {
    return next(err);
  }

  let script;
  try {
    script = await saveScript({
      userId: user.id,
      title,
      filename: originalname,
      storagePath: null,
      pageCount: pdfData.pageCount,
      wordCount: pdfData.wordCount,
      charCount: pdfData.charCount,
      submitterName: name,
      submitterEmail: email,
    });
  } catch (err) {
    return next(new AppError(err.message, 500));
  }

  try {
    const storagePath = await uploadPDF({
      userId: user.id,
      scriptId: script.id,
      filename: originalname,
      buffer,
    });
    await updateScriptStoragePath({ id: script.id, storagePath });
  } catch (err) {
    (req.log || logger).warn(
      { scriptId: script.id, err },
      'PDF upload to storage failed (non-fatal)',
    );
  }

  res.status(202).json({
    id: script.id,
    status: 'processing',
    title,
    pageCount: pdfData.pageCount,
    wordCount: pdfData.wordCount,
    charCount: pdfData.charCount,
  });

  runEvaluation({
    script,
    pdfText: pdfData.text,
    name,
    email,
    title,
    pageCount: pdfData.pageCount,
  }).catch((err) =>
    logger.error({ scriptId: script.id, title, err }, 'background runEvaluation failed'),
  );
}
