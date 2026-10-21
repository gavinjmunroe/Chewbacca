-- ============================================================
-- Migration 002: Multi-tenant support for amber-agent
-- Adds tenants table and tenant_id FK to core tables.
-- ============================================================

-- ── Tenants table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  amber_id text UNIQUE NOT NULL,
  privy_did text UNIQUE,
  display_name text,
  phone_number text,
  loop_sender_id text,
  loop_sender_phone text,
  onboarding_profile jsonb DEFAULT '{}',
  permissions jsonb DEFAULT '{}',
  context_repo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Index for webhook tenant resolution (incoming sender ID -> tenant)
CREATE INDEX IF NOT EXISTS tenants_loop_sender_id_idx ON tenants(loop_sender_id);
CREATE INDEX IF NOT EXISTS tenants_phone_number_idx ON tenants(phone_number);

-- ── Add tenant_id to existing tables ────────────────────────

-- contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS contacts_tenant_id_idx ON contacts(tenant_id);

-- conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS conversations_tenant_id_idx ON conversations(tenant_id);

-- interactions
ALTER TABLE interactions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS interactions_tenant_id_idx ON interactions(tenant_id);

-- user_sessions
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS user_sessions_tenant_id_idx ON user_sessions(tenant_id);

-- health_profiles
ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS health_profiles_tenant_id_idx ON health_profiles(tenant_id);

-- health_checkins
ALTER TABLE health_checkins ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS health_checkins_tenant_id_idx ON health_checkins(tenant_id);

-- memories
ALTER TABLE memories ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS memories_tenant_id_idx ON memories(tenant_id);

-- group_memories
ALTER TABLE group_memories ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS group_memories_tenant_id_idx ON group_memories(tenant_id);

-- context_files
ALTER TABLE context_files ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS context_files_tenant_id_idx ON context_files(tenant_id);

-- trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS trips_tenant_id_idx ON trips(tenant_id);

-- group_tasks
ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS group_tasks_tenant_id_idx ON group_tasks(tenant_id);

-- ── Number pool table (for future Loop Message enterprise) ──
CREATE TABLE IF NOT EXISTS number_pool (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  loop_sender_id text UNIQUE NOT NULL,
  loop_sender_phone text NOT NULL,
  assigned_to uuid REFERENCES tenants(id),
  assigned_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE number_pool ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS number_pool_assigned_to_idx ON number_pool(assigned_to);
