-- Stage 2 (read-first): surfacing. Curators decide which scripts Readers see.
-- The Reader slate = surfaced scripts; Curators/admins see everything + can toggle.
-- Run once in the Supabase SQL editor (service-role REST cannot run DDL).

-- 1. The flag (+ a light "when surfaced" for ordering the Reader slate / audit).
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS surfaced_to_readers BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS surfaced_at TIMESTAMPTZ;

-- 2. Grandfather everything currently in the slate → surfaced, so nothing disappears
--    for Readers today. New submissions default to false (a Curator opts them in).
UPDATE scripts
   SET surfaced_to_readers = true,
       surfaced_at = COALESCE(surfaced_at, submitted_at)
 WHERE surfaced_to_readers = false;

-- 3. Index for the Reader slate filter + newest-surfaced-first ordering.
CREATE INDEX IF NOT EXISTS scripts_surfaced_idx
    ON scripts (surfaced_to_readers, surfaced_at DESC);
