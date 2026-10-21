-- amber_temporal_multiplier RAISES 22003 ON GENUINELY OLD DATA.
--
--   SELECT amber_temporal_multiplier('decay', now() - interval '500 days',
--                                    NULL, NULL, 2, now(), 0.15);
--   ERROR:  "0.00000...00055271478752604" is out of range for type real
--
-- The whole owner's rollup dies with it: refreshContactDimensionState computes
-- every contact in one statement, so ONE observation old enough to trip this
-- means that user has NO dimension state at all. Not a low score -- no row. The
-- six dimensions simply never populate for them, and the only symptom is an
-- exception in a background worker.
--
-- WHY THE FLOOR DID NOT SAVE IT, which is the part worth understanding, because
-- the code reads as though it should:
--
--     GREATEST(window_residual, POWER(2.0, -age/half_life))::real
--
-- `2.0` is a NUMERIC literal, so POWER returns numeric, and numeric has no
-- underflow -- it will happily represent 5e-75. window_residual is real. Postgres
-- resolves GREATEST(real, numeric) to REAL, which means it coerces the numeric
-- argument to real BEFORE comparing. numeric -> real goes through float4in, and
-- float4in REJECTS an out-of-range value rather than flushing it to zero. So the
-- conversion raises before GREATEST ever gets to pick the floor. The floor is
-- correct and unreachable.
--
-- THE FIX IS TO STAY IN float8 THE WHOLE WAY. exp() on double precision
-- underflows to zero quietly instead of raising, the -700 clamp keeps the
-- exponent inside float8's range with room to spare, and every argument to
-- GREATEST is already float8 so nothing is coerced behind our backs. Only the
-- final result -- always between window_residual and 1.0 -- becomes real.
--
-- exp(-ln(2) * n) is the same function as POWER(2, -n). This changes no
-- behaviour anyone can observe except that it stops throwing: migration 022's
-- floor semantics are preserved exactly, and 023's window rules are untouched.
--
-- FOUND BY MIGRATED DATA. Nothing in the app had observations old enough --
-- because of a SECOND bug, fixed in the same commit, that gave every observation
-- a one-day half-life and so pinned everything at the floor long before it could
-- get far enough out to overflow the cast. With real dates carried over from the
-- old database, a 500-day-old hiking trip found it immediately.

CREATE OR REPLACE FUNCTION amber_temporal_multiplier(
  shape           text,
  observed_at     timestamptz,
  valid_from      timestamptz,
  valid_until     timestamptz,
  half_life_days  integer,
  at              timestamptz,
  window_residual real DEFAULT 0.15
) RETURNS real
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE shape

    -- "moved to SF", "has two kids" -- permanence cues win outright. THE DEFAULT.
    WHEN 'permanent' THEN 1.0::real

    -- "in SF for the next three months".
    -- Zero before it starts; full inside; a small RESIDUAL after, because
    -- "she was in SF last spring" is still real knowledge, just not current.
    WHEN 'window' THEN
      CASE
        WHEN valid_from IS NOT NULL AND at < valid_from THEN 0.0::real
        WHEN valid_until IS NOT NULL AND at > valid_until THEN window_residual
        ELSE 1.0::real
      END

    -- "got divorced", "just bought a car" -- a point event whose PRESSURE fades
    -- while the event itself stays true. Floored, never vanishing.
    WHEN 'decay' THEN
      GREATEST(
        window_residual::float8,
        exp(GREATEST(-700::float8,
              -ln(2::float8)
              * GREATEST(0::float8,
                  EXTRACT(EPOCH FROM (at - observed_at))::float8 / 86400.0)
              / NULLIF(half_life_days, 0)::float8)))::real

    -- "took a loan for three months" -- full pressure during the term, then it
    -- fades from the day the term ends. The loan is repaid; it still happened.
    WHEN 'window_then_decay' THEN
      CASE
        WHEN valid_from IS NOT NULL AND at < valid_from THEN 0.0::real
        WHEN valid_until IS NULL OR at <= valid_until THEN 1.0::real
        ELSE GREATEST(
               window_residual::float8,
               exp(GREATEST(-700::float8,
                     -ln(2::float8)
                     * GREATEST(0::float8,
                         EXTRACT(EPOCH FROM (at - valid_until))::float8 / 86400.0)
                     / NULLIF(half_life_days, 0)::float8)))::real
      END

    ELSE 1.0::real
  END;
$$;

COMMENT ON FUNCTION amber_temporal_multiplier IS
  'Temporal weight of an observation at a point in time. float8 throughout: a '
  'numeric POWER() underflowed the cast to real and raised 22003 on data more '
  'than ~250 half-lives old, taking the whole owner''s dimension rollup with it.';
