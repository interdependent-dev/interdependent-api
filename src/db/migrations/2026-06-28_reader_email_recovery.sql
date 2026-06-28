-- ============================================================================
-- Reader email + account recovery  (2026-06-28)
-- Paste this whole block into the Supabase SQL editor and run it once.
-- It is additive and idempotent — safe to run on the live DB before deploying
-- the matching API code (nothing reads these until the new code ships).
-- ============================================================================

-- 1. Recovery email on the reader (nullable; new registrations set it).
ALTER TABLE readers ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS readers_email_idx ON readers (LOWER(email));

-- 2. One-time, hashed, short-lived recovery tokens.
CREATE TABLE IF NOT EXISTS reader_recovery_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id  UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,               -- sha256(raw token), hex
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,                 -- set once consumed; one-time use
  request_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reader_recovery_token_hash_idx ON reader_recovery_tokens (token_hash);
