import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { insertReadEvent } from '../services/supabaseService.js';
import { optionalReader } from '../middleware/optionalReader.js';
import { sanitizeReadEvent } from '../lib/eventIngest.js';
import { logger } from '../lib/logger.js';

const router = Router();

// PUBLIC, no auth — reader-analytics ingest from the portal + recommend pages.
// Generous limit (a reading session emits progress pings), best-effort, and it
// NEVER returns an error to the client: analytics must not affect the reader.
//
// TRUST MODEL: reader attribution is derived ONLY from the verified
// X-Reader-Session JWT (optionalReader → req.reader.id). A body `reader_id` is
// ignored entirely — reader ids are public, so trusting the body would let
// anyone forge verified reads for any reader. Anonymous events (no/invalid
// session) are still accepted with no reader attribution; the endpoint stays
// always-204. Sanitization itself is pure — see lib/eventIngest.js.
const limiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });

router.post('/', limiter, optionalReader, async (req, res) => {
  try {
    const event = sanitizeReadEvent(req.body, req.reader ? req.reader.id : null);
    if (event) await insertReadEvent(event);
  } catch (err) {
    (req.log || logger).error({ err }, 'read_event ingest failed');
  }
  res.status(204).end();
});

export default router;
