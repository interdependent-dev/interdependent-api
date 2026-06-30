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
 * Append a reader-analytics event. Best-effort — callers must not let an
 * analytics failure affect the user.
 */
export async function insertReadEvent(e) {
  const { error } = await supabase.from('read_events').insert({
    event_type: e.eventType,
    script_id: e.scriptId ?? null,
    session_id: e.sessionId ?? null,
    reader_id: e.readerId ?? null,
    recommender: e.recommender ?? null,
    source: e.source ?? null,
    page: e.page ?? null,
    total_pages: e.totalPages ?? null,
    depth_pct: e.depthPct ?? null,
    seconds: e.seconds ?? null,
  });
  if (error) throw new Error(`DB insertReadEvent: ${error.message}`);
}

// Pull events (optionally since a date, or for one script) for dashboard
// aggregation, paged past Supabase's 1000-row default cap.
export async function listReadEvents({ sinceISO, scriptId } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let qy = supabase.from('read_events')
      .select('event_type, script_id, session_id, reader_id, recommender, source, page, total_pages, depth_pct, seconds, ts')
      .order('ts', { ascending: true }).range(from, from + 999);
    if (sinceISO) qy = qy.gte('ts', sinceISO);
    if (scriptId) qy = qy.eq('script_id', scriptId);
    const { data, error } = await qy;
    if (error) throw new Error(`DB listReadEvents: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Max depth + longest active-read time a specific reader logged on a specific
// script (read_progress only). Powers cross-device completion: a finished read
// recorded on one device unlocks the gate on another, because read_events carry
// the reader_id of whoever was signed in during the read.
export async function getReaderScriptRead(readerId, scriptId) {
  const { data, error } = await supabase.from('read_events')
    .select('depth_pct, seconds')
    .eq('reader_id', readerId)
    .eq('script_id', scriptId)
    .eq('event_type', 'read_progress');
  if (error) throw new Error(`DB getReaderScriptRead: ${error.message}`);
  let depth = 0, seconds = 0;
  for (const r of (data || [])) {
    if (r.depth_pct != null) depth = Math.max(depth, r.depth_pct);
    if (r.seconds != null) seconds = Math.max(seconds, r.seconds);
  }
  return { depth, seconds };
}

// A single script's page_count, for pace-aware completion (light — skips the row).
export async function getScriptPageCount(scriptId) {
  const { data, error } = await supabase.from('scripts')
    .select('page_count').eq('id', scriptId).maybeSingle();
  if (error) return null;
  return data?.page_count ?? null;
}

// All readers (passkey identities) — for resolving names in analytics.
export async function getReaders() {
  const { data, error } = await supabase.from('readers').select('id, handle, display_name, photo_path, created_at');
  if (error) throw new Error(`DB getReaders: ${error.message}`);
  return data || [];
}

// All champions (reader_leaderboard) — the authoritative "who championed what".
export async function getChampions() {
  const { data, error } = await supabase.from('reader_leaderboard').select('reader_id, script_id, added_at');
  if (error) throw new Error(`DB getChampions: ${error.message}`);
  return data || [];
}

// ── reader feedback ──────────────────────────────────────────────────────────
export async function insertFeedback(row) {
  const { data, error } = await supabase.from('reader_feedback').insert({
    script_id: row.scriptId, reader_id: row.readerId ?? null,
    champion_verdict: row.championVerdict ?? null, dimensions: row.dimensions ?? null,
    text: row.text ?? null, transcript: row.transcript ?? null,
  }).select('id').single();
  if (error) throw new Error(`DB insertFeedback: ${error.message}`);
  return data.id;
}

export async function setFeedbackAudio({ id, audioPath }) {
  const { error } = await supabase.from('reader_feedback').update({ audio_path: audioPath }).eq('id', id);
  if (error) throw new Error(`DB setFeedbackAudio: ${error.message}`);
}

// Voice notes live in the existing scripts bucket under a feedback/ prefix.
export async function uploadFeedbackAudio({ scriptId, feedbackId, buffer, ext }) {
  const path = `feedback/${scriptId}/${feedbackId}.${ext === 'mp4' ? 'mp4' : 'webm'}`;
  const { error } = await supabase.storage.from('scripts')
    .upload(path, buffer, { contentType: ext === 'mp4' ? 'audio/mp4' : 'audio/webm', upsert: true });
  if (error) throw new Error(`Storage uploadFeedbackAudio: ${error.message}`);
  return path;
}

export async function listFeedback(scriptId) {
  const { data, error } = await supabase.from('reader_feedback')
    .select('id, reader_id, created_at, champion_verdict, dimensions, text, audio_path, transcript, readers(display_name, handle)')
    .eq('script_id', scriptId).order('created_at', { ascending: false });
  if (error) throw new Error(`DB listFeedback: ${error.message}`);
  return data || [];
}

// Aggregate feedback counts per script (for the analytics dashboard).
export async function getFeedbackCounts() {
  const { data, error } = await supabase.from('reader_feedback').select('script_id, champion_verdict');
  if (error) throw new Error(`DB getFeedbackCounts: ${error.message}`);
  return data || [];
}

// (reader_id, script_id) feedback pairs — for the reader reputation engine.
export async function getFeedbackPairs() {
  const { data, error } = await supabase.from('reader_feedback').select('reader_id, script_id, champion_verdict');
  if (error) throw new Error(`DB getFeedbackPairs: ${error.message}`);
  return data || [];
}

// Full feedback rows needed to score THOROUGHNESS for XP — dimensions rated,
// notes length, and whether a voice note exists. Kept separate from the lighter
// pairs/counts accessors so the XP engine sees everything it scores on.
export async function getFeedbackForXp() {
  const { data, error } = await supabase.from('reader_feedback')
    .select('reader_id, script_id, champion_verdict, dimensions, text, transcript, audio_path, created_at');
  if (error) throw new Error(`DB getFeedbackForXp: ${error.message}`);
  return data || [];
}

// Claim a one-time notification slot — idempotency for XP emails. Returns true
// ONLY for the first caller of a (reader_id, kind, ref); the UNIQUE constraint
// makes duplicates fail, which we treat as "already sent". Any other failure
// (e.g. the table isn't migrated yet) returns false so we never spam or throw.
export async function claimNotification(readerId, kind, ref = '') {
  const { data, error } = await supabase
    .from('reader_notifications')
    .insert({ reader_id: readerId, kind, ref })
    .select('id');
  if (error) {
    if (!/duplicate|unique|23505/i.test(error.message)) {
      console.error('claimNotification error:', error.message);
    }
    return false;
  }
  return !!(data && data.length);
}

// All reader feedback with notes — for the READERS page (see what each reader said).
export async function getAllFeedback() {
  const { data, error } = await supabase.from('reader_feedback')
    .select('reader_id, script_id, champion_verdict, text, transcript, created_at');
  if (error) throw new Error(`DB getAllFeedback: ${error.message}`);
  return data || [];
}

// id → {title, page_count} for joining analytics (light; skips the big evaluation_json).
export async function getScriptTitles() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('scripts').select('id, title, page_count').range(from, from + 999);
    if (error) throw new Error(`DB getScriptTitles: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
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
  const { error } = await supabase
    .from('scripts')
    .update({ status: 'error', evaluation_result: reason })
    .eq('id', id);
  // Don't throw (callers run in a background path), but DO surface it — a silent
  // failure here strands the row in 'processing' and the submitter sees a spinner
  // forever.
  if (error) console.error(`markScriptError(${id}) failed: ${error.message}`);
}

/**
 * Mark a submission REJECTED — a content decision (malformed file / clumsy
 * translation), not a server error. No evaluation is produced; the writer is asked
 * to revise and resubmit. `detail` (kind, reasons, writer-facing message) is stored
 * under evaluation_json.rejected so the portal can show the reason. Terminal status.
 */
export async function markScriptRejected({ id, reason, detail }) {
  const { error } = await supabase
    .from('scripts')
    .update({
      status: 'rejected',
      evaluation_result: reason ?? null,
      evaluation_json: detail ? { rejected: detail } : null,
    })
    .eq('id', id);
  if (error) console.error(`markScriptRejected(${id}) failed: ${error.message}`);
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
