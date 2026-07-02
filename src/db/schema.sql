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

-- Readers are curators (not screenplay submitters). Their identity lives in
-- their passkey — no password. A recovery email is captured at registration so
-- a reader who loses every device can prove ownership and add a new passkey
-- (see reader_recovery_tokens + the /readers/recover/* flow). Email is nullable
-- so the pre-recovery accounts keep working until one is backfilled.
CREATE TABLE IF NOT EXISTS readers (
  id           UUID PRIMARY KEY,           -- set by server at register/begin
  handle       TEXT UNIQUE NOT NULL,       -- e.g. 'chris-amell'  (URL-safe)
  display_name TEXT NOT NULL,              -- e.g. 'Chris Amell'
  email        TEXT,                       -- normalized lowercase; recovery channel
  photo_path   TEXT,                       -- object key in the public reader-avatars bucket
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Idempotent adds for environments created before these columns existed.
ALTER TABLE readers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS photo_path TEXT;
CREATE INDEX IF NOT EXISTS readers_email_idx ON readers(LOWER(email));
-- Profile avatars live in a PUBLIC Storage bucket 'reader-avatars' (create it in
-- the dashboard or via the storage API); readers.photo_path holds the object key.

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

-- Account-recovery tokens. When a reader loses every passkey, they request a
-- recovery link emailed to the address on file. Only the SHA-256 of the token
-- is stored — the raw token lives solely in the email link. One-time
-- (used_at set on completion) and short-lived (~30 min).
CREATE TABLE IF NOT EXISTS reader_recovery_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id  UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,               -- sha256(raw token), hex
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,                 -- set once consumed; one-time use
  request_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reader_recovery_token_hash_idx ON reader_recovery_tokens(token_hash);

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

-- NOTE: read_events and reader_feedback were created directly in Supabase and were
-- missing from this file, so a fresh environment built from schema.sql alone would
-- 500 on every /events and feedback call. Added here to match the running DB; if the
-- live column types differ, treat the live DB as authoritative.

-- Append-only reader-analytics ingest (POST /events). Backs reading time/depth
-- tracking and the cross-device completion gate (GET /reads/status).
CREATE TABLE IF NOT EXISTS read_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,                                  -- whitelisted in routes/events.js
  script_id   UUID REFERENCES scripts(id) ON DELETE CASCADE,
  session_id  TEXT,                                           -- anonymous client session
  reader_id   UUID REFERENCES readers(id) ON DELETE SET NULL, -- set when a reader is signed in
  recommender TEXT,
  source      TEXT,                                           -- 'portal' | 'recommend' | ...
  page        INTEGER,
  total_pages INTEGER,
  depth_pct   NUMERIC,                                        -- 0..100, furthest reached
  seconds     INTEGER,                                        -- active reading seconds
  ts          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS read_events_script_idx ON read_events(script_id);
CREATE INDEX IF NOT EXISTS read_events_reader_script_idx ON read_events(reader_id, script_id);
CREATE INDEX IF NOT EXISTS read_events_ts_idx ON read_events(ts);

-- Structured reader feedback: a PASS/CONSIDER/RECOMMEND decision, 1-5 dimension
-- ratings, free text, an optional voice-note transcript + stored audio path.
CREATE TABLE IF NOT EXISTS reader_feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id        UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  reader_id        UUID REFERENCES readers(id) ON DELETE SET NULL,
  champion_verdict TEXT,                                      -- 'recommend' | 'consider' | 'pass'
  dimensions       JSONB,                                     -- { story_architecture: 1..5, ... }
  text             TEXT,
  transcript       TEXT,
  audio_path       TEXT,                                      -- storage key for the voice note
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reader_feedback_script_idx ON reader_feedback(script_id);

-- Assigned reads: staff (ADMIN_HANDLES) assign a specific script to a specific
-- reader. "Decided" = the reader submitted feedback on it (decided_at stamped by
-- the feedback path; self-healed on read). The "decide before reading on" gate
-- is CLIENT-side; the API only reports state. (migrations/2026-07-02_assignments.sql)
CREATE TABLE IF NOT EXISTS reader_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  UNIQUE (reader_id, script_id)
);
CREATE INDEX IF NOT EXISTS reader_assignments_reader_pending_idx
    ON reader_assignments(reader_id) WHERE decided_at IS NULL;
CREATE INDEX IF NOT EXISTS reader_assignments_script_idx
    ON reader_assignments(script_id);

-- Idempotency log for reader XP emails (first-of-kind thank-yous + perk unlocks).
-- The UNIQUE constraint guarantees each note is sent at most once per reader.
CREATE TABLE IF NOT EXISTS reader_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id  UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL DEFAULT '',
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reader_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS reader_notifications_reader_idx ON reader_notifications(reader_id);
