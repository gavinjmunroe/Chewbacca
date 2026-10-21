-- A FACT THAT HAPPENED NEVER STOPS HAVING HAPPENED.
--
-- amber_temporal_multiplier shipped in migration 011 with an inconsistency that
-- only shows up years out, which is exactly where it matters most:
--
--   'window_then_decay'  floors at window_residual. "The loan is repaid; it
--                        still happened."
--   'decay'              floored at ZERO. GREATEST(0.0, POWER(2, -days/hl)).
--
-- So the shape used for point events -- got divorced, lost a parent, got laid
-- off -- was the one that decayed to nothing, while the shape used for finished
-- windows kept a residual. Backwards. Karthik's example is the exact failure:
-- a divorce will not sting in ten years the way it stings today, and it also
-- does not become something that never happened. With the old function and a
-- 120-day half-life it was worth 0.4% of its original weight after two years
-- and unfindable after five.
--
-- The fix is one line: 'decay' gets the same GREATEST(window_residual, ...) that
-- 'window_then_decay' already had. Both shapes now fade toward a residual rather
-- than toward zero, and the two branches finally mean the same thing by "faded".
--
-- WHAT THIS DOES NOT CHANGE, and is worth writing down because I described it
-- wrongly to Karthik: 'permanent' is the DEFAULT shape and returns 1.0. Nothing
-- decays unless a fact was explicitly recorded as decaying. "Has two kids",
-- "moved to SF", "her sister is called Anna" have never decayed and do not now.
-- Decay is opt-in per fact, which is the design he asked for and the design that
-- was already there.
--
-- CREATE OR REPLACE. No table, no column, no index; the function is IMMUTABLE
-- and its signature is unchanged, so nothing that calls it needs to know.

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

    -- "moved to SF", "has two kids" — permanence cues win outright. THE DEFAULT.
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

    -- "got divorced", "just bought a car" — a point event whose PRESSURE fades
    -- while the event itself stays true. Floored, not vanishing: this is the one
    -- line this migration exists to change.
    WHEN 'decay' THEN
      GREATEST(window_residual,
        POWER(2.0, -1.0 * GREATEST(0, EXTRACT(EPOCH FROM (at - observed_at)) / 86400.0)
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
