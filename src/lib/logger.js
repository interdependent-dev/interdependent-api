// ─────────────────────────────────────────────────────────────────────────────
// Structured logger — one pino instance for the whole service.
//
// Render captures stdout, so this is plain newline-delimited JSON to stdout:
// no transports, no files, no pretty-printing. Levels via LOG_LEVEL (default
// 'info'; 'silent' turns logging off entirely, e.g. in tests).
//
// Deliberately has NO dependency on config/env.js — env validation itself
// needs a logger before the env is known to be valid.
// ─────────────────────────────────────────────────────────────────────────────

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Render prefixes its own wall-clock timestamp; pino's epoch-ms `time` field
  // stays for machine consumers.
  base: undefined, // drop pid/hostname — one process per Render instance
});
