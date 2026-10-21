-- FiduciaryOS Supabase schema
-- Run: supabase db push  OR paste into Supabase SQL editor

-- ── user_profiles ──────────────────────────────────────────────────────────────
create table if not exists user_profiles (
  id           text primary key,          -- e.g. "fiduciaryos" (single-user)
  profile      jsonb        not null,
  updated_at   timestamptz  not null default now()
);

-- ── plaid_items ────────────────────────────────────────────────────────────────
create table if not exists plaid_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null,
  institution_name   text,
  encrypted_token    text not null,       -- AES-256-GCM encrypted access token
  created_at         timestamptz not null default now()
);

create index if not exists plaid_items_user_id_idx on plaid_items (user_id);

-- ── balance_snapshots ──────────────────────────────────────────────────────────
create table if not exists balance_snapshots (
  id              uuid primary key default gen_random_uuid(),
  plaid_item_id   uuid references plaid_items(id) on delete cascade,
  account_id      text not null,
  account_name    text,
  account_type    text,
  account_subtype text,
  balance_current numeric(18,2),
  balance_available numeric(18,2),
  iso_currency_code text default 'USD',
  captured_at     timestamptz not null default now()
);

create index if not exists balance_snapshots_item_idx on balance_snapshots (plaid_item_id, captured_at desc);

-- ── policy_artifacts ───────────────────────────────────────────────────────────
create table if not exists policy_artifacts (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null,
  artifact_json text not null,            -- full RSA-4096 signed JSON
  signature     text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists policy_artifacts_client_idx on policy_artifacts (client_id, created_at desc);

-- ── audit_entries ──────────────────────────────────────────────────────────────
create table if not exists audit_entries (
  id                   uuid primary key default gen_random_uuid(),
  client_id_hash       text not null,
  timestamp_iso        timestamptz not null default now(),
  action_type          text not null,
  action_details       jsonb,
  policy_check_passed  boolean not null default true,
  risk_level           smallint not null default 0,
  model_reasoning      text,
  signature            text
);

create index if not exists audit_entries_client_idx on audit_entries (client_id_hash, timestamp_iso desc);

-- ── waitlist ─────────────────────────────────────────────────────────────────
create table if not exists waitlist (
  email       text primary key,
  created_at  timestamptz not null default now()
);
