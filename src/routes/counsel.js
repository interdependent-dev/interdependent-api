import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { AppError } from '../middleware/errorHandler.js';
import { askCounsel } from '../services/anthropicService.js';
import { sectionFor, OA_VERSION, OA_SOURCE_SHA256 } from '../lib/oaSections.js';

const router = Router();

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ██  POST /counsel — THE MATLOCK DESK  ██
 * ══════════════════════════════════════════════════════════════════════════
 *
 * R120(i). A member reading the Operating Agreement selects a passage, or presses
 * ASK on a subsection, and gets back a plain-language answer about THAT SECTION.
 *
 * ── WHY THIS LIVES HERE AND NOT IN THE STUDIO ─────────────────────────────
 *
 * R120(i), owner's law: *"Wire = the house's real machinery, never a new
 * credential path."* This estate already holds the Anthropic key and already
 * runs Claude for BARAKA. Putting a second key on a second host to answer the
 * same kind of question would be a second credential to rotate, a second thing
 * to leak, and a second truth about which model the studio talks to. The Studio
 * Worker calls this route with the SAME bearer it already exchanges for
 * `/evaluate`, and the browser never holds a credential at all.
 *
 * ── THE GROUNDING IS THE WIRING ───────────────────────────────────────────
 *
 * The body names a section; this route resolves it against `lib/oaSections.js`
 * (generated, provenance-stamped, sha-chained back to the v1.9.0 markdown) and
 * hands the model THAT SECTION AND NOTHING ELSE. An unknown id is a 400 before
 * any token is spent, so there is no path where the desk answers with no
 * agreement behind it. There is no conversation history: every ask is one
 * question against one section, which is also why a stateless rate limit is a
 * real ceiling rather than a speed bump.
 *
 * ── THE GATES, IN ORDER ───────────────────────────────────────────────────
 *
 *  1. RATE — 20 asks per 10 minutes per IP. First, so a flood is refused before
 *     it is parsed or authenticated. There is no free tier of a paid model.
 *  2. AUTH — `requireAuth`, exactly as `/evaluate`. A caller without the
 *     studio's passcode-derived JWT never reaches the corpus.
 *  3. SHAPE — zod. A question longer than 2,000 characters is not a question.
 *  4. THE SECTION — resolved before the model is called at all.
 *
 * ── WHAT COMES BACK ───────────────────────────────────────────────────────
 *
 * `{ ok, answer, section: {id, mark, title}, subsection, model, provenance }`.
 * PROVENANCE RIDES THE ANSWER — the agreement version and its sha — because an
 * answer about a legal document that cannot say which draft it read is an answer
 * nobody can check later.
 */

/* 20 asks per 10 minutes. The desk is a paid model behind a legal document; a
   member with real questions asks a handful, and anything past twenty in ten
   minutes is a script. Deliberately NOT `skipSuccessfulRequests` — successes are
   what cost money here, unlike a passcode check where failures are the risk. */
const counselLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'The counsel desk is answering as fast as it can — try again in a few minutes',
  },
});

const AskSchema = z.object({
  sectionId: z.string().trim().min(1).max(96),
  subsection: z.string().trim().max(24).optional().nullable(),
  selection: z.string().trim().max(4000).optional().nullable(),
  question: z.string().trim().min(3).max(2000),
});

router.post('/', counselLimiter, requireAuth, async (req, res, next) => {
  const parsed = AskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return next(
      new AppError(`Invalid request — ${first.path.join('.') || 'body'}: ${first.message}`, 400),
    );
  }
  const { sectionId, subsection, selection, question } = parsed.data;

  const section = sectionFor(sectionId);
  if (!section) {
    return next(
      new AppError(`No such section of the agreement: ${sectionId}`, 400, 'unknown_section'),
    );
  }

  /* A subsection the member's own gesture produced must belong to the section
     they are reading. It is a hint to the model, not a lookup key, so a stray
     one is dropped rather than refused — but it is never passed through blind. */
  const ref =
    subsection && section.refs.some((r) => r === subsection || subsection.startsWith(`${r}.`))
      ? subsection
      : null;

  try {
    const { answer, model } = await askCounsel({ section, subsection: ref, selection, question });
    res.json({
      ok: true,
      answer,
      section: { id: section.id, mark: section.mark, title: section.title },
      subsection: ref,
      model,
      provenance: { agreement: OA_VERSION, sha256: OA_SOURCE_SHA256 },
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 502));
  }
});

export default router;
