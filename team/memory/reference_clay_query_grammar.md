---
name: reference_clay_query_grammar
description: "Clay's query-mode grammar, discovered by probing: the three entities, the real field names, and the one predicate that turns a name lookup into a full dated work history for free."
metadata:
  node_type: memory
  type: reference
  originSessionId: 9f35b1ad-d308-434c-88a5-7fb57849abdf
  modified: 2026-09-18T18:59:40.161Z
---

Probed live 2026-09-18 against `api.clay.com/public/v0/search/query-mode`. Clay
publishes none of this, so it was found by sending bad queries and reading the
error messages back.

## The one line that matters

```
select from people where full_name = "X" and experiences.any(start_date >= "1900-01")
```

**`matched_experiences` returns the experiences that matched your query, not the
person's record.** A bare `full_name` filter matches nothing about employment,
so Clay hands back current roles only and drops every past job with no error and
no empty field to notice. Adding an experience predicate every row satisfies
widens the match to the whole dated history.

Measured on one profile: **3 experiences before, 9 after**, past roles carrying
their end dates. This was the bug in Chewbacca's `clayCandidates`, fixed in
`740becc`. See [[project_chewbacca_clay_history_fix]].

## Entities and fields

Three entities: `PEOPLE`, `COMPANIES`, `JOBS`.

**people** takes only `full_name`, `headline`, and `experiences.any(...)`.
There is no `location`, `email`, `linkedin_url`, `education` or `skills` field,
and `company` is rejected with a message telling you to use the experience form
instead.

**experiences.any()** takes `company_name`, `title`, `job_title`, `is_current`,
`start_date`, `end_date`, `location`, `seniority`. Dates are `YYYY-MM`.
Seniority is an enum: Founder, Owner, Board Member, Partner, C-suite, +9 more.

`is_current = false` alone returns only past roles, which is how you ask
"who used to work at Anthropic".

## Cost and limits

**Search is free and it is not close.** Balance sat at 262.5 across every query
in a two-hour session. The daily quota is **1,000,000** searches, resets
midnight UTC, and heavy use that day was under 11,000. Cost is never the
constraint on search. Enrichment, which is a different operation, is billed per
record.

**Throughput is the constraint.** Clay throttles workspace-wide, so concurrency
buys almost nothing: 3.9s/person serial, 2.5s at 8 workers, 6s at 5 workers
once its own load built. Budget ~3 hours for 2,000 people and run it detached.

## Reading an empty result

- **429** means throttled, so retry with backoff and never record it as a result.
- **200 with `exhaustion_reason: "no_more_results"` and zero rows** is a
  genuine miss.

Confirmed both by pausing the scraper and re-querying a name known to exist.
Chewbacca already handled this correctly; the second bug I went looking for was
not there. See a private note.

## Match rate on Caleb's network

Roughly **two thirds**. All 2,199 of his LinkedIn connections have a URL in the
export, so match candidates on `linkedin_url` and refuse the rest rather than
pick among same-name people. Of 59 people Clay returned candidates for, 39
matched by URL. "Clay returned something" is a different and more flattering
number than "Clay returned the right person", and the second one is what to
quote, per a private note.

## Search quota, measured on a live workspace 2026-09-22

The CLI help text lists plan tiers with yearly resets (Free 100/month, Paid
1,000,000/year). The live `periodQuota` on Jonah's Workspace read differently:

```
limit      1,000,000
used              40
remaining    999,960
resetsAt   next midnight UTC
```

So the limit is effectively **a million a day**, not a year, and the help text is
misleading. One returned row costs one unit, so search is free at the scale of an
outbound engagement. **Credits are the scarce resource**, spent on email enrichment,
because Clay Search cannot filter or return an email address.

**A search is asynchronous.** `query-mode create` hands back a searchId at once and
`query-mode run` returns an empty page with `hasMore: null` until it populates, which
looks exactly like a query that matched nothing. Poll before believing a zero.

Related: a private note
