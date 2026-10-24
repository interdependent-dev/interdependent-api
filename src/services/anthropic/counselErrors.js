import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../../middleware/errorHandler.js';

// Counsel does not save an evaluation submission or notify a team. Preserve
// fatal-provider short-circuiting without inheriting those evaluation claims
// or retaining provider details that may contain private request text.
export function classifyCounselFatal(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AppError(
      'The counsel desk could not authenticate with its answer provider',
      502,
      'counsel_provider_auth_failed',
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(
      'The counsel desk is temporarily rate-limited — please try again in a few minutes',
      503,
      'counsel_provider_rate_limited',
    );
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message ?? '')) {
    return new AppError(
      'The counsel desk is temporarily unavailable because its answer provider has insufficient credits',
      503,
      'counsel_provider_credits_exhausted',
    );
  }
  return null;
}
