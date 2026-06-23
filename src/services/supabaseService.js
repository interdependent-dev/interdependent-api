import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

/**
 * Find a user by email or create one. Returns the user row.
 */
export async function upsertUser({ name, email }) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ name, email }, { onConflict: 'email', ignoreDuplicates: false })
    .select('id, name, email, created_at')
    .single();

  if (error) throw new Error(`DB upsertUser: ${error.message}`);
  return data;
}

/**
 * Insert a new script row. Returns the created row.
 */
export async function saveScript({ userId, title, filename, storagePath, pageCount, wordCount, charCount, submitterName, submitterEmail }) {
  const base = {
    user_id: userId,
    title,
    filename,
    storage_path: storagePath,
    page_count: pageCount,
    word_count: wordCount,
    char_count: charCount,
    status: 'processing',
  };

  // Submitter name/email are stored on the SCRIPT, not just derived from the
  // users row. Multiple submissions can share one intake email (mailroom@…);
  // keying identity on email alone would collapse them onto a single user and
  // overwrite that user's name with whoever submitted last — so every script
  // under that email displayed the most recent submitter. Storing it per-row
  // keeps each submission's true submitter.
  let { data, error } = await supabase
    .from('scripts')
    .insert({ ...base, submitter_name: submitterName ?? null, submitter_email: submitterEmail ?? null })
    .select()
    .single();

  // Tolerate the columns not being migrated yet — never fail a submission over
  // it. Once the ALTER TABLE has run, the first insert path takes over.
  if (error && /submitter_name|submitter_email|does not exist|schema cache/i.test(error.message)) {
    ({ data, error } = await supabase.from('scripts').insert(base).select().single());
  }

  if (error) throw new Error(`DB saveScript: ${error.message}`);
  return data;
}

/**
 * Set evaluation result + structured JSON and mark the script as evaluated.
 */
export async function updateScriptEvaluation({ id, evaluationResult, evaluationJson }) {
  const { error } = await supabase
    .from('scripts')
    .update({
      evaluation_result: evaluationResult,
      evaluation_json: evaluationJson ?? null,
      status: 'evaluated',
      evaluated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw new Error(`DB updateScriptEvaluation: ${error.message}`);
}

/**
 * Merge a few keys into an existing evaluation_json without disturbing the rest
 * (scores, decision, etc.). Used to backfill loglines onto already-scored rows.
 */
export async function mergeScriptEvaluationJson({ id, patch }) {
  const { data, error: selErr } = await supabase
    .from('scripts').select('evaluation_json').eq('id', id).single();
  if (selErr) throw new Error(`DB mergeScriptEvaluationJson select: ${selErr.message}`);
  const merged = { ...(data?.evaluation_json || {}), ...patch };
  const { error } = await supabase
    .from('scripts').update({ evaluation_json: merged }).eq('id', id);
  if (error) throw new Error(`DB mergeScriptEvaluationJson update: ${error.message}`);
}

/**
 * Persist the Supabase Storage path back to the script row after upload.
 */
export async function updateScriptStoragePath({ id, storagePath }) {
  const { error } = await supabase
    .from('scripts')
    .update({ storage_path: storagePath })
    .eq('id', id);

  if (error) throw new Error(`DB updateScriptStoragePath: ${error.message}`);
}

/**
 * Mark a script as errored with a reason string.
 */
export async function markScriptError({ id, reason }) {
  await supabase
    .from('scripts')
    .update({ status: 'error', evaluation_result: reason })
    .eq('id', id);
}

/**
 * Upload a PDF buffer to Supabase Storage.
 * Returns the storage path (key) for the file.
 */
export async function uploadPDF({ userId, scriptId, filename, buffer }) {
  const storagePath = `${userId}/${scriptId}/${filename}`;

  const { error } = await supabase.storage
    .from('scripts')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });

  if (error) throw new Error(`Storage uploadPDF: ${error.message}`);
  return storagePath;
}

/**
 * Download a stored PDF as a Buffer (for retrying failed evaluations).
 */
export async function downloadPDF(storagePath) {
  const { data, error } = await supabase.storage.from('scripts').download(storagePath);
  if (error) throw new Error(`Storage downloadPDF: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Mint a short-lived signed URL for a stored PDF so an authenticated browser
 * can read it directly from Supabase (the bucket is private; the service-role
 * key never leaves the server). When downloadName is given, the URL carries a
 * content-disposition so the browser saves it with a clean filename.
 */
export async function createSignedPdfUrl(storagePath, expiresIn = 600, downloadName) {
  const { data, error } = await supabase.storage
    .from('scripts')
    .createSignedUrl(storagePath, expiresIn, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error(`Storage createSignedPdfUrl: ${error.message}`);
  return data.signedUrl;
}

/**
 * Put a script back into 'processing' before a retry, clearing the old error.
 */
export async function markScriptProcessing({ id }) {
  const { error } = await supabase
    .from('scripts')
    .update({ status: 'processing', evaluation_result: null, evaluation_json: null })
    .eq('id', id);
  if (error) throw new Error(`DB markScriptProcessing: ${error.message}`);
}

/**
 * List all scripts with their submitting user's name and email.
 */
export async function listScripts({ limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('scripts')
    .select('*, users(name, email)')
    .order('submitted_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`DB listScripts: ${error.message}`);
  return data;
}

/**
 * Fetch a single script by ID, including submitter info.
 */
export async function getScriptById(id) {
  const { data, error } = await supabase
    .from('scripts')
    .select('*, users(name, email)')
    .eq('id', id)
    .single();

  if (error) throw new Error(`DB getScriptById: ${error.message}`);
  return data;
}
