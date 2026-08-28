-- Idempotency log for reader XP emails. One row per (reader, kind, ref) the first
-- time we send it; the UNIQUE constraint makes a second attempt fail (so a
-- repeated action or a recomputed unlock never re-emails). Run once in Supabase.
CREATE TABLE IF NOT EXISTS reader_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id  UUID NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- 'first_feedback' | 'first_champion' | 'unlock'
  ref        TEXT NOT NULL DEFAULT '', -- perk key for unlocks, '' for first-of-kind
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (reader_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS reader_notifications_reader_idx ON reader_notifications(reader_id);
