-- Assigned reads (reader-first portal): staff (ADMIN_HANDLES) assign a specific
-- script to a specific reader. "Decided" = the reader submitted feedback on it —
-- decided_at is stamped by the feedback path (POST /feedback/:scriptId) and
-- self-healed on read if a reader_feedback row already exists.
-- The "can't read anything else until you decide" gate is enforced CLIENT-side
-- in this iteration (soft gate, same model as the finished-read gate); the API
-- only reports state.
-- Run once in the Supabase SQL editor (service-role REST cannot run DDL).

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

-- The hot path is a reader's own pending inbox (decided_at IS NULL).
CREATE INDEX IF NOT EXISTS reader_assignments_reader_pending_idx
    ON reader_assignments(reader_id) WHERE decided_at IS NULL;
-- Staff views join/filter by script; cascade deletes also walk this.
CREATE INDEX IF NOT EXISTS reader_assignments_script_idx
    ON reader_assignments(script_id);
