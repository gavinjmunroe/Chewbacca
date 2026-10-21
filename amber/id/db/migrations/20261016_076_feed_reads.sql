-- ============================================================================
-- WHAT YOU HAVE NOT READ YET.
--
-- The rail used to carry a count beside Knowledge, Files, Feed and People, and
-- all four were the same number: how many things exist. "Files 31" told
-- somebody there are thirty-one files, which they could see by opening Files,
-- and it did it in the visual language every other product reserves for "these
-- need you". A badge that always has a number on it is a badge nobody reads.
--
-- So the counts are gone everywhere except the feed, and the feed's is now a
-- real unread count rather than a total. That needs one fact per person: the
-- last time they looked.
--
-- A WATERMARK, NOT A PER-POST LEDGER. One row per person per company, holding
-- a timestamp. A read-receipt table would be one row per person per post --
-- for a company of 500 with a busy feed that is millions of rows to answer a
-- question nobody asks more precisely than "is there anything new". The cost
-- of the watermark is that marking one post unread is not possible, which is
-- a feature this does not have.
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_feed_reads (
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, amber_id)
);

-- Same tenant policy as every other org table. The watermark says when a named
-- person last looked at a named company's feed, which is nobody else's.
ALTER TABLE org_feed_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amber_tenant ON org_feed_reads;
CREATE POLICY amber_tenant ON org_feed_reads
  USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
  WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org());
