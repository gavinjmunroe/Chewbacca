-- THE TEMPORAL MULTIPLIER, as a function so the rollup job is one UPDATE and so
-- the maths lives in exactly one place instead of being reimplemented in Node
-- and Python with a slow drift between them.
--
-- Takes `at` as an argument rather than calling now() internally, which keeps it
-- IMMUTABLE, testable ("what will this score be in six months?"), and legal
-- inside an index expression should that ever be wanted.

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

    -- "moved to SF", "has two kids" — permanence cues win outright.
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

    -- "just bought a car" — a point event whose effect fades.
    WHEN 'decay' THEN
      GREATEST(0.0, POWER(2.0, -1.0 * GREATEST(0, EXTRACT(EPOCH FROM (at - observed_at)) / 86400.0)
                                / NULLIF(half_life_days, 0)))::real

    -- "took a loan for three months" — full pressure during the term, then it
    -- fades from the day the term ends. The loan is repaid; it still happened.
    WHEN 'window_then_decay' THEN
      CASE
        WHEN valid_from IS NOT NULL AND at < valid_from THEN 0.0::real
        WHEN valid_until IS NULL OR at <= valid_until THEN 1.0::real
        ELSE GREATEST(window_residual,
               POWER(2.0, -1.0 * (EXTRACT(EPOCH FROM (at - valid_until)) / 86400.0)
                          / NULLIF(half_life_days, 0)))::real
      END

    ELSE 1.0::real
  END;
$$;
