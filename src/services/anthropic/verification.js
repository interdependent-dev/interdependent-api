import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { anthropic } from './models.js';
import { extractJson } from './extraction.js';
import { VERIFIER_PROMPT } from './prompts.js';

// Unicode-aware: fold accents/diacritics, keep letters & numbers of ANY script
// (Latin, Cyrillic, CJK, Arabic, etc.), drop everything else. Critical for
// verifying non-English screenplays — the old [a-z0-9] form deleted them entirely.
const normForMatch = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Confirm the model actually read to the end before we trust its scores or summary.
// Its verbatim ending quote must appear in the back of the script; an early stop or
// a fabricated ending won't. Lenient so PDF-extraction quirks don't false-negative,
// and language-agnostic: a word-run match for spaced languages, plus a character-run
// match for scripts without word spacing (e.g. Chinese/Japanese).
export function verifyReadToEnd(ev, scriptText) {
  const quote = ev?.read_check?.ending_quote;
  if (!quote || !scriptText) return false;
  const full = normForMatch(scriptText);
  const back = full.slice(Math.floor(full.length * 0.55)); // last ~45% of the script
  const nq = normForMatch(quote);

  // Word-shingle match — spaced languages (English, Spanish, French, Russian…)
  const qWords = nq.split(' ').filter(Boolean);
  if (qWords.length >= 4) {
    const N = Math.min(5, qWords.length);
    for (let i = 0; i + N <= qWords.length; i++) {
      if (back.includes(qWords.slice(i, i + N).join(' '))) return true;
    }
  }
  // Character-run match — scripts without word spacing (CJK, etc.)
  const cq = nq.replace(/ /g, '');
  const cb = back.replace(/ /g, '');
  if (cq.length >= 8) {
    const W = Math.min(12, cq.length);
    for (let i = 0; i + W <= cq.length; i += Math.max(1, Math.floor(W / 2))) {
      if (cb.includes(cq.slice(i, i + W))) return true;
    }
  }
  return false;
}

/**
 * Adversarially re-check a RECOMMEND with the strongest model. Returns { veto,
 * recommended_decision, severity, reasons, modelUsed }. FAILS OPEN — a verifier
 * outage must never silently downgrade a genuinely good script.
 */
export async function verifyRecommendation(scriptText, evaluationJson) {
  const sample = scriptText.length > 120_000 ? scriptText.slice(0, 120_000) : scriptText;
  const cs = evaluationJson?.evaluation?.craft_score || {};
  const cr = evaluationJson?.evaluation?.championability_rating || {};
  const evalSummary = JSON.stringify({
    craft_score: cs.final_craft_score,
    championability: cr.final_championability_rating,
    craft_justification: cs.craft_justification,
    dialogue: cs.dialogue_effectiveness,
    screenplay_execution: cs.screenplay_execution,
  }).slice(0, 4000);
  const models = [...new Set(['claude-opus-4-8', env.anthropicModel.trim()])];
  for (const model of models) {
    try {
      const resp = await anthropic.messages.create(
        {
          model,
          max_tokens: 900,
          system: [{ type: 'text', text: VERIFIER_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [
            {
              role: 'user',
              content: `PRIMARY EVALUATION (the RECOMMEND to check):\n${evalSummary}\n\nSCREENPLAY:\n\n${sample}`,
            },
          ],
        },
        { timeout: 180_000, maxRetries: 1 },
      );
      const text = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const json = extractJson(text);
      if (json && typeof json.veto === 'boolean') return { ...json, modelUsed: model };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      logger.error({ model, err }, 'verifyRecommendation model call failed');
    }
  }
  return {
    veto: false,
    recommended_decision: 'RECOMMEND',
    severity: 'none',
    reasons: [],
    verifier_error: true,
  };
}
