-- F1 enrichment foundation.
-- (a/b) Commit the canonical `contacts` and `contact_facts` schemas — both were
--       bootstrapped directly in prod and had NO committed DDL. These CREATE
--       TABLE IF NOT EXISTS blocks are a no-op on prod (tables exist) and make
--       the schema reproducible for fresh envs. Reproduced EXACTLY from a live
--       information_schema + pg_indexes dump (tags is text[]; PK indexes come
--       from the PRIMARY KEY clause, the other indexes are recreated by name).
-- (c)   Add the enrichment-lifecycle columns to contacts.
-- Idempotent throughout.

CREATE TABLE IF NOT EXISTS contacts (
  id                       bigserial   PRIMARY KEY,
  owner_phone              text,
  full_name                text,
  first_name               text,
  last_name                text,
  phone_primary            text,
  phones_all               text,
  emails                   text,
  company                  text,
  title                    text,
  city                     text,
  apple_notes              text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  owner_id                 uuid,
  external_id              text,
  source                   text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  linked_amber_id          uuid,
  location                 text,
  birthday                 timestamptz,
  avatar_url               text,
  linkedin_url             text,
  twitter_url              text,
  github_url               text,
  website                  text,
  relationship_type        text,
  relationship_score       real,
  tags                     text[],
  message_frequency        real,
  interaction_count        integer     NOT NULL DEFAULT 0,
  last_interaction_at      timestamptz,
  last_contacted_at        timestamptz,
  metadata                 jsonb,
  raw                      jsonb,
  phone_primary_normalized text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_owner_external
  ON public.contacts USING btree (owner_id, external_id)
  WHERE ((external_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS contacts_owner_active_idx
  ON public.contacts USING btree (owner_id, deleted_at);
CREATE INDEX IF NOT EXISTS contacts_owner_phone_norm_idx
  ON public.contacts USING btree (owner_id, phone_primary_normalized)
  WHERE ((phone_primary_normalized IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS contacts_owner_phone_primary_idx
  ON public.contacts USING btree (owner_id, phone_primary);
CREATE INDEX IF NOT EXISTS idx_contacts_owner
  ON public.contacts USING btree (owner_phone) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_id
  ON public.contacts USING btree (owner_id) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS contacts_linked_amber_idx
  ON public.contacts USING btree (linked_amber_id) WHERE (linked_amber_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS contact_facts (
  id                 bigserial   PRIMARY KEY,
  owner_id           uuid        NOT NULL,
  contact_id         bigint,
  fact_text          text        NOT NULL,
  category           text,
  source             text        NOT NULL,
  source_ref         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  raw_name           text,
  status             text        NOT NULL DEFAULT 'resolved',
  sentiment          text,
  sentiment_strength real,
  certainty          real,
  is_conditional     boolean     DEFAULT false,
  condition_text     text,
  is_past            boolean     DEFAULT false,
  weight             real
);

CREATE INDEX IF NOT EXISTS idx_facts_owner_category
  ON public.contact_facts USING btree (owner_id, category) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_facts_owner_contact
  ON public.contact_facts USING btree (owner_id, contact_id, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_facts_owner_created
  ON public.contact_facts USING btree (owner_id, created_at DESC) WHERE (deleted_at IS NULL);

-- (c) Enrichment-lifecycle columns.
--   enrichment            full enriched payload + provenance (provider, confidence,
--                         headline, work history, industry, fetched_at, …)
--   enrichment_status     'unenriched' | 'ambiguous' | 'resolved' | 'failed' (NULL = unenriched)
--   enriched_at           when enrichment last resolved
--   enrichment_candidates ranked ambiguous-profile ARRAY; cleared to NULL on resolve
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enrichment            jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enrichment_status     text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enriched_at           timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enrichment_candidates jsonb;
