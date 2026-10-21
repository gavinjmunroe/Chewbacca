-- Amber Platform Database Schema
-- Postgres + pgvector

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- PEOPLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Identity
  full_name TEXT NOT NULL,
  nicknames TEXT[] DEFAULT '{}',
  phone TEXT,
  email TEXT,
  instagram TEXT,
  linkedin TEXT,
  other_handles JSONB DEFAULT '{}',

  -- Relationship context
  relationship_type TEXT DEFAULT 'other',
  trust_level INTEGER DEFAULT 3 CHECK (trust_level BETWEEN 1 AND 5),
  emotional_safety_score INTEGER CHECK (emotional_safety_score BETWEEN 0 AND 100),
  reliability_score INTEGER CHECK (reliability_score BETWEEN 0 AND 100),
  connection_strength INTEGER CHECK (connection_strength BETWEEN 0 AND 100),
  last_interaction_at TIMESTAMPTZ,
  next_recommended_move_at TIMESTAMPTZ,

  -- Human context
  personality_notes TEXT,
  communication_style TEXT,
  spiritual_orientation TEXT,
  professional_context TEXT,
  current_season_of_life TEXT,
  interests TEXT[] DEFAULT '{}',
  values TEXT[] DEFAULT '{}',
  preferences TEXT[] DEFAULT '{}',
  aversions TEXT[] DEFAULT '{}',
  location TEXT,
  timezone TEXT,

  -- Search
  tags TEXT[] DEFAULT '{}',
  summary_text TEXT,
  embedding_vector vector(1536), -- text-embedding-3-small dimension

  -- System
  privacy_tier TEXT DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_people_user_id ON people(user_id);
CREATE INDEX IF NOT EXISTS idx_people_embedding ON people USING ivfflat (embedding_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_people_tags ON people USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_people_full_name ON people(user_id, lower(full_name));

-- ============================================================================
-- MEMORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  person_ids UUID[] DEFAULT '{}',

  source TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  summary TEXT,

  traits TEXT[] DEFAULT '{}',
  emotional_label TEXT,
  trust_signals TEXT[] DEFAULT '{}',
  life_events TEXT[] DEFAULT '{}',
  action_item_ids UUID[] DEFAULT '{}',

  confidence FLOAT DEFAULT 0.85,
  privacy_tier TEXT DEFAULT 'standard',
  tags TEXT[] DEFAULT '{}',
  embedding_vector vector(1536),
  is_actionable BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_person_ids ON memories USING gin(person_ids);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(user_id, created_at DESC);

-- ============================================================================
-- ACTION ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  person_ids UUID[] DEFAULT '{}',
  memory_id UUID REFERENCES memories(id),

  description TEXT NOT NULL,
  suggested_message TEXT,
  due_at TIMESTAMPTZ,
  priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  status TEXT DEFAULT 'open',
  requires_approval BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_action_items_user_id ON action_items(user_id, status);
CREATE INDEX IF NOT EXISTS idx_action_items_person_ids ON action_items USING gin(person_ids);

-- ============================================================================
-- RELATIONSHIP STATE
-- ============================================================================

CREATE TABLE IF NOT EXISTS relationship_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  person_id UUID NOT NULL REFERENCES people(id),

  temperature TEXT DEFAULT 'warm',
  trust_stage INTEGER DEFAULT 2 CHECK (trust_stage BETWEEN 1 AND 5),
  emotional_tone TEXT,
  last_meaningful_touchpoint_at TIMESTAMPTZ,
  next_recommended_move TEXT,
  topics_to_avoid TEXT[] DEFAULT '{}',
  topics_to_lean_into TEXT[] DEFAULT '{}',
  reciprocity_level INTEGER,
  ghost_risk INTEGER CHECK (ghost_risk BETWEEN 0 AND 100),
  shared_communities TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, person_id)
);

-- ============================================================================
-- APPROVAL TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS approval_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  person_ids UUID[] DEFAULT '{}',

  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  reasoning TEXT,
  draft_content TEXT NOT NULL,
  affected_channels TEXT[] DEFAULT '{}',

  status TEXT DEFAULT 'pending',
  user_feedback TEXT,
  edited_content TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approval_tasks_user_id ON approval_tasks(user_id, status);
