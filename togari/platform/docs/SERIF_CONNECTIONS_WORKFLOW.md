# Serif connection research: how the workflow runs

**Question it answers.** Which people at Serif's existing customers used to
work at one of Serif's target accounts? Those people are the start of a warm
introduction.

**What it gives back.** Each person you send from Clay comes back as a list of
possible paths. Each path runs from the customer contact, through a "bridge"
who used to work at a target account, to the person in the buyer seat there
today, with a source for every job. The paths land in a Clay table, and the
full research is kept in BigQuery.

```
Shannon Yarrow      →  Shannon herself, or a colleague  →  Tenet          →  SVP Managed Care at Tenet
customer contact       the bridge, ex-Tenet 2004–2007      target account    the final person
```

This document explains how the workflow runs. To set it up for the first time,
see [SERIF_CONNECTIONS_SETUP.md](SERIF_CONNECTIONS_SETUP.md). The instructions
the AI follows are in
[SERIF_CONNECTION_GUIDE.md](SERIF_CONNECTION_GUIDE.md), published as a Google
Doc.

---

## The whole flow

```
 Clay: table of people at Serif's customers
   │  HTTP API column, one row per person
   ▼
 POST /connections ─────────────► connection_items (BigQuery), state: queued
                                        │
           every 10 min, one person per pass, at most 10 calls a day
                                        ▼
 Togari reads the target sheet ── unreadable? stays queued, nothing spent
                                        │
                                        ▼
 Togari looks the person up in the shared network (togari_core)
   researched in the last 365 days, nothing missing ─► reuse: matched,
       saved and sent to Clay with no Perplexity call
   researched, but colleagues or buyer seats missing ─► top-up: a smaller
       task for only those, merged with the stored histories on return
   not there, or too old ─► full research, below
                                        │
                                        ▼
 Perplexity Computer  (Serif's seat, the replybot's project)
   1. reads the guide (published Google Doc)
   2. reads the target sheet (published CSV, 157 accounts)
   3. confirms the person, finds up to 8 senior colleagues
   4. lists everyone's prior employers, with a domain and a source for each
   5. at each matched target, finds who sits in the buyer seat today
   6. POSTs the result back, using the credential in the project vault
                                        │
                                        ▼
 POST /connections/result
   Togari matches every employer against the sheet itself
   and works out whether the bridge and the buyer overlapped
   saves everything to BigQuery ──────► connection_items, state: done
   POSTs one row per path ────────────► Clay: results table
                                        │
                     Clay column, paths that reach a buyer
                                        ▼
 POST /connections/paths ───────────► connection_paths (BigQuery), pending
                                        │
                    weekdays 9 AM Eastern, strongest first
                                        ▼
 Slack digest in Serif's opportunity channel
   Good path  → draft ask to the champion, in the thread (Edit, Regenerate)
   Not a fit  → recorded, never posted again
```

---

## Stage by stage

### 1. Clay sends a person

An HTTP API column on the table of customer people posts one person to
`POST /connections`.

- **Auth.** It sends the same bearer token Serif's reply intake column
  already uses (`REPLIES_INGEST_TOKEN`).
- **Required fields:**
  - `row_id`;
  - `client_id` (`serif`, or `serif_test` while testing);
  - `person_name`;
  - `person_company`.
- **Optional fields** that help the research:
  - title, company domain, LinkedIn URL, location;
  - `work_history`, whatever enrichment already found, as text or as Clay's
    raw experience array. Perplexity uses it as a starting point, never as a
    source.
- **Repeats are safe.** Togari keys on `row_id`. Sending the same row again
  returns `200` and changes nothing, so Clay's auto-retry can stay on.
- **Refusals** come back as a 400 before anything is saved:
  - a client that doesn't exist;
  - a client with no research set up;
  - a payload missing a required field.

### 2. It waits in the queue

Each person is a row in `togari_data_lake.connection_items`. The row moves
through the same states as a reply in the replybot:

```
queued → dispatching → dispatched → done
                 └──────────┴──────→ failed
```

| State | Meaning |
|---|---|
| `queued` | Waiting for a sweep to pick it up |
| `dispatching` | Togari has claimed it and is calling Perplexity |
| `dispatched` | Perplexity has the task. Togari is waiting for the result. |
| `done` | The result is saved, and sent to Clay if the table is set |
| `failed` | Gave up. Nothing retries it automatically. |

### 3. The sweep sends it to Perplexity

A timer runs every 10 minutes (`CONNECTION_SWEEP_INTERVAL_MINUTES`), and
also once a minute after each deploy. On each pass it:

0. **Reads the target sheet and checks the shared network** (section 3a). A
   person served from the network is finished here, with no call. This runs
   before the account and cap checks, because serving costs nothing.
1. **Checks the account.** If Serif's Perplexity login is broken or out of
   credit, the account is halted and nothing is sent.
2. **Checks the daily cap.** At most 10 research calls a day
   (`PERPLEXITY_CONNECTION_DAILY_CALL_CAP`). This cap is separate from the
   replybot's 200, so research can never use up the day's reply drafting.
3. **Reads the target sheet** and builds the task message. This happens
   *before* claiming the row. If the guide or sheet variable is unset, or the
   sheet can't be read, the person stays `queued`, nothing is spent, and the
   next pass tries again.
4. **Claims the row** (`dispatching`), then calls Perplexity Computer.
5. **Saves the thread id**, then marks the row `dispatched`.

One person is sent per pass (`CONNECTION_DISPATCH_PER_PASS`), whether it is
served from the network or sent to Perplexity. Research runs on
its own timer, separate from reply drafting, so a slow research task never
holds up a reply card.

### 3a. Reuse before research

Every result goes into the shared network (`togari_core.network_*`, migration
0049), for every client. Before paying for research, Togari checks whether the
person is already there (`src/network/reuse.ts`).

**Finding the person.** By LinkedIn URL first, then by name at the same
customer, using the network's own keys (`li:<slug>`, else
`n:<name>@<org id>`). A suppressed person is never used.

**Already researched** means:
- their full history was researched (`history_complete`), not just their seat
  as a buyer;
- research did not come back unable to confirm who they were;
- it was within `NETWORK_REUSE_MAX_AGE_DAYS` (default 365).

Anyone else gets full research, exactly as before.

**Rebuilding the result.** For someone already researched, Togari rebuilds the
answer Perplexity would have posted, from `network_employment`:
- the person's past jobs;
- the past jobs of the colleagues in the latest `network_research_runs` row
  that researched them, if those colleagues are also fresh and still at the
  customer;
- the buyers already found at each matched target account.

That goes through the same matching as a paid result, against this client's
sheet. A reused path is held to exactly the same rules.

**What can still be missing:**

| Gap | When | Top-up asks for |
|---|---|---|
| Colleagues | The stored colleagues were found for a client with different colleague roles, or none were ever searched for | People in this client's roles who aren't already known. The known names are listed so they're skipped. |
| Buyer seats | A matched target account no research run in the window searched (`buyer_org_ids`) | Buyers at those accounts only. Accounts already covered are listed so they're skipped. |

**Three outcomes**, recorded in `connection_items.research_mode`:

| `research_mode` | What happened | Cost |
|---|---|---|
| `reuse` | Nothing missing. Matched, saved, sent to Clay in the sweep. | No call |
| `topup` | A smaller task for only the gaps. The guide's section 9 says how. | One smaller call |
| `full` | Researched from scratch | One full call |
| null | Researched before reuse existed | |

**A top-up's result** comes back to the same `POST /connections/result`.
Togari merges it with the stored histories it started from (saved in
`reused_result_json`) before matching, so the paths cover both.
`result_json` keeps only what Perplexity posted.

**What goes back into the network.**
- A reused row adds nothing. Re-recording it would restart the freshness
  clock on facts nobody re-checked.
- A top-up is recorded without marking the person as researched again. Its
  run keeps the colleagues already known as well as the new ones.

**Logs.** Look for `connections.research.reused` (with `callsSaved: 1`),
`connections.research.topup` and `connections.research.full` (with a
`reason`). Count the calls saved in BigQuery with:

```sql
SELECT research_mode, COUNT(*) FROM `togari_data_lake.connection_items`
 WHERE research_mode IS NOT NULL GROUP BY 1;
```

**Any failure reading the network means full research.** Reuse saves money.
It must never be the reason a person isn't researched.

**Until migration 0050 is applied,** reuse stays off and everyone is
researched in full. Togari checks for the two columns before it uses them.

### 4. Perplexity does the research

The message points Perplexity at two published links and gives it one person.
The method lives in the guide, which you can edit without a deploy. In order,
Perplexity:

1. **Reads the guide.** The guide defines:
   - which roles count;
   - what counts as a match;
   - the rules on sources.
2. **Reads the target sheet.** The message tells it how many accounts the
   sheet has, so a partial read shows up later as `list_read_ok: false`.
3. **Confirms the person.** A job counts only if a source ties it to this
   person, on their current employer plus their title or location.
4. **Finds up to 8 senior colleagues** at the same company today. The roles
   that count:
   - the C-suite;
   - VP, SVP or Director of Managed Care, Payer Relations/Contracting/Strategy,
     Revenue Cycle, Strategy, or Corporate Development.
5. **Lists every prior employer since 2005** for each person, whether or not it
   is on the list. Each job carries:
   - the company, as the source names it;
   - the title;
   - the years;
   - a source URL. A job with no source is left out.
   - **Always** the company's website domain. If the source doesn't state it,
     Perplexity looks it up, because it's a fact about the company, not the
     person. This is what lets Togari confirm "Tenet Healthcare" is the sheet's
     "Tenet". Without it, the match is only `model_only`.
6. **Flags matches.** For each employer on the sheet, Perplexity names the
   sheet's Account value and says why it matched: domain, name, or
   acquisition.
7. **Finds the buyer at each matched target.** For up to 5 matched target
   accounts, the most recent departures first, Perplexity finds up to 3
   people who work there **now** in Serif's buyer roles:
   - Managed Care / Payer Relations / Payer Contracting / Payer Strategy, at
     Director level or above;
   - CFO, CEO or Chief Strategy Officer;
   - Revenue Cycle.

   For each it gives:
   - a source placing them there today;
   - the year they **joined the organization**, if a source states it.

   The guide says what to look for at PE funds and provider-tech companies.
   This is part of the same task, not a second call.
8. **POSTs the result** to `/connections/result`. It authenticates with the
   credential already saved in the project vault for
   `togari-bma-prod.up.railway.app`, the same one the replybot uses. The token
   is never written into the message.

**Role lists.** The colleague and buyer role lists are in the task message as
well as the guide. If the published guide loads only in part, which happened
on the first test run, it can't change who gets researched. The message takes
them from the client's `connections.colleagueRoles` and
`connections.buyerRoles` in `src/agents/replybot/client-config.ts`, so a
second client can have its own. Reuse compares colleague roles between
clients: colleagues found for different roles are topped up.

**Two rules don't bend.**
- Perplexity never states or implies that two people know each other. Working
  at the same place is all a public source can show.
- It never contacts anyone.

### 5. Togari checks and saves the result

`POST /connections/result` accepts the replybot's result token
(`REPLY_RESULT_TOKEN`).

**Parsing is forgiving.** A paid result shouldn't be thrown away over
formatting:
- years like `"2019-03"` or `"present"` are read as a year or null;
- true/false arrives as text or as a boolean;
- `people` arrives as an array or as a JSON string.

**Togari matches every employer against the sheet itself.** Perplexity's
match is kept, but only as a hint. Each connection gets a `match` label:

| `match` | How it was found | Trust |
|---|---|---|
| `domain` | The employer's domain equals a sheet row's domain | Strongest |
| `name` | Exact name, ignoring case, punctuation, Inc/LLC and a bracketed abbreviation like "(HSS)" | Strong |
| `parent_domain` | The domain matches a sheet row that points inside a bigger company, e.g. TriZetto at `cognizant.com/...` | Check it |
| `model_only` | Togari couldn't confirm it, but Perplexity named a real sheet row, e.g. an acquisition or an abbreviation | Verify before anyone asks a customer |

**Dropped on purpose:**
- a job with no source URL;
- a match on the company the person works at *today*. That's the customer, not
  a former employer.
- a "target" Perplexity named that isn't on the sheet;
- a bare abbreviation. "UHS" is two different health systems.

**Togari places each buyer on the sheet** the same way, domain first, then
exact name. It drops a buyer with no source, or at an organization that isn't
on the sheet.

**Togari works out the overlap itself** from the reported years. It never asks
the model "did they overlap?", because a model says "likely" and "likely" is
how an AE ends up asking about a relationship that never existed. The buyer
still works at the target, so their time there runs from `joined_year` to now.

| `tenure_overlap` | Means |
|---|---|
| `yes` | The bridge and the buyer were both there for at least one full year (`overlap_years` says how many, when the bridge's start year is known) |
| `possible` | The buyer joined the year the bridge left |
| `no` | The buyer joined after the bridge had gone |
| `unknown` | A year is missing. Never upgraded to a guess. |

Overlap means they were at the same organization at the same time, not that
they met. The strongest paths have a recent bridge and `tenure_overlap: yes`.

**Saved once.** Togari marks the row `done` before sending anything to Clay.
So if Perplexity posts the same result twice, Clay gets the rows only once.

**Stored in BigQuery.** The row keeps everything:

| Column | Holds |
|---|---|
| `result_json` | Perplexity's whole answer, every employer, matched or not. For a `reuse` row, the rebuilt answer. |
| `research_mode` | `reuse`, `topup` or `full` (section 3a, migration 0050) |
| `reused_result_json` | For `reuse` and `topup`: the stored histories the row started from |
| `connections_json` | The connections Togari kept, each with the buyers found at its target |
| `connections_found` | How many connections were kept |
| `identity_confirmed` | Whether Perplexity confirmed the person |
| `target_rows_read`, `target_rows_expected` | How much of the sheet Perplexity read, against how many rows it has |
| `clay_posted` | How many rows Clay accepted |

The full history is kept for a reason. A former employer that matches nothing
today becomes a match when Serif adds accounts, and re-matching stored
histories is free where re-researching them is not.

### 6. Clay gets the connections

Togari POSTs to the results table's webhook (`SERIF_CONNECTIONS_CLAY_URL`).
**Each row is one path**, read end to end: customer contact → bridge →
target account → buyer.

| Case | Rows |
|---|---|
| A connection with buyers found at its target | One row per buyer: who, the title, LinkedIn, the source, `joined_year`, `tenure_overlap` |
| A connection with no buyer found | One row with the `target_contact_*` columns empty. The bridge is still real. |
| No connections at all | One row with `connections_found: 0`, so "no paths" looks different from "not run yet" |

Every row also carries:
- `connections_found`, the number of bridges into the list;
- `paths_found`, how many of those reach a named buyer.

Every row carries `client_id`, so `serif_test` rows are easy to filter out.

If Clay rejects a row, Togari logs `connections.clay.rejected`. The result is
still safe in BigQuery, and `clay_posted` shows how many rows got through.

### 7. Slack gets a daily digest

An HTTP API column on the results table posts each path back to Togari
(`POST /connections/paths`). The column's run condition keeps it to paths
worth a person's time:
- the path reaches a named buyer;
- Togari matched it itself: `domain`, `name` or `parent_domain`, never
  `model_only`.

Togari checks both conditions again and stores the path in `connection_paths`,
keyed on champion + bridge + target + buyer. The same path never posts twice,
however many times the person is researched.

**When it posts.** Weekdays from 9 AM in Serif's timezone (Eastern), the
digest posts every path waiting to Serif's opportunity channel
(`C0BAL9JV0E5`, `serif_test` to #test-channel).
- Weekend paths roll into Monday.
- A day with nothing new posts nothing.
- BigQuery records that the day's digest went out, so a restart can't post
  it twice.
- Past Slack's 50-block limit, whole targets carry on in the digest's
  thread. Only a target too big for one message is split, marked
  "(continued)".

**Order, strongest first:**
1. Overlap: `yes`, then `possible`, then `unknown`, then `no`.
2. Then the most recent bridge departure.
3. Then the buyer closest to payer contracting.
4. Then the surest match.

**Grouped by target account.** Each target block opens with its name as a
large bold Slack header. Under it come the segment, "N routes to M people",
and one **Ask** line per customer contact whose routes lead there: name,
title, company and **email**. The email comes from intake's `person_email`, else a `row_id`
that is an email, else "no email on file".

**Each route starts with the person to ask:**
- `Shannon Yarrow → Justin Oppenheimer (COO) → Alison Solach, Director …`
  when a colleague is the bridge;
- `Shannon Yarrow → Pat Rivera, SVP Managed Care` when Shannon worked at the
  target herself.

**Buyer first, routes underneath.** Each buyer gets a bold line: name,
title, the year they joined, and their LinkedIn. The routes to that buyer
follow, each with its own buttons. The line under each route has the
bridge's years at the target, the overlap, the match, and links to the
bridge and the job's source.

**The buttons.** Anyone in the channel can press them, and the first click
wins. The buttons are then replaced by "Good path · @name, 10:14 AM" or
"Not a fit · @name".

**Good path** posts a draft in the thread: a note to the champion asking for
the introduction, headed with their email so it's ready to copy.
- **Champion is the bridge:** it asks them to introduce us to the buyer,
  mentioning their own time at the target.
- **Colleague is the bridge:** it asks the champion to connect us with that
  colleague, mentions the colleague's time at the target, and names the
  buyer.
- **Rules:** written by Claude from the path's facts only. It asks rather
  than asserts, never implies anyone knows anyone, and makes no product or
  rate claims. 50–80 words, no links, no em dashes, no signature.
- **Edit and Regenerate.** **Edit** opens a box to change the text, and
  saving updates the reply in the thread. **Regenerate** drafts it again.
- **Nothing is sent from Slack.** Someone copies the draft into email or
  LinkedIn.

**Not a fit** is recorded, and that path never comes back.

Verdicts, who made them, and the final draft text are all kept in
`connection_paths`.

---

## When things go wrong

These come from the replybot's loop, so research gets the same protections.
Alerts go to `PERPLEXITY_ALERT_SLACK_CHANNEL`.

| What happens | What Togari does |
|---|---|
| A result hasn't come back after 15 min | Asks Perplexity to send it. Up to 3 times. |
| Still nothing after 60 min | Marks the row `failed` and alerts |
| A row is stuck on `dispatching` | Alerts, and **never** retries automatically: Perplexity may already be doing paid work Togari has no id for |
| Perplexity returns no thread id | Marks the row `failed` and alerts, with the SQL to re-queue it |
| The account is out of credit, or its login broke | Halts the account, puts the row back on the queue, and alerts |
| The daily cap is hit | Stops for the day and alerts. New people keep queueing. |
| The sheet can't be read when the result comes back | Saves the raw result, sends nothing to Clay, and sets `connections_found` to null |

**Out of credit means reply drafting stops too.** Credits are per seat, and
research and replies share Serif's seat. A halt stops both.

The chase and give-up timings follow the replybot's settings
(`REPLY_SWEEP_STALE_MINUTES`, `REPLY_SWEEP_MAX_ATTEMPTS`,
`REPLY_SWEEP_GIVE_UP_MINUTES`). Changing them changes both loops.

---

## Shared with the replybot, and separate from it

| | Shared | Separate |
|---|---|---|
| Perplexity | Seat, project, sign-in, credits | |
| Vault credential | Yes, the same Togari token for the same host | |
| Clay intake token | `REPLIES_INGEST_TOKEN` | |
| Dispatch and chase logic | Same code (`src/perplexity/`) | |
| Queue table | | `connection_items` vs `reply_items` |
| Timer and overlap guard | | `CONNECTION_SWEEP_*` |
| Daily call cap | | 10 vs 200 |
| Output | | A Clay table, not a Slack card |

---

## Changing it

| To change | Do this | Deploy? |
|---|---|---|
| The target accounts | Edit the published sheet. Togari re-reads it at most every 30 minutes. | No |
| The method, match rules, or what to look for at PE funds and provider tech | Edit the guide Google Doc. Perplexity reads it fresh on every task. | No |
| The core colleague and buyer role lists | They're in the guide **and** the client's `connections.colleagueRoles` / `buyerRoles` in `src/agents/replybot/client-config.ts`. Change both. | Yes |
| How old a stored history may be and still be reused | `NETWORK_REUSE_MAX_AGE_DAYS` (default 365). `0` turns reuse off. | Restart only |
| Pace or budget | `CONNECTION_SWEEP_INTERVAL_MINUTES`, `CONNECTION_DISPATCH_PER_PASS`, `PERPLEXITY_CONNECTION_DAILY_CALL_CAP` in Railway | Restart only |
| Stop it | `CONNECTION_SWEEP_ENABLED=false`. Queued people wait; nothing is lost. | Restart only |
| Digest time | `CONNECTION_DIGEST_HOUR` (default 9, the client's local time). It may post up to 3 hours after. | Restart only |
| Stop the digest | `CONNECTION_DIGEST_ENABLED=false`. Paths keep queueing for when it's back. | Restart only |
| Which rows reach Slack | The run condition on the Clay column; Togari also refuses `model_only` and paths with no buyer | No |
| Digest channel | `channelOverrides.connections` on the client in `src/agents/replybot/client-config.ts` | Yes |
| The draft's rules and wording | `src/connections/drafts.ts` | Yes |
| Colleagues per person (8) | `MAX_COLLEAGUES` in `src/connections/task-message.ts` | Yes |
| Target accounts searched for buyers (5), and buyers per account (3) | `MAX_TARGETS_WITH_CONTACTS`, `MAX_CONTACTS_PER_TARGET`, same file | Yes |
| How Togari matches | `src/connections/targets.ts` | Yes |

**Re-running a person.** Clay can't re-run a person by itself, because a repeat
`row_id` is ignored by design. Either send them with a new `row_id`, or put the
row back on the queue in BigQuery:

```sql
UPDATE `midyear-glazing-485303-u3.togari_data_lake.connection_items`
   SET state = 'queued', attempts = 0, pplx_thread_id = NULL, pplx_account = NULL
 WHERE row_id = '<row_id>';
```

A re-run that finds connections posts them to Clay again, so expect duplicate
rows there. A re-queued person is checked against the network like anyone
else, so a re-run within the window is served from what's stored. To force
fresh research, set `NETWORK_REUSE_MAX_AGE_DAYS=0` while it runs.

---

## Where everything lives

| Piece | Location |
|---|---|
| Guide the AI reads | Google Doc, from `docs/SERIF_CONNECTION_GUIDE.md`. URL in `SERIF_CONNECTION_GUIDE_URL`. |
| Target accounts | Published Google Sheet (CSV). URL in `SERIF_TARGET_ACCOUNTS_URL`. |
| Results table | Clay webhook table. URL in `SERIF_CONNECTIONS_CLAY_URL`. |
| Queue and full results | BigQuery `togari_data_lake.connection_items` |
| Paths, verdicts and drafts | BigQuery `togari_data_lake.connection_paths` |
| Shared network, every client | BigQuery `togari_core.network_people`, `network_organizations`, `network_employment`, `network_research_runs`, and the view `network_coworker_overlaps` (migration 0049). Written automatically on every result by `src/network/`. Past results: `scripts/backfill-network.ts`. |
| Call counts | BigQuery `togari_data_lake.perplexity_calls`, `kind` is `connection_dispatch` or `connection_chase` |
| Status | `GET /admin/status`, under `connectionLoop` |
| Intake, callback and paths | `src/routes/connections.ts` |
| Slack digest and buttons | `src/connections/digest.ts`, `slack-actions.ts`, `drafts.ts` |
| Research code | `src/connections/`: message, matching, results, store, finish |
| Reuse before research | `src/network/reuse.ts`, called from `src/connections/queue.ts` |
| Shared loop | `src/perplexity/dispatch.ts`, `sweeper.ts`, `queue.ts` |
| Setup and troubleshooting | [SERIF_CONNECTIONS_SETUP.md](SERIF_CONNECTIONS_SETUP.md) |
