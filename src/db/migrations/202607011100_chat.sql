-- Stage 4 (read-first): per-script chat for CHAMPIONS (the warm audience) + peer
-- endorsements that earn "good reader" XP. Run once in the Supabase SQL editor.

-- Champions-only discussion, one thread per script. parent_id = a reply.
CREATE TABLE IF NOT EXISTS script_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id   UUID NOT NULL REFERENCES scripts(id)  ON DELETE CASCADE,
  reader_id   UUID NOT NULL REFERENCES readers(id)  ON DELETE CASCADE,
  parent_id   UUID          REFERENCES script_messages(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS script_messages_script_idx ON script_messages(script_id, created_at);
CREATE INDEX IF NOT EXISTS script_messages_reader_idx ON script_messages(reader_id);
CREATE INDEX IF NOT EXISTS script_messages_parent_idx ON script_messages(parent_id);

-- Peer endorsement of a message (one per endorser per message). The signal behind
-- the chatEndorsed reputation XP.
CREATE TABLE IF NOT EXISTS message_endorsements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES script_messages(id) ON DELETE CASCADE,
  endorser_id  UUID NOT NULL REFERENCES readers(id)         ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, endorser_id)
);
CREATE INDEX IF NOT EXISTS message_endorsements_message_idx  ON message_endorsements(message_id);
CREATE INDEX IF NOT EXISTS message_endorsements_endorser_idx ON message_endorsements(endorser_id);
