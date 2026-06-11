import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { extractText } from '../services/pdfService.js';
import { evaluateScreenplay } from '../services/anthropicService.js';
import { sendEvaluationEmail, sendFailureAlert } from '../services/emailService.js';
import {
  upsertUser,
  saveScript,
  uploadPDF,
  updateScriptStoragePath,
  updateScriptEvaluation,
  markScriptError,
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
 */
async function runEvaluation({ script, pdfText, name, email, title }) {
  try {
    const { rawText, evaluationJson, modelUsed } = await evaluateScreenplay(pdfText);

    await updateScriptEvaluation({ id: script.id, evaluationResult: rawText, evaluationJson });
    console.log(`Script ${script.id} ("${title}") evaluated by ${modelUsed}`);

    sendEvaluationEmail({
      submitterName: name,
      submitterEmail: email,
      title,
      evaluationJson,
      rawText,
    }).catch((err) => console.error('Evaluation email failed:', err.message));
  } catch (err) {
    const reason = err.message || 'Unknown evaluation error';
    console.error(`Script ${script.id} ("${title}") evaluation failed: ${reason}`);
    await markScriptError({ id: script.id, reason }).catch(() => {});
    sendFailureAlert({
      title,
      submitterName: name,
      submitterEmail: email,
      reason,
    }).catch(() => {});
  }
}

/**
 * Accepts the submission, stores everything, and responds 202 immediately.
 * The Claude evaluation runs in the background — it can take minutes, which
 * is longer than proxies keep an idle HTTP request alive. The client polls
 * GET /scripts/:id until status becomes 'evaluated' or 'error'.
 */
export async function submitAndEvaluate(req, res, next) {
  // Validate text fields
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

  // 1. Upsert user
  let user;
  try {
    user = await upsertUser({ name, email });
  } catch (err) {
    return next(new AppError(err.message, 500));
  }

  // 2. Parse PDF
  let pdfData;
  try {
    pdfData = await extractText(buffer);
  } catch (err) {
    return next(err); // AppError from pdfService
  }

  // 3. Create the script record (status: processing)
  let script;
  try {
    script = await saveScript({
      userId: user.id,
      title,
      filename: originalname,
      storagePath: null, // will update after upload
      pageCount: pdfData.pageCount,
      wordCount: pdfData.wordCount,
      charCount: pdfData.charCount,
    });
  } catch (err) {
    return next(new AppError(err.message, 500));
  }

  // 4. Upload PDF to Supabase Storage (non-fatal)
  try {
    const storagePath = await uploadPDF({
      userId: user.id,
      scriptId: script.id,
      filename: originalname,
      buffer,
    });
    await updateScriptStoragePath({ id: script.id, storagePath });
  } catch (err) {
    console.warn('PDF upload to storage failed (non-fatal):', err.message);
  }

  // 5. Respond now; evaluate in the background
  res.status(202).json({
    id: script.id,
    status: 'processing',
    title,
    pageCount: pdfData.pageCount,
    wordCount: pdfData.wordCount,
    charCount: pdfData.charCount,
  });

  runEvaluation({ script, pdfText: pdfData.text, name, email, title });
}
