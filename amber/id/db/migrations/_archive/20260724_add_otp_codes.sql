-- OTP codes for the medha auth flow (mobile + dashboard).
-- Replaces the in-process medha-otp-store Map so OTPs survive redeploys
-- and work across multiple replicas.
--
-- code_hash      = sha256(phone || ':' || code)  — primary verify path
-- code_only_hash = sha256(code)                  — reverse lookup for code-only verify
-- requester_ip   — used for per-IP rate limiting on the mobile request endpoint
--
-- Idempotent: CREATE TABLE IF NOT EXISTS handles fresh DBs; the ALTER TABLE
-- ADD COLUMN IF NOT EXISTS block below reconciles a pre-existing table that
-- is missing our columns. ALTERs are nullable / have safe defaults so they
-- never fail on tables with existing rows.

CREATE TABLE IF NOT EXISTS otp_codes (
  id             bigserial PRIMARY KEY,
  phone          text NOT NULL,
  code_hash      text NOT NULL,
  code_only_hash text NOT NULL,
  attempts       int  NOT NULL DEFAULT 0,
  expires_at     timestamptz NOT NULL,
  last_sent_at   timestamptz NOT NULL DEFAULT now(),
  requester_ip   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS phone          text;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash      text;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_only_hash text;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts       int          DEFAULT 0;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS expires_at     timestamptz;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS last_sent_at   timestamptz  DEFAULT now();
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS requester_ip   text;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS created_at     timestamptz  DEFAULT now();
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS deleted_at     timestamptz;

CREATE INDEX IF NOT EXISTS otp_codes_phone_active_idx
  ON otp_codes (phone)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS otp_codes_code_only_active_idx
  ON otp_codes (code_only_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS otp_codes_ip_created_idx
  ON otp_codes (requester_ip, created_at)
  WHERE requester_ip IS NOT NULL;
