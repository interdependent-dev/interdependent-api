-- ============================================================================
-- Reader profile photos  (2026-06-28)
-- Additive + idempotent. The public Storage bucket 'reader-avatars' is created
-- separately via the storage API (see _create_avatar_bucket.mjs) — buckets
-- aren't created through SQL.
-- ============================================================================

ALTER TABLE readers ADD COLUMN IF NOT EXISTS photo_path TEXT;
