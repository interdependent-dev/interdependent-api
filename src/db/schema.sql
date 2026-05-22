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
