# Clay workbook

Structure for `BMA Workspace > Amber > Expansion > Caleb Newton`, alongside the
existing Chewbacca table that already holds 3,352 rows and 61 columns.

Sagar's rule about naming applies: the folder and table names carry the packaging,
so a person can tell what is being sold without opening anything.

## Tables

One account table per campaign, plus one shared warm-filter table that all three
join against.

```
Amber > Expansion > Caleb Newton
├── Chewbacca                        existing, 3,352 rows, 61 cols. The warm store.
├── WARM-FILTER                      join key table, built from Chewbacca
├── C1 - Emerging Funds - $1k Audit
├── C2 - Founder-Led Services - $1k Audit
└── C3 - Coaches - Amber Consumer
```

## WARM-FILTER

Built once from the local store, refreshed weekly. This is the table that makes
the whole thing Amber rather than generic outbound.

| Column | Source | Notes |
|---|---|---|
| `linkedin_url` | local store | The join key. 2,241 of 3,349 people carry one |
| `name` | local store | |
| `company`, `role` | local store | |
| `relationship` | derived | `known`, `second_degree`, or absent |
| `interaction_count` | local store | 3,762 interactions across the store |
| `last_contact` | local store | |
| `last_topic` | local store | What was actually discussed. This is the personalization |

Regenerate it with [export-warm-filter.sh](export-warm-filter.sh). It is built
and it runs: **2,241 rows, 1,299 of them tagged `known`.** The export itself is
gitignored on purpose, because it is real people and it does not belong in a repo.

### Whose warm network this actually is

Worth being exact, because the distinction changes what it can do. This table is
built from **Caleb's** store, so it suppresses and personalizes against Caleb's
relationships. Sagar asked for a column that filters out **his**.

Those are the same column and different data. Getting Sagar's version means the
install runs once on Sagar's machine, which takes 45 minutes and is the same
45 minutes being sold in campaigns 1 and 2.

Which makes the first engagement Sagar's own, and it produces the exact column
he asked for as its output. Until that happens this table does two real jobs and
not the third:

1. Stops the campaigns cold-emailing the 1,299 people Caleb already knows.
2. Supplies the second-degree mutual that personalizes email 1.
3. Sagar's own suppression list, which needs his install and does not exist yet.

## Every campaign table

Same column order in all three, so a reply in one can be read the same way as a
reply in another.

**Account columns.** `company`, `domain`, `headcount`, `location`,
`account_source`.

**Signal columns.** `signal_type`, `signal_date`, `signal_evidence` (the URL or
the post text that fired it), `signal_age_days`. A row does not send without
`signal_evidence` populated, which is how the copy stays specific.

**Target columns.** `first_name`, `last_name`, `title`, `linkedin_url`,
`email`, `email_source`, `email_verified`.

**Warm columns, joined from WARM-FILTER on `linkedin_url`.** `relationship`,
`last_contact`, `last_topic`, `mutual_name`.

**Routing.** `route` is computed and decides everything downstream:

| `relationship` | `route` | What happens |
|---|---|---|
| `known` | `personal_text` | Never enters the sequence. Goes to Sagar or Caleb with `last_topic` attached |
| `second_degree` | `sequence_warm` | Email 1's opening line is replaced with the named mutual |
| empty | `sequence_cold` | Runs as written |

**Send columns.** `sequence_step`, `sent_at`, `inbox_used`, `replied_at`,
`reply_sentiment`, `do_not_contact`.

## Credit discipline

Sagar's standard is a consistent average of messages sent and credits spent per
workbook, so the thing can be set and then left alone.

- Enrichment only fires on rows where `signal_evidence` is already populated. No
  credits are spent on an account that has not done anything yet.
- Campaign 3 is the only one buying personal emails, and it is capped at a third
  of daily volume for that reason.
- The free Clay workaround applies wherever a LinkedIn URL is already held:
  search by name, which costs nothing, then match one to one on the URL already
  in the store. Demonstrated at 266.6 credits before and 266.6 after.

## Exit rules

A target leaves a campaign on a reply, or on `do_not_contact`. Nothing else
removes a row. Everything that stays gets re-scanned by the signals, which is
what makes this an engine rather than a send.
