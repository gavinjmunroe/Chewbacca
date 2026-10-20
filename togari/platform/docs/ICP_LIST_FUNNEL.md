# Website ICP List Funnel

The self-serve demo behind bluemodernadvisory.com's **"Generate my ICP
list"** CTA. A short one-question-per-screen wizard captures who the visitor
wants to reach; Clay sources and verifies matching accounts and the right
contacts inside them.

**The list is emailed as a CSV.** Submitting sends nothing; when Clay
finishes, the requester gets one email from maggie@ (signed Blue Modern
Advisory) with **at most 10 people, each with a verified work email shown
masked (`d***@domain.com`) and a LinkedIn link**, in the body and attached as
`icp-list.csv` (Maggie is BCC'd). Unmasked emails live only in Togari.
#bma-website-fills gets one Slack alert per request: submitted and sent, or
submitted and not sent (with why), including requests stuck past the timeout. Those people are also kept in
Togari as leads tagged `website-icp-sourced`, insert-only and with no
outreach attached. If Clay finds no one with a verified email, errors, or
never calls back, nothing automated goes to the requester: Slack asks us to
reach out personally from maggie@. A list that arrives late is still sent.

**One list per email, ever.** Any earlier request from the same address
(ignoring case and +tags) gets a 409 `already_requested` before anything is
recorded or a Clay credit is spent.

The contact form feeds the same lead store (no Clay involvement).

> History: this replaced a "never email the list, walk it through on a
> call" design (October 2026).

```
[bma-website wizard: industry → company → ICP brief → roles → contact]
  → POST /api/icp-list                    (bma-website Express proxy)
  → POST /api/v1/website/icp-request      (Togari, Bearer WEBSITE_INGEST_API_KEY)
      once-per-email check (409) → work-email + affiliation scoring →
      DNC (record only) → job INSERT → lead MERGE → Clay push →
      (Slack alert to reach out personally if the push failed)
  → Clay table sources accounts, finds people, enriches work emails (async)
  → POST /webhooks/clay/icp-callback      (Togari, Bearer ICP_CALLBACK_KEY)
      idempotent claim → store all rows → email ≤10 people as CSV →
      keep them as tagged leads → internal Slack ping
  → sweeper marks silent jobs stalled after ICP_STALL_ALERT_MINUTES (Slack
    heads-up; a late callback still sends the list), then times them out
    after ICP_JOB_GIVEUP_MINUTES with a second alert to reach out personally
```

Key code: `src/icp/` (types, service, lead-record, list, email, clay-push),
`src/routes/website/`, `src/routes/ingest/icp-callback.ts`, sweeper in
`src/server.ts`. Tables: `togari_core.icp_list_jobs`,
`togari_core.website_contact_messages` (bootstrap:
`npx tsx src/scripts/bootstrap-icp.ts`, which runs `sql/icp_create_tables.sql`).

**Out of scope by design:** no outreach or sequencing is ever triggered from
these leads or the people found for them. The list email to the
requester is the only automated send. Website leads
deliberately bypass the `clay-lead.ts` Rytual fan-out.

## What the wizard collects

| Step | Question                          | Field                                                                                                                                    |
| ---- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | What industry are you in?         | `industry` (the market they sell _from_)                                                                                                 |
| 2    | Tell us about your company        | `company`, `company_domain`, optional `company_description`                                                                              |
| 3    | Who is your ideal customer?       | `icp_description` free text + optional `company_size`                                                                                    |
| 4    | Which roles do you need to reach? | `target_titles[]` (optional; an **Other** chip reveals a free-text field, which is merged into the array — "Other" itself is never sent) |
| 5    | Who should we build it for?       | `full_name`, `email`                                                                                                                     |

Lead scoring (`scoreIcpLead`) rewards a real name, a **work** email (checked
against Clay's personal-domain list), an email domain that actually
**matches the company they named** (via `calculateAffiliation` — now possible
because step 2 collects their domain), a specific brief, and named target
roles. A thin brief from a gmail address scores far below a detailed one from
a matching company domain.

## Env vars

### togari-platform (Railway)

| Var                            | Default                         | Purpose                                                                                                                                         |
| ------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ICP_PIPELINE_ENABLED`         | unset (off)                     | Master switch: intake route + sweeper                                                                                                           |
| `ICP_AUTOSEND_ENABLED`         | unset (off)                     | Kill switch for the list email. Deploy off; flip on after smoke test                                                                            |
| `WEBSITE_INGEST_API_KEY`       | —                               | Bearer auth for `/api/v1/website/*` (share with bma-website)                                                                                    |
| `ICP_CALLBACK_KEY`             | —                               | Bearer auth Clay sends to the callback                                                                                                          |
| `CLAY_ICP_WEBHOOK_URL`         | —                               | Clay webhook-in URL. Read at call time — rotate via env only                                                                                    |
| `ICP_CALLBACK_URL`             | prod callback URL               | Passthrough traceability field sent to Clay                                                                                                     |
| `ICP_EMAIL_SENDER`             | `maggie@bluemodernadvisory.com` | Delegated Gmail sender. **Requires domain-wide delegation for maggie@ in Google Admin Console first**, else every send fails with 403           |
| `ICP_EMAIL_SENDER_NAME`        | `Blue Modern Advisory`          | From display name                                                                                                                               |
| `ICP_LIST_BCC`                 | `maggie@bluemodernadvisory.com` | Copy of every list email. Set to an empty string to turn off                                                                                    |
| `ICP_STALL_ALERT_MINUTES`      | 20                              | Slack heads-up when Clay hasn't called back yet; the job stays open and a late list is still sent                                               |
| `ICP_JOB_GIVEUP_MINUTES`       | 120                             | Second Slack alert (reach out personally) when Clay still hasn't called back; a later list is still sent. Always at least the stall window + 10 |
| `ICP_SWEEP_INTERVAL_MINUTES`   | 2                               | Sweeper cadence                                                                                                                                 |
| `ICP_DAILY_CAP`                | 100                             | Global jobs/day (≈ >1yr of Clay's 50k webhook cap)                                                                                              |
| `ICP_PER_EMAIL_DAILY_CAP`      | 3                               | Per-requester jobs/day (moot now that each email gets one list ever; kept as a backstop)                                                        |
| `WEBSITE_RATE_LIMIT_PER_MIN`   | 60                              | Backstop limiter (sees only the proxy's IP → global ceiling)                                                                                    |
| `SLACK_WEBSITE_NOTIFY_WEBHOOK` | unset                           | Slack alert on contact messages, every list sent, and every request that needs a personal follow-up. Strongly recommended                       |

### bma-website (Railway)

| Var                               | Value                                    |
| --------------------------------- | ---------------------------------------- |
| `TOGARI_API_BASE`                 | `https://togari-bma-prod.up.railway.app` |
| `TOGARI_WEBSITE_KEY`              | same secret as `WEBSITE_INGEST_API_KEY`  |
| `WEBSITE_FORM_RATE_LIMIT_PER_MIN` | 5 (per real client IP)                   |

## Clay workflow (built October 2026)

The sourcing runs as the Clay **Workflow** "Website ICP List Builder"
(Workflows, Beta) in the Blue Modern Advisory workspace, not a table.
Webhook trigger URL (put it in `CLAY_ICP_WEBHOOK_URL`):
the workflow's own trigger URL (a secret, so it's not written here)

| #   | Step                                 | Notes                                                                                                                                        |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Turn ICP into search filters         | AI agent (GPT 5.4 Nano). Brief → industries, headcount range, locations, keywords; expands the form's role categories into real job titles   |
| 2   | Research up to 15 matching companies | AI agent with **web search on** (GPT 6 Sol; Nano has no tools, so it could only guess). Clay's company search can't take per-request filters |
| 3   | Prepare company list                 | Code: dedupe domains, rank by fit, cap 15                                                                                                    |
| 4   | Find up to 2 people per company      | Find contacts at company, Limit 2, title keywords from step 1; a failed company is skipped                                                   |
| 5   | Rank people                          | Code: ≤2 per company, ranked by fit then title match, **capped at 16** to bound email credits                                                |
| 6   | Work Email                           | Workspace waterfall (Findymail → Hunter → Prospeo → Clay), per person; a miss is skipped                                                     |
| 7   | Collect top 10                       | Code: valid, distinct emails only; builds `{job_id, row_id, clay_status, rows}`                                                              |
| 8   | POST to callback                     | Fixed Togari URL, 30s timeout, 3 retries. **Authorization header (`Bearer <ICP_CALLBACK_KEY>`) is filled in by hand**                        |

The AI steps run on the workspace's `sagar-gpt` OpenAI account. Rough cost
per request: about 1 + 2 credits for the AI steps, 0.5 per company searched
(up to 15) and about 1.1 per email found (up to 16), plus OpenAI tokens.

## Clay table setup checklist (original design, superseded by the workflow above)

1. Create table **"BMA Website ICP Lists"**.
2. Add a **Webhook source** → copy its URL into Togari's
   `CLAY_ICP_WEBHOOK_URL`. If the plan supports webhook auth tokens, set one
   and put the same value in `CLAY_API_KEY` (the outbound client already
   sends it as `Authorization: Bearer`).
   ⚠️ Webhook sources cap at **50,000 lifetime submissions and never
   reset** — to rotate, add a fresh webhook source and swap the env var. No
   deploy needed.
3. **Passthrough columns** (never transformed): `job_id`, `row_id`,
   `callback_url`, plus the brief fields `requester_email`, `requester_name`,
   `requester_company`, `requester_domain`, `requester_description`,
   `requester_industry`, `icp_description`, `company_size`,
   `target_titles` (comma-separated).
4. **Sourcing step.** Turn the free-text brief into search criteria: an
   AI/Claude formula column that reads `icp_description` + `company_size` +
   `requester_industry` and emits structured filters (industry, headcount
   band, geography, keywords), then a company-search integration that returns
   matching accounts. Cap the result set at about 15 accounts: enough that
   10 verified people usually survive, few enough to keep credits down.
5. **Contact step.** For each account, find people matching `target_titles`
   (fall back to seniority when the field is empty), then run the workspace
   **Work Email** waterfall to enrich and verify their work email.
   Conditional-run every column so nothing fires on an empty account row:
   this is where credits get burned.
6. **Status formula column** `clay_status`: `found` when at least one
   person with a verified email came back, `not_found` when the search
   completed empty, `error` when it errored.
7. **Rows column.** Aggregate the people into a JSON array under the key
   `rows`, best matches first, each entry using: `contact_name`,
   `contact_title`, **`contact_email`** (required: rows without it never
   reach the requester), `contact_linkedin`, `company_name`,
   `company_domain`, `employee_count`, `location`, `signal`. Togari keeps
   every row on the job, but emails only the first 10 with a valid, distinct
   `contact_email`. The callback accepts either a real JSON array or a JSON
   string, so a formula column that emits text is fine.
8. **HTTP API column** (the callback):
   - POST to **hardcoded**
     `https://togari-bma-prod.up.railway.app/webhooks/clay/icp-callback`
     (don't trust the `callback_url` cell at send time; it's passthrough
     traceability only).
   - Header `Authorization: Bearer <ICP_CALLBACK_KEY>`.
   - Body: `job_id`, `row_id`, `clay_status`, `rows`.
   - **Conditional run: only after the sourcing and contact columns have
     finished**, so partial lists never call back early.
9. Push one manual test row; confirm the Togari logs show a 200.
10. **Never** attach outreach/sequencing integrations to this table.

## Deploy + smoke sequence

1. **togari**: run `npx tsx src/scripts/bootstrap-icp.ts` (creates tables;
   needs GCP creds). Deploy with `ICP_PIPELINE_ENABLED=false`.
2. **bma-website**: deploy with `TOGARI_API_BASE` + `TOGARI_WEBSITE_KEY`.
   Contact form works immediately; the wizard 503s until step 4.
3. **Clay UI**: checklist above → produces `CLAY_ICP_WEBHOOK_URL`.
4. Set all togari env vars, `ICP_PIPELINE_ENABLED=true`
   (`ICP_AUTOSEND_ENABLED` still false). Smoke test:

```bash
curl -sS -X POST https://www.bluemodernadvisory.com/api/icp-list \
  -H 'Content-Type: application/json' \
  -d '{"full_name":"Test User","email":"you@bluemodernadvisory.com","company":"BMA","company_domain":"bluemodernadvisory.com","company_description":"AI-native data engineering","industry":"Healthcare","icp_description":"multi-site dental groups in the Midwest","company_size":"51–200","target_titles":["Founder / CEO"]}'
# → 202 {"job_id":"...","status":"pending"}; check icp_list_jobs + contact row (source_tag)
```

```bash
curl -sS -X POST https://togari-bma-prod.up.railway.app/webhooks/clay/icp-callback \
  -H "Authorization: Bearer $ICP_CALLBACK_KEY" -H 'Content-Type: application/json' \
  -d '{"job_id":"JOB_ID","row_id":"JOB_ID","clay_status":"found","rows":[{"company_name":"Northside Dental Group","company_domain":"northsidedental.com","employee_count":180,"contact_name":"Dana Reyes","contact_title":"VP Revenue Operations","contact_email":"dana@northsidedental.com"}]}'
# → 200 {"status":"done"} and the CSV email goes out; re-run → {"status":"already_processed"}
```

5. Set up domain-wide delegation for maggie@ in Google Admin (the service
   account behind `GCP_CREDENTIALS_BASE64` needs the `gmail.send` and
   `gmail.compose` scopes for maggie@), then flip `ICP_AUTOSEND_ENABLED=true`.
   Run one intake with a real internal email: nothing arrives at submit,
   then the list email from maggie@ with `icp-list.csv` attached (≤10 rows,
   every row with a work email) and Maggie BCC'd. Submit the same email
   again and confirm the website shows "already requested" with no second
   email. Re-run the callback curl above with `contact_email` in the rows to
   check the CSV without spending Clay credits.
