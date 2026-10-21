-- device_sessions — refresh-token families for the phone-OTP login path.
--
-- WHY THIS EXISTS
-- Before this table, a successful OTP verify minted a single 30-day HS256
-- bearer with no server-side record. That meant (a) a stolen token was valid
-- for 30 days, (b) there was no way to revoke it, and (c) "sign out" was a
-- purely client-side act — /v1/auth/invalidate 404'd.
--
-- The replacement is the standard two-token model:
--   * a SHORT-LIVED access JWT (15 min) carrying `sid` = device_sessions.id
--   * a LONG-LIVED opaque refresh token (60 days, SLIDING) stored here as a
--     sha256 hash, rotated on every use.
--
-- The user experience is unchanged and deliberately so: the client refreshes
-- silently in the background, so a person stays signed in until they actually
-- sign out. Sliding expiry means an active user's session never lapses.
--
-- ROTATION + REUSE DETECTION
-- Each refresh mints a new token and moves the old hash to prev_refresh_hash.
-- Presenting a token that is neither current nor a recent prev means the token
-- was captured and replayed -> the entire family is revoked and the user must
-- sign in again. Presenting a recent prev (within REPLAY_GRACE) is treated as a
-- lost-response retry and is answered idempotently, so a flaky network never
-- signs anyone out.

CREATE TABLE IF NOT EXISTS device_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who. subject_id is whatever requireAuth puts in privyUser.userId for this
  -- login path: the medha person_id (sha256(E.164) truncated to 32 hex).
  -- Kept as text so an amber-id DID or a future provider subject also fits.
  subject_id         text NOT NULL,
  phone              text,

  -- Rotation family. All descendants of one sign-in share a family_id so a
  -- detected replay can revoke every token minted from that sign-in at once.
  family_id          uuid NOT NULL,

  -- sha256 hex of the opaque refresh token. The plaintext is returned to the
  -- client exactly once and never stored.
  refresh_hash       text NOT NULL,
  prev_refresh_hash  text,
  rotated_at         timestamptz,

  -- Device attribution, for the "signed-in devices" screen. All client-supplied
  -- and therefore advisory only -- never used for authorization.
  device_id          text,
  device_name        text,
  device_os          text,
  app_version        text,
  last_ip            text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text
);

-- The hot path: look up a live session by the presented refresh token.
-- Partial-unique so a revoked row can never shadow a live one, and so the
-- same hash cannot be live twice.
CREATE UNIQUE INDEX IF NOT EXISTS device_sessions_refresh_live_uidx
  ON device_sessions (refresh_hash)
  WHERE revoked_at IS NULL;

-- Replay detection looks up by the PREVIOUS hash.
CREATE INDEX IF NOT EXISTS device_sessions_prev_refresh_idx
  ON device_sessions (prev_refresh_hash)
  WHERE prev_refresh_hash IS NOT NULL;

-- Revoke-the-whole-family, and the per-user device list.
CREATE INDEX IF NOT EXISTS device_sessions_family_idx
  ON device_sessions (family_id);

CREATE INDEX IF NOT EXISTS device_sessions_subject_live_idx
  ON device_sessions (subject_id, revoked_at, last_used_at DESC);

-- Sweeper support: expired-but-not-revoked rows.
CREATE INDEX IF NOT EXISTS device_sessions_expiry_idx
  ON device_sessions (expires_at)
  WHERE revoked_at IS NULL;
