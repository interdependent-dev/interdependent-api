import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../lib/logger.js';
import { anthropic, candidateModels, classifyFatal } from './models.js';
import { extractJson } from './extraction.js';
import { verifyReadToEnd } from './verification.js';
import {
  SYSTEM_PROMPT,
  TRANSLATION_PROMPT,
  LOGLINE_PROMPT,
  RECALIBRATE_PROMPT,
} from './prompts.js';

// BARAKA's decision is a deterministic function of Craft Score + Championability.
// The model is unreliable at walking that branching matrix (it has mislabeled
// e.g. craft 57.5 + MEDIUM as CONSIDER when the rubric says PASS), so we compute
// the decision in code from the rubric and never trust the model's `decision`.
//   > 80 craft : HIGH/MEDIUM → RECOMMEND ; LOW → CONSIDER
//   70–80      : HIGH → RECOMMEND ; MEDIUM → CONSIDER ; LOW → PASS
//   ≤ 70       : HIGH → CONSIDER ; MEDIUM/LOW → PASS
export function barakaDecision(craftScore, championability) {
  const c = Number(craftScore);
  const h = String(championability ?? '')
    .trim()
    .toUpperCase();
  if (isNaN(c) || !['HIGH', 'MEDIUM', 'LOW'].includes(h)) return null;
  if (c > 80) return h === 'HIGH' || h === 'MEDIUM' ? 'RECOMMEND' : 'CONSIDER';
  if (c > 70) return h === 'HIGH' ? 'RECOMMEND' : h === 'MEDIUM' ? 'CONSIDER' : 'PASS';
  return h === 'HIGH' ? 'CONSIDER' : 'PASS';
}

// Overwrite a BARAKA evaluation's decision with the rubric-computed one. No-op
// for non-BARAKA shapes (older "Casey" output) or when scores are unparseable.
function applyDeterministicDecision(ev) {
  const cs = ev?.evaluation?.craft_score;
  const cr = ev?.evaluation?.championability_rating;
  if (!cs || !cr) return;
  const decision = barakaDecision(cs.final_craft_score, cr.final_championability_rating);
  if (decision) ev.decision = decision;
}

/**
 * Send screenplay text to Claude and return { rawText, evaluationJson, modelUsed }.
 * Tries the configured model first, then falls back through known-good models on
 * model-specific or transient server failures. Streams the response so long
 * evaluations don't hit idle HTTP timeouts; the SDK retries 429/5xx internally.
 * Throws AppError when every candidate fails.
 */
export async function evaluateScreenplay(scriptText) {
  // Send the WHOLE screenplay. The model's context (~200k tokens ≈ ~800k chars)
  // easily holds a feature script (~120-200k chars); this cap only guards against
  // a pathological non-feature upload, far above any real screenplay. Reading the
  // full script — the third act and ending especially — is essential: structure/
  // climax/ending scores and the summary are worthless on a partial read.
  const MAX_CHARS = 600_000;
  const scriptForModel =
    scriptText.length > MAX_CHARS
      ? scriptText.slice(0, MAX_CHARS) + '\n\n[...exceeded maximum length...]'
      : scriptText;

  const failures = [];
  let fallbackResult = null; // best parsed-but-unverified result, used only if nothing verifies

  for (const model of candidateModels()) {
    let response;
    try {
      const stream = anthropic.messages.stream(
        {
          model,
          max_tokens: 16384,
          // Cache the system prompt — identical every call, ~3k tokens.
          // Cache reads cost 10x less than full input tokens.
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: `Please evaluate the following screenplay:\n\n${scriptForModel}`,
            },
          ],
        },
        { timeout: 240_000, maxRetries: 2 },
      );
      response = await stream.finalMessage();
    } catch (err) {
      const fatal = classifyFatal(err);
      if (fatal) throw fatal;

      // Model-specific (404/403/model 400) or transient server trouble
      // (5xx/529/connection/timeout) — log it and try the next candidate.
      const detail = `${err.status ?? err.name ?? 'error'}: ${err.message}`;
      logger.error({ model, err }, 'Evaluation model call failed — trying next candidate');
      failures.push(`${model} → ${detail}`);
      continue;
    }

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (!rawText) {
      failures.push(`${model} → empty response (stop_reason: ${response.stop_reason})`);
      continue;
    }

    if (model !== env.anthropicModel.trim()) {
      logger.warn(
        { model, pinned: env.anthropicModel },
        'Evaluation completed on fallback model — check ANTHROPIC_MODEL',
      );
    }

    const evaluationJson = extractJson(rawText);
    if (!evaluationJson) {
      logger.warn(
        { model, stopReason: response.stop_reason },
        'Model returned unparseable JSON — storing raw text only',
      );
      fallbackResult = fallbackResult || { rawText, evaluationJson: null, modelUsed: model };
      failures.push(`${model} → unparseable JSON`);
      continue;
    }

    applyDeterministicDecision(evaluationJson); // rubric decides, not the model
    const verified = verifyReadToEnd(evaluationJson, scriptForModel);
    evaluationJson.read_verified = verified;
    if (verified) {
      return { rawText, evaluationJson, modelUsed: model };
    }
    // Parsed, but the verbatim ending quote isn't in the back of the script — the
    // model may have stopped early or fabricated the ending. Prefer a verified
    // candidate; keep this flagged as a fallback and try the next model.
    logger.warn({ model }, 'Model failed the read-check (ending quote not found in script)');
    failures.push(`${model} → read-check failed`);
    fallbackResult = { rawText, evaluationJson, modelUsed: model }; // a parsed result beats a null one
  }

  if (fallbackResult) {
    logger.warn(
      'Returning an evaluation flagged read_verified=false — no candidate confirmed reading to the end',
    );
    return fallbackResult;
  }
  throw new AppError(`Evaluation failed on all models — ${failures.join('; ')}`, 502);
}

/**
 * Decide whether an English screenplay is a clumsy translation. Returns the parsed
 * screen object. FAILS OPEN — if every model errors it returns translated=false so a
 * screen outage can never wrongly block a real writer (the Opus verifier is a backstop).
 */
export async function detectTranslation(scriptText) {
  const sample = scriptText.length > 60_000 ? scriptText.slice(0, 60_000) : scriptText;
  for (const model of candidateModels()) {
    try {
      const resp = await anthropic.messages.create(
        {
          model,
          max_tokens: 700,
          system: [
            { type: 'text', text: TRANSLATION_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: `SCREENPLAY EXCERPT:\n\n${sample}` }],
        },
        { timeout: 90_000, maxRetries: 1 },
      );
      const text = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const json = extractJson(text);
      if (json && typeof json.translated === 'boolean') return json;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      logger.error({ model, err }, 'detectTranslation model call failed');
    }
  }
  return {
    translated: false,
    confidence: 0,
    original_language: null,
    severity: 'none',
    evidence: [],
    screen_error: true,
  };
}

/**
 * Generate a single streaming-style logline from a full read of the script,
 * verified against the ending. Used to backfill loglines onto already-scored
 * submissions WITHOUT re-scoring them. Returns { logline, readVerified, modelUsed }.
 */
export async function generateLogline(scriptText) {
  const MAX_CHARS = 600_000;
  const scriptForModel =
    scriptText.length > MAX_CHARS
      ? scriptText.slice(0, MAX_CHARS) + '\n\n[...exceeded maximum length...]'
      : scriptText;

  const failures = [];
  let fallback = null; // best parsed-but-unverified result

  for (const model of candidateModels()) {
    let response;
    try {
      const stream = anthropic.messages.stream(
        {
          model,
          max_tokens: 1024,
          system: [{ type: 'text', text: LOGLINE_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [
            { role: 'user', content: `Here is the full screenplay:\n\n${scriptForModel}` },
          ],
        },
        { timeout: 180_000, maxRetries: 2 },
      );
      response = await stream.finalMessage();
    } catch (err) {
      const fatal = classifyFatal(err);
      if (fatal) throw fatal;
      failures.push(`${model} → ${err.status ?? err.name ?? 'error'}: ${err.message}`);
      continue;
    }

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const json = extractJson(rawText);
    if (!json || !json.logline) {
      failures.push(`${model} → no logline`);
      continue;
    }

    const readVerified = verifyReadToEnd(json, scriptForModel);
    const result = { logline: String(json.logline).trim(), readVerified, modelUsed: model };
    if (readVerified) return result;
    failures.push(`${model} → read-check failed`);
    fallback = result; // keep, flagged, in case nothing verifies
  }

  if (fallback) {
    logger.warn('Returning a logline flagged read_verified=false — could not confirm a full read');
    return fallback;
  }
  throw new AppError(`Logline generation failed — ${failures.join('; ')}`, 502);
}

/**
 * Re-calibrate a screenplay's evaluation against real reader feedback — especially
 * the Championability dimensions, where human readers are the ground truth.
 * Returns the calibration object; the caller persists it on evaluation_json.
 */
export async function recalibrateWithFeedback({ title, evaluation, feedback }) {
  const fbText = (feedback || [])
    .map((f, i) => {
      const dims =
        f.dimensions && typeof f.dimensions === 'object'
          ? Object.entries(f.dimensions)
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k}: ${v}/5`)
              .join(', ')
          : '';
      return `Reader ${i + 1} — verdict: ${f.verdict || 'n/a'}${dims ? `; ratings: ${dims}` : ''}${f.note ? `; note: "${String(f.note).slice(0, 1500)}"` : ''}`;
    })
    .join('\n');
  const user = `SCREENPLAY: ${title}\n\nAI EVALUATION (JSON):\n${JSON.stringify(evaluation).slice(0, 12000)}\n\nHUMAN READER FEEDBACK (${(feedback || []).length} reader${feedback && feedback.length === 1 ? '' : 's'}):\n${fbText}`;
  const models = [
    ...new Set([env.anthropicModel.trim(), 'claude-opus-4-8', 'claude-haiku-4-5-20251001']),
  ];
  let lastErr;
  for (const model of models) {
    try {
      const resp = await anthropic.messages.create(
        {
          model,
          max_tokens: 2000,
          system: [
            { type: 'text', text: RECALIBRATE_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: user }],
        },
        { timeout: 120_000, maxRetries: 1 },
      );
      const text = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const json = extractJson(text);
      if (json && json.championability) return json;
      lastErr = new Error('no calibration json');
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      lastErr = err;
    }
  }
  throw new AppError(`Re-calibration failed — ${lastErr?.message || 'unknown'}`, 502);
}
