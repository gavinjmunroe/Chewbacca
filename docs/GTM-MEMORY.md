# GTM memory

Caleb, 2026-10-09: "Just how chewbacca/amber has architecture to remember and
manage relationships extremely well, it needs to be the same exact level if not
higher of excellence for all things gtme, clay, and managing EVERYTHING."

The bar is the `people` store (`bin/lib/people/`). This file lists what makes
that store good, names the GTM equivalent of each piece, and then describes the
store that implements them: `~/.chewbacca/gtm/memory.db`, read by
`chewbacca gtm-memory`.

## What the people store gets right

Read from `bin/lib/people/*.js` and the live `people.db` schema (structure only).

1. **Observations, not columns.** Every fact is a row in one `observations`
   table with `source` (told_directly, observed, inferred, third_party,
   imported), `modality` (actual, planned, hypothetical...), `temporal` shape
   (permanent, window, decaying) and `observed_at`. Nothing overwrites a fact:
   `people update --company` writes "moved from A to B" as an observation
   instead of losing A (`keeping-up.js`).
2. **Identity never merges on a name.** `identities` maps a phone or email to
   exactly one person. A group-chat handle gets a name only from evidence in the
   thread (`identities.js`), `resolve.js` treats an embedded surname as a
   constraint that can veto a candidate, and `brief.js` refuses to brief when two
   live rows share a name.
3. **Scores with decay, tunable as data.** weight = source trust x modality x
   temporal shape x 2^(-age/half_life); a dimension saturates as
   1 - exp(-k x sum). Every knob is a row in `scoring_params`, not a constant.
4. **Score history that cannot lie about the past.** `history.js` recomputes a
   score as of a date using only observations observed by then, so a curve
   never shows every relationship improving. `score_history` also keeps frozen
   snapshots.
5. **A timeline.** `interactions` plus `messages`, one definition of last
   contact, and a rule that a broadcast is not a conversation: an outbound day
   to more than thirty people only counts for a person who replied.
6. **Commitments.** `tasks` (what you promised, due when), `loans`,
   `important_dates`, `next_check_at` with a reason.
7. **Keeping up.** `overdueList` answers "who am I late with" against a cadence,
   and an imported row is not evidence you care.
8. **Relationships and circles.** Directed `relationships` stored both ways;
   circles as sets that hand facts to members, with provenance
   (`source_circle_id`).
9. **Quick facts and a template** that turns completeness into a worklist.
10. **Distilled summaries** with a per-person watermark (`distilled_at`) so a
    rerun reads only what is new.
11. **Health checks.** `people check` counts unscored observations, orphaned
    links, foreign-key violations, and `--fix` repairs only what is garbage.
12. **Conventions.** Soft deletes (`deleted_at`), migrations on every open
    (`ensureColumn`), WAL plus a busy timeout, nothing leaves the machine, and
    `visibility` where absence of a row means "may not leave".

## Side by side

| people store                                      | GTM memory                                                                                                                                                                                                                | Where                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `people` + `identities` (phone, email)            | `contacts` + `contact_keys` (email, LinkedIn slug); `accounts` + `account_keys` (domain)                                                                                                                                  | identity tables carry keys only, no facts |
| never merge on a name; surname vetoes a candidate | email is the primary key; a LinkedIn slug joins a new email to an existing contact only when the surnames agree; a slug that points at a different contact than the email is logged in `identity_conflicts`, never merged | `resolve_contact`                         |
| company overwrite becomes "moved from A to B"     | `employment` rows (contact WORKS_AT account) with `started_at`/`ended_at`; a new account closes the old row instead of editing it                                                                                         | `record_employment`                       |
| `observations` with source, modality, temporal    | `observations` with `source_kind` (clay_column, graph, form_d, website, reply_text, client_verdict, manual), `source_ref`, `provider`, `observed_at`, `cost_credits`, `confidence`, `superseded_by`                       | supersede, never erase                    |
| visibility: absence means no                      | `client_id` on every fact row; `client_contacts` / `client_accounts` decide what a client can see; crossing clients needs `--all-clients`                                                                                 | `Scope`                                   |
| `interactions` + `messages`, broadcast rule       | `interactions`: send (campaign, step, variant), reply (class, who classified), forward, bounce, unsubscribe, meeting, booking signal, Slack mention, client verdict, each with a unique source id                         | a send never warms a contact              |
| six dimensions, half-lives, `scoring_params`      | fit, intent (signals), engagement (replies, meetings; opens never count), temperature (two-way recency), with half-lives in `scoring_params`                                                                              | `score_contact`                           |
| `score_history`, recomputed as-of                 | `score_history` with a `drivers` blob naming the evidence, so `why <account>` answers what moved                                                                                                                          | `why`                                     |
| `tasks`, `next_check_at`                          | `commitments`: reply we owe, approval the client owes, follow-up, refill, with `due_at` and the source that created it; derived ones rebuild each ingest, manual ones persist                                             | `overdue`                                 |
| `overdueList`                                     | `gtm-memory overdue`: open commitments past due, then positive or neutral repliers we have not touched                                                                                                                    | `overdue`                                 |
| `relationships`, circles                          | `employment` (contact to account), campaign membership and the warm-path bridge into people.db                                                                                                                            | `warm`                                    |
| quick facts                                       | current value per attribute = newest non-superseded observation                                                                                                                                                           | `contact`                                 |
| `distill` + watermark                             | `summaries` per account and per client, deterministic, regenerated only when the input hash changes, each with its source ids                                                                                             | `summary`                                 |
| `people check`                                    | `gtm-memory check`: identity conflicts, fact rows missing a client, contacts no client can see, observations without a source                                                                                             | `check`                                   |
| nothing for assets or money                       | `clay_tables`, `clay_columns`, `clay_column_versions` (config hash history, auto-run state, provider) and `credit_ledger` by client, table and column per sync                                                            | `credits --by column`                     |
| nothing for experiments                           | `experiments` and `experiment_arms`: hypothesis, list, copy, sample per arm, outcomes, and the playbook's minimum-sample verdict                                                                                          | `experiments`                             |
| soft deletes, migrations on open, WAL             | same: `deleted_at`, `meta.schema_version` plus ordered migrations, WAL, busy timeout, `ingest_runs` as the origin of every derived row                                                                                    | `open_db`                                 |

## Tenancy

Identity is global and facts are per client. `contacts`, `contact_keys`,
`accounts` and `account_keys` hold only identity keys, so one investor emailed
for Ivy and for Qube is one contact. Every row that says something about that
contact (an observation, a send, a reply, a score, a commitment, a job) carries
`client_id NOT NULL`. A query runs inside a `Scope`: with one client on file it
is that client; with two or more it needs `--client NAME`, or `--all-clients`
to cross deliberately. The warm-path bridge is the only join outside the store,
and it is read only.

## Identity rules

- Email keys use `osgraph.email_key` semantics: trimmed, lowercased, ASCII only.
- LinkedIn keys are the `/in/<slug>` segment, lowercased.
- Account keys are bare domains from an email or a company field. Freemail
  domains (gmail.com and friends) never create an account.
- A name is evidence for a veto, never for a merge. The purchased Prometheus
  file had 43,543 rows (18.5%) whose LinkedIn slug matched no part of the name
  (memory `project_zeutara_gtme`), which is why a slug-only join also has to
  pass the surname check.

## Credits

Clay's credit-usage read reports credits per folder, workbook and table, not
per column. The ledger stores what Clay reports (table level, per sync, with the
window) and stores a column split only when one was measured, for example a
one-row price check (memory `feedback_price_one_run_before_bulk`: a Claygent
loop cost about 21 credits a row and burned about 3,245 of Jonah's credits on
150 rows). `credits --by column` lists each table's spend and the action columns
and providers that could have spent it, and says plainly when the split is not
measured.

## Experiments

Arms are campaigns that share a client, an offer and a wave word ("Midweek").
Verdicts follow `skills/gtm-engineering/references/demand-gen-playbooks.md`:
under 500 sends per arm is "don't know yet", results are read after day 21,
the metric is positive replies over sends with bounces and out-of-office
removed, 20% lift or more adopts, 10 to 20% replicates, under 10% is
inconclusive. A hypothesis is never invented: it shows as `[NEED: hypothesis]`
until someone records it.

## Commitments and their clocks

- Jonah decided on 2026-10-07 that every reply goes to him first, so a positive
  or neutral reply with no verdict is an **approval the client owes**, due 24
  hours after the reply (the reply-handling pack estimates a positive left 24
  hours loses about half its booking chance).
- After a "good fit" verdict, the **reply we owe** is due 30 minutes later (the
  same pack: answer positive replies within 30 minutes).
- An active campaign whose audience is fully sent is a **refill** due now.
- Manual commitments (`gtm-memory owe`) are never touched by an ingest.

## Commands

```
chewbacca gtm-memory ingest [--clay] [--dry-run]     graph (and Clay assets) into memory.db
chewbacca gtm-memory account DOMAIN                 contacts, jobs, scores, timeline, summary
chewbacca gtm-memory contact EMAIL|SLUG             keys, current facts with sources, history
chewbacca gtm-memory timeline [EMAIL|DOMAIN]        sends, replies, verdicts, newest first
chewbacca gtm-memory overdue                        what we owe, what the client owes, who is cooling
chewbacca gtm-memory why DOMAIN                     score history and the evidence that moved it
chewbacca gtm-memory credits --by column|table|client
chewbacca gtm-memory experiments                    arms, samples, verdicts by the playbook floors
chewbacca gtm-memory warm                           contacts Caleb already knows, read only
chewbacca gtm-memory check                          integrity
```

Every command takes `--json`, and `--client NAME` or `--all-clients`.
