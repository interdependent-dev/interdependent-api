import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { anthropic } from './models.js';

/**
 * Translate a built evaluation email into the writer's language. The platform and
 * database keep the English evaluation; only the writer's emailed copy is translated.
 * Returns { subject, html }; throws on failure so the caller can fall back to English.
 */
export async function translateEmail({ subject, html, language }) {
  const system = `You translate a screenplay-evaluation email for the writer into ${language}. Translate ALL human-readable English text into natural, professional ${language}. CRITICAL RULES:
- Preserve every HTML tag, attribute, inline CSS style, URL and email address EXACTLY. Translate only the visible text between tags.
- Keep all numbers, scores and percentages exactly as written.
- Do NOT translate proper nouns: the screenplay title, any film titles, person names, or the brand name "INTERDEPENDENT". Leave the decision label (RECOMMEND / CONSIDER / PASS) in English.
Output EXACTLY in this format and nothing else:
SUBJECT: <translated subject line>
---HTML---
<the full translated HTML document>`;
  const user = `Subject: ${subject}\n\nHTML:\n${html}`;
  // Haiku first (cheap, multilingual, plenty for translation), then the eval models.
  const models = [...new Set(['claude-haiku-4-5-20251001', env.anthropicModel.trim(), 'claude-opus-4-8'])];
  let lastErr;
  for (const model of models) {
    try {
      const resp = await anthropic.messages.create(
        { model, max_tokens: 16_000, system, messages: [{ role: 'user', content: user }] },
        { timeout: 120_000, maxRetries: 1 },
      );
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const i = text.indexOf('---HTML---');
      if (i === -1) { lastErr = new Error('translation format missing'); continue; }
      const subj = text.slice(0, i).replace(/^\s*SUBJECT:\s*/i, '').trim();
      const body = text.slice(i + '---HTML---'.length).trim();
      if (body.length > 50) return { subject: subj || subject, html: body };
      lastErr = new Error('translation too short');
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      lastErr = err;
    }
  }
  throw new AppError(`Email translation failed — ${lastErr?.message || 'unknown'}`, 502);
}
