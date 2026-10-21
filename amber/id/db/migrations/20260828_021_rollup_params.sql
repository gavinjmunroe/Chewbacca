-- ROLLUP BASELINES. Six numbers, each with a job, at human timescales.
--
-- src/db/contact-rollup.js fills contact_interaction_stats and contact_scores,
-- two tables that shipped in migrations 008 and 009 with nothing writing to
-- them. The coefficients live here rather than in the module for the same reason
-- semantic_alpha does: they are product opinions, they will be argued about, and
-- arguing about them should not require a deploy.
--
-- THE FIRST VERSION OF THIS FILE SAID warmth_half_life_days = 45, meaning a
-- relationship loses half its warmth in six weeks. That is not how people work.
-- Karthik was right to throw it out, and the fix is not a bigger number in the
-- same wrong shape:
--
--   1. RECENCY HAS A FLOOR AND A YEAR SCALE. A close friend you have not called
--      in three months is still a close friend. Decaying toward zero says the
--      opposite. Half-life is now a year, and the curve bottoms out at
--      window_residual instead of vanishing -- you still know them.
--
--   2. FREQUENCY IS A MEASURED CADENCE, NOT A RAW COUNT. count_90d rewards
--      whoever you happened to be busy with this quarter. Interactions per month
--      over the life of the relationship is a quantity actually derivable from
--      what the stats table holds (count_all and first_interaction_at), and it
--      says something durable: you see this person monthly, you saw that person
--      twice in four years.
--
--   3. THE THIRD SCORE WEIGHT IS DERIVED, NOT STORED. The three base_score terms
--      must sum to 1. Storing all three invites them not to, and then no reading
--      of the table tells you which one is wrong.
--
-- THESE ARE BASELINES, NOT MEASUREMENTS. Nothing here was calibrated against
-- real relationship data, because there is none in the new schema yet. What is
-- defensible today is the SHAPE -- floored rather than vanishing, years rather
-- than weeks, measured cadence rather than a recent-activity count. The numbers
-- are starting points for Karthik and his co-founder to move.
--
-- THE MODULE CARRIES THE SAME DEFAULTS, so a database without this migration
-- computes the same rollup rather than a table of zeroes. These rows exist to
-- make the numbers visible and changeable, not to make the job possible.
--
-- No table is created, no column is altered, and no index is added.

INSERT INTO scoring_params (key, value, note) VALUES
  ('warmth_half_life_days', 365,
   'recency = 0.5 at one year since the last interaction, floored at window_residual. Relationships do not vanish, they go dormant'),
  ('warmth_recency_weight', 0.5,
   'warmth = recency * this + cadence * (1 - this). 0.5 is deliberately no claim either way until there is data'),
  ('cadence_k', 0.7,
   'cadence = 1 - exp(-k * interactions_per_month). Saturates around two or three a month, which is what a close relationship looks like'),
  ('evidence_k', 0.2,
   'evidence = 1 - exp(-k * observation_count). How fast knowing more about someone stops counting'),
  ('score_warmth_weight', 0.6,
   'base_score term: how recently and how regularly you are actually in contact'),
  ('score_evidence_weight', 0.25,
   'base_score term: how much we know about them. The completeness weight is 1 minus these two, never stored')
ON CONFLICT (key) DO NOTHING;

-- ON CONFLICT DO NOTHING, not DO UPDATE. If somebody has already tuned these on
-- a live database, re-running the migration must not quietly reset their work.
