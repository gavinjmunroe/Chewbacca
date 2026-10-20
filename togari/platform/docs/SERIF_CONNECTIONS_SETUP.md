# Serif: warm-intro connection research

Who at Serif's existing customers used to work at one of Serif's target
accounts? This is the replybot's loop pointed at a different question. It
runs on the same Perplexity seat, in the same project, with the same vault
credential.

```
Clay row: one person at a Serif customer
  → POST /connections                         (queued in connection_items)
  → Perplexity Computer, Serif's seat + project
      reads the guide (Google Doc) and the target sheet (published CSV)
      researches the person + up to 8 senior colleagues,
      and the buyer seat at each matched target
  → POST /connections/result                  (vault credential)
  → Togari re-matches every employer against the sheet itself
  → BigQuery (every employer, kept)  +  Clay table (one row per connection)
  → Clay column: POST /connections/paths      (paths that reach a buyer)
  → daily Slack digest, weekdays 9 AM Eastern, in C0BAL9JV0E5
```

## What's reused, and what's new

**Reused:**
- **Perplexity seat and project.** `perplexityAccount: "serif"` and
  `PERPLEXITY_PROJECT_UUID_SERIF`. The sign-in is the same one.
- **Vault credential.** The vault already holds the Togari credential for
  `togari-bma-prod.up.railway.app`, which is `REPLY_RESULT_TOKEN`.
  `/connections/result` accepts that same token, so the vault needs nothing
  new.
- **Intake token.** The intake accepts `REPLIES_INGEST_TOKEN`, so use the
  bearer value Serif's reply intake column already sends.
- **Machinery.** Dispatch, chase-ups, give-up, the stuck-mid-dispatch alert,
  and the halt on a broken login or no credit all come from the reply loop.

**New:**
- **Table.** `connection_items`.
- **Guide.** A published guide, `docs/SERIF_CONNECTION_GUIDE.md`.
- **Clay tables.** An intake column and a results table.
- **Timer.** `CONNECTION_SWEEP_ENABLED`.
- **Cap.** A daily call cap of its own: `PERPLEXITY_CONNECTION_DAILY_CALL_CAP`,
  default 10.

## Before you start: cost

**Credits are shared with reply drafting.** One research task covers up to
nine people, so it costs several times what a reply does. If the seat runs out
of credit, Togari halts the whole account. That stops reply drafting too, not
just research.

The defaults are deliberately slow:
- one person per pass;
- a pass every 10 minutes;
- at most 10 research calls a day.

Pilot with the people from five customers. Check the credit drain in
Perplexity before raising any of those numbers.

## 1. BigQuery

```bash
bq query --use_legacy_sql=false --project_id=midyear-glazing-485303-u3 < sql/migrations/0037_connection_items.sql
```

## 2. The guide

1. Paste `docs/SERIF_CONNECTION_GUIDE.md` into a Google Doc.
2. Use **File → Share → Publish to web** and copy the `/pub` URL.
3. Open that URL in a private window.
   - It must not ask for a login.
   - It must reach **section 8**. The first published copy stopped partway
     through section 3, and Perplexity worked without the match rules.
4. The URL goes in `SERIF_CONNECTION_GUIDE_URL`.

## 3. The target sheet

The sheet must be published as **CSV**. The URL you already have is
(`…/pub?output=csv`). It goes in `SERIF_TARGET_ACCOUNTS_URL`.

Togari reads the sheet as well as Perplexity:
- **At dispatch:** if Togari can't read it, the person stays queued and
  nothing is spent.
- **At the result:** every employer Perplexity reported is matched against the
  sheet, by domain first and then by exact name.

The task also tells Perplexity how many accounts the sheet has. A short read
shows up as `list_read_ok: false`.

**Fix these in the sheet before the first run.** They produce wrong matches,
not just missing ones:

- **Waystar's** domain is `finthrive.com`, and **Doctivity's** is
  `waystar.com`. It looks like a copy-paste shift. As it stands, anyone
  ex-Waystar would be matched to Doctivity.
- **University Hospitals, Charlie Health and Surgery Partners** are existing
  customers and also on the list. Togari already skips the customer a person
  works at today. But someone at another customer who used to work at Surgery
  Partners would still show up as a path *into* Surgery Partners. Remove them
  from the sheet, or get Serif's ruling first.
- A few rows point inside a bigger organization:
  - TriZetto, at `cognizant.com/...`;
  - Brown & Toland, at `altais.com/...`;
  - UM Upper Chesapeake, at `umms.org/uch`.

  Togari reports domain matches on those as `parent_domain`, so they're
  visible rather than wrong. Expect ex-Cognizant people to show up under
  TriZetto.

## 4. Clay: the results table

1. Create a table whose source is a **webhook**.
2. Copy its URL into `SERIF_CONNECTIONS_CLAY_URL`. It's a secret, so it
   lives in Railway only.

Each research result arrives as **one row per path**: customer contact →
bridge → target account → buyer.
- A connection whose buyer couldn't be found arrives as one row with the
  `target_contact_*` columns empty.
- A person with no connections arrives as a single row with
  `connections_found: 0`, so "found nothing" looks different from "not run
  yet".

If your results table was created before buyers were added, check the new
columns below show up after the next result. If they don't, add them from the
webhook's fields.

| Field | |
|---|---|
| `client_id` | `serif` or `serif_test`. Filter test rows out with this. |
| `person_row_id`, `person_name`, `person_title`, `person_company` | The person you sent |
| `connections_found` | Bridges into the list for this person, 0 to many |
| `paths_found` | How many of those reach a named buyer |
| `bridge_name`, `bridge_title`, `bridge_relation` | Who used to work at the target. `self` is the person you sent; `colleague` is someone found at their company. |
| `bridge_linkedin`, `bridge_source_url` | Where the bridge was found at the customer |
| `former_employer`, `former_title`, `start_year`, `end_year` | The old job, as the source states it |
| `role_source_url` | The page that shows the old job |
| `target_account`, `target_segment`, `target_type`, `target_domain` | The sheet row it matched |
| `match` | See below |
| `target_contact_name`, `target_contact_title`, `target_contact_persona` | The person in the buyer seat at the target today: where the path ends |
| `target_contact_linkedin`, `target_contact_source_url`, `target_contact_joined_year` | Their profile, the page placing them there now, and the year they joined |
| `target_contacts_found` | Buyers found at this target |
| `tenure_overlap`, `overlap_years` | Whether the bridge and the buyer were at the target at the same time (`yes`, `possible`, `no`, `unknown`), worked out by Togari from the years |
| `model_match_basis` | What Perplexity said, as a hint |
| `identity_confirmed`, `target_rows_read`, `target_rows_expected`, `list_read_ok` | Quality checks |
| `notes` | Perplexity's one line on what limited the research |

The `match` column tells you how much to trust each row:

| `match` | Means |
|---|---|
| `domain` | Togari matched the employer's domain to the sheet. Strongest. |
| `name` | Togari matched the exact name, ignoring punctuation and Inc/LLC |
| `parent_domain` | Domain matched a sheet row that points inside a bigger company |
| `model_only` | Only Perplexity called it a match, e.g. an acquisition. Check it before anyone asks a customer about it. |

**Nothing here says two people know each other**, and the guide forbids the
AI from saying so. A row is evidence that they worked at the same place. The
last hop, whether the customer will make the intro, stays human.

## 5. Clay: the intake column

This is an HTTP API column on the table of customer people, one row per
person.

```
POST https://togari-bma-prod.up.railway.app/connections
```

| Header | Value |
|---|---|
| `Authorization` | `Bearer <the token Serif's reply intake column already uses>` |
| `Content-Type` | `application/json` |

Body. `/Column` marks a Clay column token:

```json
{
  "row_id":                "/Clay Row ID",
  "client_id":             "serif_test",
  "person_name":           "/Full Name",
  "person_title":          "/Title",
  "person_company":        "/Company",
  "person_company_domain": "/Company Domain",
  "person_linkedin":       "/LinkedIn URL",
  "person_location":       "/Location",
  "person_email":          "/Email",
  "work_history":          "/Experience"
}
```

- **Required:** `row_id`, `client_id`, `person_name` and `person_company`.
  The rest make the research better.
- **`person_email`** is how the Slack digest says to reach this person: each
  target block opens with "Ask Shannon Yarrow · shannon@…". Without it, the
  digest uses `row_id` if that's an email, and otherwise shows "no email on
  file".
- **`work_history`** takes whatever enrichment already found, as text or as
  Clay's raw experience array. It's a starting point for Perplexity, not a
  source.
- **Condition:** run only when Full Name and Company aren't empty.
- **Auto-retry:** on. A repeat of the same `row_id` returns 200 and changes
  nothing.
- **Going live:** switch `client_id` to `serif` once the test row looks
  right.

## 6. Railway (`togari-bma-prod`)

| Variable | Value |
|---|---|
| `SERIF_CONNECTION_GUIDE_URL` | The guide's `/pub` URL |
| `SERIF_TARGET_ACCOUNTS_URL` | The sheet's `/pub?output=csv` URL |
| `SERIF_CONNECTIONS_CLAY_URL` | The results table's webhook URL |
| `CONNECTION_SWEEP_ENABLED` | `true` |
| `CONNECTION_SWEEP_INTERVAL_MINUTES` | optional, default `10` |
| `CONNECTION_DISPATCH_PER_PASS` | optional, default `1` |
| `PERPLEXITY_CONNECTION_DAILY_CALL_CAP` | optional, default `10` |

For the Slack digest (section 8):

| Variable | Value |
|---|---|
| `CONNECTION_DIGEST_ENABLED` | `true` |
| `CONNECTION_DIGEST_HOUR` | optional, default `9` (the client's local time) |

Check `GET /admin/status`. Under `connectionLoop`, these should all be true:
- `enabled`;
- `serifGuideUrlSet`;
- `serifTargetsUrlSet`;
- `serifClayUrlSet`.

## 7. Test

1. Send one person with `client_id: "serif_test"`, either from the Clay
   column or with curl:

   ```bash
   curl -sS https://togari-bma-prod.up.railway.app/connections \
     -H "Authorization: Bearer $REPLIES_INGEST_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"row_id":"conn-test-1","client_id":"serif_test","person_name":"Shannon Yarrow","person_title":"","person_company":"Surgery Partners","person_company_domain":"surgerypartners.com"}'
   ```

   Expect `201` and `"state":"queued"`.
2. Within one interval, the row moves to `dispatching`, then `dispatched`.
   The Perplexity thread appears in Serif's project.
3. When Perplexity posts back, the row is `done` and rows land in the Clay
   table.
4. Check the Clay rows by hand: open each `role_source_url` and confirm the
   job is real. Do this for the first five people before trusting the output.

```sql
SELECT row_id, client_id, state, attempts, person_name, person_company,
       connections_found, target_rows_read, target_rows_expected, clay_posted, updated_at
FROM `midyear-glazing-485303-u3.togari_data_lake.connection_items`
WHERE client_id LIKE 'serif%' ORDER BY updated_at DESC LIMIT 20;
```

| State | Means |
|---|---|
| no row | The Clay column didn't fire, or got a 4xx: token, `client_id`, or a missing name or company. |
| `queued` | Check these in order: the sweep is off; the guide or sheet variable is unset or unreadable; the account is halted; the daily cap was reached. The `perplexity.dispatch.message_unavailable` log names the cause. |
| `dispatched` | Perplexity hasn't posted back yet. It gets chased at 15 min and given up at 60. |
| `done`, `connections_found` null | The sheet couldn't be read when the result came back. The full answer is in `result_json`. |
| `done`, `clay_posted` < rows | Clay rejected some rows. See the `connections.clay.rejected` logs. |
| `failed` | It gave up. To retry, re-queue it with the `UPDATE` in the alert. |

## 8. Slack digest

Once a weekday, Togari posts every new route that reaches a named buyer to
Serif's opportunity channel (`C0BAL9JV0E5`).
- **Grouped by target account**, the strongest target first.
- **Each target's name** is a large bold heading, followed by who to ask and
  their email.
- **Each buyer comes next**, in bold, with the routes to them underneath.
- **Each route starts with the person to ask:** champion → colleague → buyer,
  or champion → buyer when the champion worked at the target themself.

It looks like this:

```
Warm-intro paths · Mon, Oct 12
15 new routes into 3 target accounts, from 1 customer contact, strongest first.
─────────────
HOSPITAL FOR SPECIAL SURGERY (HSS)          ← large, bold
Health Systems · 3 routes to 3 people
Ask Shannon Yarrow (SVP Managed Care, Surgery Partners) · shannon@surgerypartners.com

Michelle Salyer · SVP, Chief Payer Strategy and Contracting Officer
Joined HSS 2021 · LinkedIn
  Shannon Yarrow → Justin Oppenheimer (COO) → Michelle Salyer
  Justin at HSS 2023–2026 · overlap 3 yrs · matched by domain · Justin
  [ Good path ]  [ Not a fit ]
...
─────────────
TENET
Health Systems · 9 routes to 3 people
Ask Shannon Yarrow (SVP Managed Care, Surgery Partners) · shannon@surgerypartners.com

Sapna Grover · VP, Strategic Networks and Contracting
Joined Tenet 2005 · LinkedIn
  Shannon Yarrow → Eric Evans (CEO) → Sapna Grover
  Eric at Tenet 2016–2018 · overlap 2 yrs · matched by domain · role source
  [ Good path ]  [ Not a fit ]
  Shannon Yarrow → Sapna Grover
  Shannon at Tenet 2004–2007 · overlap 2 yrs · matched by domain · role source
  [ Good path ]  [ Not a fit ]
```

Buttons are per route, since each route is its own ask.

- **Good path** records the verdict and posts a draft ask to the champion in
  the digest's thread, with **Edit** and **Regenerate**. The draft is never
  sent; copy it into email or LinkedIn.
- **Not a fit** records the verdict. That path never posts again, even if the
  person is researched again.
- Anyone in the channel can press either button. The first click wins.

### a. BigQuery

```bash
bq query --use_legacy_sql=false --project_id=midyear-glazing-485303-u3 < sql/migrations/0041_connection_paths.sql
```

### b. Slack

Togari should already be in `C0BAL9JV0E5`, because Serif's form-fill cards
post there. If the first digest fails with `not_in_channel` in the
`connections.digest.failed` logs, run `/invite @Togari` in the channel; the
paths are put back and post at the next window. `serif_test` paths go to
#test-channel.

### c. Clay: an HTTP API column on the results table

```
POST https://togari-bma-prod.up.railway.app/connections/paths
```

| Header | Value |
|---|---|
| `Authorization` | `Bearer <the same token as the intake column>` |
| `Content-Type` | `application/json` |

- **Run condition:** `target_contact_name` isn't empty **and** `match` is
  `domain`, `name` or `parent_domain`. Togari checks again and answers
  `200 "skipped"` for anything else, so a slip costs nothing.
- **Auto-retry:** on. A path Togari already has answers `200` and changes
  nothing.

Body. Each value is the row's own column of the same name:

```json
{
  "client_id":                  "/client_id",
  "person_row_id":              "/person_row_id",
  "person_name":                "/person_name",
  "person_title":               "/person_title",
  "person_company":             "/person_company",
  "person_email":               "/person_email",
  "bridge_name":                "/bridge_name",
  "bridge_title":               "/bridge_title",
  "bridge_relation":            "/bridge_relation",
  "bridge_linkedin":            "/bridge_linkedin",
  "former_employer":            "/former_employer",
  "former_title":               "/former_title",
  "start_year":                 "/start_year",
  "end_year":                   "/end_year",
  "role_source_url":            "/role_source_url",
  "target_account":             "/target_account",
  "target_segment":             "/target_segment",
  "match":                      "/match",
  "target_contact_name":        "/target_contact_name",
  "target_contact_title":       "/target_contact_title",
  "target_contact_persona":     "/target_contact_persona",
  "target_contact_linkedin":    "/target_contact_linkedin",
  "target_contact_source_url":  "/target_contact_source_url",
  "target_contact_joined_year": "/target_contact_joined_year",
  "tenure_overlap":             "/tenure_overlap",
  "overlap_years":              "/overlap_years"
}
```

**Escaping.** Clay pastes a value in without escaping it. If a title contains
a `"`, the body stops being valid JSON and Clay shows "Failed to parse body
input". If that happens, swap that field for a formula column
`JSON.stringify({{field}})` and insert it **without** the surrounding quotes.

### d. Railway

Set `CONNECTION_DIGEST_ENABLED=true` (section 6).

### e. Test

1. Run the Clay column on one row with `client_id: serif_test`. Expect
   `201` and `"state":"pending"`.
2. Post it now instead of waiting for the next weekday morning:

   ```bash
   npx tsx scripts/post-connection-digest.ts --client=serif_test
   ```

   It posts to #test-channel. Otherwise it posts in the next weekday window,
   9 AM to noon Eastern.
3. Press **Good path**. Within a few seconds the draft appears in the
   thread. Try **Edit** and **Regenerate**.

```sql
SELECT client_id, champion_name, bridge_name, target_account, buyer_name,
       posted_at, verdict, verdict_by, LEFT(draft, 60) AS draft_head
FROM `midyear-glazing-485303-u3.togari_data_lake.connection_paths`
WHERE client_id LIKE 'serif%' ORDER BY created_at DESC LIMIT 20;
```

| What you see | Means |
|---|---|
| no row | The Clay column didn't fire or got a 4xx. Check the token, `client_id`, and that the row has a buyer. |
| row, `posted_at` empty | Waiting for the next digest. If a weekday morning has passed, check `connectionDigest.enabled` on `/admin/status`, and the `connections.digest.failed` logs. |
| no draft after Good path | The draft failed. The thread says so; press **Regenerate**. The `connections.draft.failed` logs say why. |
