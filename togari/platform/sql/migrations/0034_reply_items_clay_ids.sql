-- 0034_reply_items_clay_ids.sql
--
-- Three columns 0033 should have had.
--
-- lead_id / campaign_id: Clay's "reply to lead in a campaign" action is keyed
-- on the pair, and it is what makes an approved reply leave from the campaign's
-- own mailbox rather than a generic one. sendViaClay REFUSES to send without
-- both (slack-actions.ts:270) — deliberately, so a reply never goes out from
-- the wrong address. The implementation plan's section 6 payload has no slot
-- for them because it is written generically; Serif's send path cannot work
-- without them, so they ride on the row from intake all the way to the card.
--
-- session_ref: Perplexity returns it on the step 04 callback. Stored for
-- tracing a card back to the Perplexity session that wrote it, since Perplexity
-- keeps its own readable record of every session.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Additive: existing rows get NULL in all three. Nothing is rewritten.

ALTER TABLE `togari_data_lake.reply_items`
  ADD COLUMN IF NOT EXISTS lead_id     INT64,   -- Clay lead id, required to send
  ADD COLUMN IF NOT EXISTS campaign_id INT64,   -- Clay campaign id, required to send
  ADD COLUMN IF NOT EXISTS session_ref STRING;  -- Perplexity session, for tracing
