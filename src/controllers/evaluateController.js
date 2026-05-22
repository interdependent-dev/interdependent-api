import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { extractText } from '../services/pdfService.js';
import { evaluateScreenplay } from '../services/anthropicService.js';
import { sendEvaluationEmail } from '../services/emailService.js';
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

  // 3. Create the script record (status: processing) — need an ID before uploading
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

  // 4. Upload PDF to Supabase Storage, then persist the path to the DB row
  try {
    const storagePath = await uploadPDF({
      userId: user.id,
      scriptId: script.id,
      filename: originalname,
      buffer,
    });
    await updateScriptStoragePath({ id: script.id, storagePath });
    script.storage_path = storagePath;
  } catch (err) {
    console.warn('PDF upload to storage failed (non-fatal):', err.message);
  }

  // 5. Call Claude
  let rawText, evaluationJson;
  try {
    ({ rawText, evaluationJson } = await evaluateScreenplay(pdfData.text));
  } catch (err) {
    await markScriptError({ id: script.id, reason: err.message }).catch(() => {});
    return next(err);
  }

  // 6. Persist evaluation (raw text + parsed JSON)
  try {
    await updateScriptEvaluation({ id: script.id, evaluationResult: rawText, evaluationJson });
  } catch (err) {
    console.error('Failed to persist evaluation result:', err.message);
  }

  // 7. Send evaluation email (non-blocking — don't fail the request if email fails)
  sendEvaluationEmail({
    submitterName: name,
    submitterEmail: email,
    title,
    evaluationJson,
    rawText,
  }).catch(() => {});

  return res.status(200).json({
    id: script.id,
    title,
    evaluation: evaluationJson ?? rawText,
    wordCount: pdfData.wordCount,
    pageCount: pdfData.pageCount,
    charCount: pdfData.charCount,
  });
}
