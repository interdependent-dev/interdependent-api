-- Run this in the Supabase SQL editor before deploying.
-- Also create a Storage bucket named "scripts" (private) in the Supabase dashboard.

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scripts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  filename          TEXT NOT NULL,
  storage_path      TEXT,
  -- Submitter is stored per-script (not just via the users row): submissions
  -- can share one intake email like mailroom@, and keying identity on email
  -- alone would overwrite that user's name with whoever submitted last.
  submitter_name    TEXT,
  submitter_email   TEXT,
  page_count        INTEGER,
  word_count        INTEGER,
  char_count        INTEGER,
  -- pending | processing | evaluated | error
  status            TEXT NOT NULL DEFAULT 'pending',
  evaluation_result TEXT,
  evaluation_json   JSONB,
  submitted_at      TIMESTAMPTZ DEFAULT NOW(),
  evaluated_at      TIMESTAMPTZ
);

-- Index for looking up a user's scripts
CREATE INDEX IF NOT EXISTS scripts_user_id_idx ON scripts(user_id);
CREATE INDEX IF NOT EXISTS scripts_status_idx ON scripts(status);

-- ───────────────────────────────────────────────────────────────────────────
-- Passkey / Reader auth tables
-- Run the block below once to enable the reader leaderboard feature.
-- ───────────────────────────────────────────────────────────────────────────

-- Readers are curators (not screenplay submitters). Their identity lives
-- entirely in their passkey — no password, no email required.
CREATE TABLE IF NOT EXISTS readers (
  id           UUID PRIMARY KEY,           -- set by server at register/begin
  handle       TEXT UNIQUE NOT NULL,       -- e.g. 'chris-amell'  (URL-safe)
  display_name TEXT NOT NULL,              -- e.g. 'Chris Amell'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- One row per passkey device; a reader can register on multiple devices.
CREATE TABLE IF NOT EXISTS reader_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id      UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  credential_id  TEXT UNIQUE NOT NULL,    -- base64url, from WebAuthn
  public_key     TEXT NOT NULL,           -- base64url-encoded COSE public key
  counter        BIGINT NOT NULL DEFAULT 0,
  device_type    TEXT,                    -- 'singleDevice' | 'multiDevice'
  backed_up      BOOLEAN DEFAULT FALSE,
  transports     TEXT[],                  -- ['internal'], ['usb'], etc.
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ
);

-- Short-lived challenge store (5-min TTL). Holds registration metadata
-- (firstName, lastName, tentative readerId) before the reader row exists.
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge  TEXT NOT NULL,
  reader_id  UUID,                        -- NULL during registration
  metadata   JSONB,                       -- { tempReaderId, handle, displayName }
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

-- Each reader maintains a personal, ordered list of submitted scripts.
CREATE TABLE IF NOT EXISTS reader_leaderboard (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  added_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reader_id, script_id)
);

CREATE INDEX IF NOT EXISTS reader_credentials_reader_id_idx ON reader_credentials(reader_id);
CREATE INDEX IF NOT EXISTS reader_leaderboard_reader_position_idx ON reader_leaderboard(reader_id, position);
