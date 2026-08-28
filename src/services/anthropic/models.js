import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';

export const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

// Known-good models to fall back to when the configured model fails. A wrong
// ANTHROPIC_MODEL value (or a model the key can't access) must degrade to a
// working evaluation, not take the whole service down.
const FALLBACK_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6'];

export function candidateModels() {
  const primary = env.anthropicModel.trim();
  return [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
}

// Errors tied to the credential or the org, not the model — switching models
// won't help, so surface them immediately with an actionable message.
export function classifyFatal(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AppError(
      'Evaluation service authentication failed — the Anthropic API key is invalid or revoked',
      502,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(
      'The evaluation service is temporarily rate-limited — please try again in a few minutes',
      503,
    );
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message ?? '')) {
    return new AppError(
      'The evaluation service is temporarily unavailable (API credits exhausted) — the team has been alerted. Your submission is saved; please try again once service is restored.',
      503,
    );
  }
  return null;
}

/**
 * One-token probe of a model, for the deep health check. Never throws.
 */
export async function pingModel(model) {
  try {
    await anthropic.messages.create(
      {
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
      { timeout: 20_000, maxRetries: 0 },
    );
    return { model, ok: true };
  } catch (err) {
    return {
      model,
      ok: false,
      status: err.status ?? null,
      error: err.message?.slice(0, 300) ?? String(err),
    };
  }
}
