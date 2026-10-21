-- Context files: Supabase mirror of GitHub context repo
-- Faster than GitHub API for every message, synced on startup
CREATE TABLE IF NOT EXISTS context_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  file_key text UNIQUE NOT NULL,
  -- e.g. ".claude/context/CALEB.md", ".claude/context/NOW.md"
  content text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'github',
  -- 'github' = synced from repo, 'manual' = written directly
  synced_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER context_files_updated_at
  BEFORE UPDATE ON context_files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS context_files_key_idx ON context_files(file_key);

ALTER TABLE context_files ENABLE ROW LEVEL SECURITY;

-- Vector memory: semantic search for long-term recall
-- Ready for pgvector when Perplexity embeddings API is wired up
-- For now, stores text memories with metadata for keyword search
CREATE TABLE IF NOT EXISTS memories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  handle text,
  -- null = global/Caleb memory, phone = per-contact memory
  scope text NOT NULL DEFAULT 'global',
  -- 'global', 'contact', 'project', 'idea'
  category text NOT NULL DEFAULT 'general',
  -- 'fact', 'preference', 'feedback', 'relationship', 'health', 'project', 'idea'
  content text NOT NULL,
  -- the actual memory text
  confidence float NOT NULL DEFAULT 0.8,
  -- 0.0-1.0, same scale as contact notes
  dimensions text[] DEFAULT '{}',
  -- health dimensions this memory relates to: {"social", "emotional"}
  source text NOT NULL DEFAULT 'inferred',
  -- 'explicit' (user said it), 'inferred' (AI extracted), 'system' (auto-generated)
  tags text[] DEFAULT '{}',
  -- freeform tags for filtering
  expires_at timestamptz,
  -- optional TTL for time-sensitive memories
  superseded_by uuid REFERENCES memories(id),
  -- if this memory was replaced by a newer one
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
  -- TODO: add embedding vector(1536) column when pgvector is enabled
  -- ALTER TABLE memories ADD COLUMN embedding vector(1536);
);

CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS memories_handle_idx ON memories(handle);
CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories(scope);
CREATE INDEX IF NOT EXISTS memories_category_idx ON memories(category);
CREATE INDEX IF NOT EXISTS memories_dimensions_idx ON memories USING GIN(dimensions);
CREATE INDEX IF NOT EXISTS memories_tags_idx ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at DESC);

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

-- Add staleness tracking to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes_updated_at timestamptz;
