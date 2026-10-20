# Adding a client to the campaign calendar

The playbook for giving a client the campaign calendar: a page showing a month
of their campaigns as bars, with each week's numbers underneath. Those
numbers are people emailed, emails sent, reply rate, interested rate, out of
office, passes, opt-outs, bounces, and who is still waiting on an answer.

```
Clay campaigns → Campaign events table → HTTP column → POST /campaign-events
  → campaign_events (BigQuery) → /dash/<token>/calendar
Slack reply card → Send / Skip / Done → reply_card_actions ─┤
HeyReach (LinkedIn) → read when the page is built ──────────┘
```

**Reference implementation: Serif** (`serif` in
`src/agents/replybot/client-config.ts`). Code: `src/campaigns/`,
`src/routes/campaign-events.ts`, `src/routes/campaign-calendar.ts`.

---

## 0. One-time setup (done for Serif on 2026-10-14)

Skip this section if `/campaign-events` already answers 401 without a token.

1. **Create the tables.** Migrations 0044 to 0047: three new tables and one
   added column, applied to `togari_data_lake` on 2026-10-14.
   ```bash
   for f in sql/migrations/004{4,5,6,7}_*.sql; do bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < "$f"; done
   ```
2. **Set `CAMPAIGN_EVENTS_TOKEN`** on the Togari service (Railway,
   `togari-bma-prod`). Use a long random value (`openssl rand -hex 32`). The
   variable accepts a comma-separated list, so to rotate it: add the new value,
   switch the Clay columns over, then remove the old one. If it isn't set, the
   endpoint refuses every request with a 500.

## 1. Before you start

The client needs:

- **An entry in the replybot registry** (`getReplybotClient`). The calendar
  takes its name, its timezone (`voice.timezone`, which decides where each
  week starts and ends) and its Slack cards from there. A client not on the
  replybot needs a registry entry first: `docs/REPLYBOT_NEW_CLIENT.md`.
- **Campaigns in Clay's sequencer**, with their events going to a Campaign
  events table that logs every send, reply and bounce.

Then find out:

| Question | Why it matters |
|---|---|
| Does the client have its own Clay workspace, or share one with other clients? | If shared, their campaign names need a prefix (e.g. `Zeutara \|`), and events from other campaigns are dropped. |
| Who gets the link? | The link works for anyone who has it. Give it only to the people the client names. |
| Are there planned start and end dates? | Clay doesn't hand them over. To show them, type them into the Clay column (§4). |

## 2. Code: one line, one PR

In the client's entry in `src/agents/replybot/client-config.ts`:

```ts
// Own Clay workspace: every campaign in it is theirs.
campaignCalendar: { theme: "acme" },

// Shared workspace: only campaigns named with this prefix count.
campaignCalendar: { campaignPrefix: "Acme |", theme: "acme" },
```

Leave out `theme` for the neutral default.

That turns on three things (plus the client's look, below):
- `/campaign-events` accepts the client's rows.
- `/dash/<token>/calendar` opens for them.
- Their reply cards get a **Skip, no reply** button next to Send. Without it, a
  reply nobody means to answer would show as waiting forever.

A test client derived by spread (`serif_test`) inherits this. Its rows carry
its own `client_id`, so they land on a separate calendar.

### The client's look

The page wears the client's brand: fonts and colors from a theme in
`src/campaigns/themes.ts`. To add one, copy the `serif` entry and take the values
from the client's own website. Open it, inspect the headings, buttons and
section backgrounds, and note the fonts, the dark ink, the main brand color
and any pale tints.

- Fonts must be on Google Fonts. `fonts` is the css2 query
  (`family=Sora:wght@400;500;600&family=Inter:wght@400;500;600`).
- `accent` is the brand color. It marks the selected week, links and the
  Interested bar.
- `campaigns` is eight colors in a fixed order. Put the brand color first and
  keep the rest of the default order: it was chosen so neighbouring colors stay
  apart for colorblind readers. Never put two similar hues next to each other.
  Serif's blue and violet look alike to some readers, which is why the violet
  sits seventh.
- `npx vitest run src/campaigns/__tests__/themes.test.ts` fails if any text is
  too faint to read on its background, or any campaign color too pale for the
  calendar.

## 3. The link

The calendar uses the same `DASHBOARD_TOKENS` map as the outbound dashboard: a
JSON object of `token -> client id`.

1. Make a token: `openssl rand -hex 20` (32 to 64 hex characters).
2. Add it to `DASHBOARD_TOKENS` on the service, e.g.
   `{"<existing>":"zeutara","<new token>":"acme"}`.
3. The link is `https://togari-bma-prod.up.railway.app/dash/<token>/calendar`.
   For a client with no Clay sign-in saved (no `live` in its entry),
   `/dash/<token>` redirects to the calendar too.

To revoke a link, delete its token from the map. To replace it, add a new one
before deleting the old one.

## 4. Clay: one HTTP column on the Campaign events table

Clay's sequencer can send every campaign's events to one **Campaign events**
table in the workspace: a row per send, reply, bounce, open and click, with a
Campaign ID on each. Serif's is
[here](https://app.clay.com/workspaces/1056653/workbooks/wb_0tj93g3849cU9SM8b3Y/tables/t_0tj93g3Xbj9BsvVVdhn/views/gv_0tj93g4g3farV47jcXS).
One HTTP column on that table covers every campaign, so make sure each
campaign's events go to it. A client whose campaigns each keep their own
Events table needs this column on each one, with the same body.

**First, pull five fields out of the event.** Click any cell in the first
column (the one reading "Received …"). In Cell details on the right, press
**Add to column** on each of these:

| In Cell details | Name the column |
|---|---|
| Campaign > Name | `Campaign name` |
| Event > Occurred At | `Occurred at` |
| Lead > Name | `Lead name` |
| Sent > Sequence Number | `Step` |
| Reply > Text | `Reply text` |
| Campaign > Status | `Campaign status` |

The table already has `Campaign ID`, `Event type`, `Lead ID`,
`Lead email address` and `Reply category`.

**Then add an HTTP API column:**

- **Method:** `POST`
- **URL:** `https://togari-bma-prod.up.railway.app/campaign-events`
- **Headers:** `Authorization: Bearer <CAMPAIGN_EVENTS_TOKEN>` and
  `Content-Type: application/json`
- **Body** (each `{{…}}` is a column, inserted with Clay's `/` picker):

```json
{
  "event_id": "{{Event type}}-{{Campaign ID}}-{{Lead ID}}-{{Occurred at}}",
  "client_id": "serif",
  "event_type": "{{Event type}}",
  "campaign_id": "{{Campaign ID}}",
  "campaign_name": "{{Campaign name}}",
  "lead_email": "{{Lead email address}}",
  "lead_name": "{{Lead name}}",
  "step": "{{Step}}",
  "occurred_at": "{{Occurred at}}",
  "reply_text": "{{Reply text}}",
  "reply_category": "{{Reply category}}",
  "campaign_status": "{{Campaign status}}"
}
```

- **Run settings:** auto-run on new rows. Run it once on rows already there to
  fill in history. Clay's placeholder rows (alex@example.com, "Example
  campaign") answer `sample_row` and are never stored.

| Field | Required | Notes |
|---|---|---|
| `event_id` | yes | The table has no event id, so it's built from type, campaign, lead and time, which together are unique. Clay's retries of the same row are counted once. |
| `client_id` | yes | Typed as text, never mapped. A wrong id is refused rather than filed under another client. |
| `event_type` | yes | `EMAIL_SENT`, `EMAIL_REPLY` and `EMAIL_BOUNCE` count. `CAMPAIGN_STATUS_CHANGED` is kept for the status only. Opens and clicks answer 200 and are skipped. |
| `campaign_status` | recommended | Clay's own status (`ACTIVE`, `PAUSED` and so on). The page shows Sending, Paused or Finished from it, and only falls back to guessing from send dates without it. |
| `campaign_id`, `campaign_name` | strongly | The id groups the bars. The name is what people see, and it's what a prefix check reads. |
| `lead_email` | strongly | People emailed, people who replied, and waiting-on-an-answer all count by person. |
| `occurred_at` | strongly | When it happened. Without it, the time Togari received it is used, so a backfill would land every event on the same day. |
| `reply_text` | for replies | Sorts the reply (out of office, interested, pass and so on), using the same rules as the reply cards. Read once, never stored. |
| `reply_category` | optional | Clay's own label ("Interested", "Out Of Office") or id. Used when there's no text, or the text can't be sorted. |
| `planned_start`, `planned_end` | optional | Typed as text, `YYYY-MM-DD`. Draws a campaign's planned span as a dashed bar. On a shared table these apply to whichever campaign the row is for, so only add them to a per-campaign table. Easier: add a conference on the page (below). |
| `step`, `lead_name` | optional | `step` is the sequence step. `lead_name` shows on the waiting list in place of the email. |

**Check it:** sends and replies answer `{"stored":true}`; opens answer
`{"stored":false,"reason":"not_counted"}`. `unknown_client_id` or
`no_campaign_calendar` means step 2 isn't deployed or `client_id` is mistyped.
`401` means the Authorization header doesn't match `CAMPAIGN_EVENTS_TOKEN`.

## 4a. Or: read the client's Clay Sequencer directly (no column)

A client whose campaigns run on Clay's **Sequencer** (Serif's do) has no
Events table with real rows, so step 4's column has nothing to send. On
2026-10-16 campaign_events held no rows for anyone. Togari reads the
Sequencer itself instead (`src/campaigns/clay-sync.ts`, every 10 minutes):

1. In `client-config.ts`, give the client a `clay` block:
   `clay: { workspaceId: "<id from the Clay URL>", syncCalendar: true, sessionAlert: true }`.
   Add `pollReplies: true` and a `pollSince` of today to also get reply cards
   from the inbox (cards only; nothing auto-sends without `autopilot`).
2. Save a signed-in Clay session for the client, from a machine with `.env`:
   `npx tsx scripts/save-clay-session.ts <clientId>` and paste the
   `claysession` cookie from app.clay.com when asked.
3. Deploy. The first sync reaches back 180 days; replies fill in 40 per run.

Sends and bounces come from Clay's per-day counts, not per person, so a person
sent two steps in one week counts twice in "people emailed". #test-channel is
warned before the session lapses (about weekly); re-run step 2 then.

## 4b. LinkedIn from HeyReach (optional)

For a client whose LinkedIn outreach runs in HeyReach. Nothing to set up per
campaign: Togari reads every campaign in their HeyReach account when the page
is built.

1. **Get an API key.** In the client's HeyReach: Settings > Integrations >
   HeyReach API. Ask the client to create it. Don't sign in with a login
   someone pasted in Slack.
2. **Store it** on the Togari service as `<CLIENT>_HEYREACH_API_KEY`
   (Serif: `SERIF_HEYREACH_API_KEY`).
3. **Name it in the config:**
   ```ts
   campaignCalendar: { theme: "acme", heyreach: { apiKeyEnv: "ACME_HEYREACH_API_KEY" } },
   ```
4. **Check the key** against a live response (it reads `.env`):
   ```bash
   npx tsx scripts/check-heyreach.ts ACME_HEYREACH_API_KEY
   ```
   It prints each response's fields and what the calendar read. The field
   names were checked against Serif's account on 2026-10-14. If the script
   shows 0 requests or replies where HeyReach's dashboard shows numbers,
   HeyReach has renamed a field: fix it in
   `src/integrations/heyreach/client.ts`.

Then the page gets an All / Email / LinkedIn switch. Each channel's campaigns
get their own row, and LinkedIn bars are marked `in`. Under the calendar, the
LinkedIn numbers are HeyReach's own: connection requests, accepts, people
messaged and replies.

If the key is missing, the page says LinkedIn isn't connected yet. If HeyReach
is down, it says LinkedIn couldn't load. Email is shown either way.

## 4c. Conferences (on the page, no setup)

The page has a **Conferences** section under the calendar. **Add a conference**
takes a name and the days its outreach should start and end. Anyone with the
link can add or remove one; it shows straight away.

- Every campaign named after the conference gets its dates as a dashed span:
  the same name, or that name with more after it. "AVBCC" covers "AVBCC
  Sequence 1" and "AVBCC sequence 2"; "HFMA Region 2" doesn't cover "HFMA
  Region 26". Punctuation and capitals don't matter.
- A conference with no campaign of its name yet gets its own dashed bar, in a
  Conferences row above the calendar, so it's on the calendar before the
  campaign is built. Once a campaign with that name sends, the bar becomes
  that campaign's.
- Removing one hides it; the row stays in `calendar_plans` with `removed_at`
  set, so clearing that brings it back.

## 5. Check the page

Open the link. Within five minutes of the backfill you should see:

- A bar per campaign, solid on the days it sent, dashed where it was only
  planned.
- Sends per day in the corner of each day (hidden on phone-width screens).
- The current week's numbers under the calendar.
- Click another week, and a campaign's name above the calendar.

## What the numbers mean

The same text is printed at the foot of the page.

- **Reply rate** is people who replied that week divided by people emailed that
  week. Out-of-office and other automatic replies are left out, so it reads
  lower than Clay's dashboard, which counts them.
- **Interested** covers interest, questions, deck requests and forms.
  **Needs a read** is a reply the rules couldn't sort.
- **Needs a reply** is anyone whose latest reply in the last 90 days is
  Interested or Needs a read, and whose Slack card hasn't been sent, skipped
  or marked done since. An answer sent from Clay or a mailbox directly doesn't
  clear it; press Skip, no reply on the card.
- **Follow-ups due** only appears for clients on reply autopilot.
- **LinkedIn reply rate** is replies divided by people messaged, matching
  HeyReach's own. People are only messaged once they accept, so the
  acceptance rate sits next to it.
- **LinkedIn needs a reply** is a conversation where the lead wrote last and
  their message is interest or couldn't be sorted. It clears when anyone
  answers in HeyReach or LinkedIn.
- **LinkedIn days** are HeyReach's, which run on UTC.
- **LinkedIn week rates** count accepts and replies on the day they happen,
  so a week can include people sent a request the week before. A quiet week
  after a busy one can show a high rate. HeyReach's 30-day figure is steadier.
- **Campaign status** (Sending, Paused, Finished, Stopped, Planned) is Clay's or
  HeyReach's own. An email campaign without `campaign_status` in its events is
  read from its dates: Sending if it sent in the last three days.
- **LinkedIn interest** uses the text rules first, then HeyReach's own
  "Interested" / "Not interested" tag for replies the rules can't call.

## Limits worth knowing

- Clay has no API that returns a campaign's daily numbers or its planned dates
  (checked 2026-10-14). That's why this runs on a column on the events table,
  and why planned dates are typed into a column.
- A campaign whose events don't reach the Campaign events table has no bar and
  no numbers. Run the column on existing rows to fill history in.
- Weeks are Monday to Sunday in the client's timezone. The page keeps the
  current month rebuilt every four minutes; other months build when opened and
  are kept for five.
