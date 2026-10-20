# Phase 1 Follow-ups

Low-priority items surfaced during Phase 1 that are not blocking but
should be revisited.

## Slack permalink enrichment on deal notes

During Phase 1 inventory it was assumed src/agents/slack-sync/deal-sync.ts
embedded a Slack permalink in the BigQuery notes field. It does not.
Today notes contain only `[YYYY-MM-DD] {rawText}`.

Worth adding later so BQ deal rows link back to the originating Slack
thread for audit/context. Low priority, not blocking Phase 1-3.

When implemented, extend TEST 21 in tests/smoke/slack.test.ts to assert
the permalink is present rather than just the raw mention text.

## sql-generator uses direct fetch

In Step 3, bigquery/sql-generator.ts was switched from the Anthropic
SDK to direct fetch so tests can intercept the call. Consider unifying
back to the SDK (with proper mock injection — e.g. dependency-injected
client) if SDK retry/error semantics become important elsewhere.
Low priority, not blocking Phase 1-3.
