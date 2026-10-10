# Vendor recipes for GTM integrations

Synced from togari-platform 0b7d51d and togari-sandbox adace00.

How each vendor actually behaves, including the parts their docs leave out.
Every rule here came from a production failure or a measured run. Names of
environment variables are given so a builder can wire them; no values are.

## Perplexity Computer over MCP

Perplexity Computer runs a long agent task (research, drafting) and can call
back into your server with the result. You reach it as a remote MCP server.

**Endpoints.** All public, discovered with two unauthenticated GETs:
`https://www.perplexity.ai/.well-known/oauth-protected-resource/rest/computer/mcp`
and the same path with `oauth-authorization-server`. Note that `.well-known`
sits right after the domain, with the rest of the path after it.

| Value                       | URL or setting                                |
| --------------------------- | --------------------------------------------- |
| MCP resource                | `https://www.perplexity.ai/rest/computer/mcp` |
| Authorize                   | resource + `/authorize`                       |
| Token                       | resource + `/token`                           |
| Dynamic client registration | resource + `/register`                        |
| Scope                       | `asi:query`, the only one offered             |
| PKCE                        | S256 only                                     |
| Token auth methods          | client_secret_post or client_secret_basic     |
| Bearer placement            | `Authorization` header only                   |

### Signing in

- Register the client yourself through `/register`; nobody creates an app by
  hand. Register with both `authorization_code` and `refresh_token` grant types,
  or omit `grant_types`. Sending only `authorization_code` gets a 400.
- Send `resource=https://www.perplexity.ai/rest/computer/mcp` on both the
  authorize and the token request, even though discovery doesn't mention it.
- **The redirect must be loopback**: `http://localhost:<port>/callback` or
  `127.0.0.1`. A hosted https callback is rejected at authorize time
  ("Redirect URI does not match allowed patterns"); registration accepts
  anything, so the failure only shows at authorize. Sign-in therefore runs as a
  local script with a browser logged in as the paying seat, and the tokens go to
  a shared encrypted store the server reads. Default port 8765.
- `offline_access` is rejected as an invalid scope, and a real exchange has
  come back with no refresh token. Without one the token can't be renewed: in
  practice it lasted 30 days, so put a calendar reminder on re-sign-in.
- When a refresh token exists, renew once less than 20% of the lifetime
  remains. Don't wait for a 401.
- A broken login halts that account: stop dispatching against it rather than
  burning queued rows.

### Calling a task

- Use the MCP SDK's streamable HTTP client (protocol 2025-11-25). It keeps the
  `mcp-session-id` from initialize on every later message and holds the stream
  open. A send-and-forget client gets its connection dropped.
- Headers: `authorization: Bearer <token>`,
  `accept: application/json, text/event-stream`.
- Tool name `call_perplexity_computer`, arguments: `message`, `thread_id`
  (null for new, set to continue a thread), `attachment_urls` (null),
  `project_uuid`, `project_visibility: "private"`.
- **Double JSON parse.** The result's `content[0].text` is a string that
  contains JSON. Reading it as an object gives undefined for every field and
  looks like an empty answer. Parse it a second time to get `thread_id`,
  `event`, `text`, `task_state`, `pending_input`. Treat `isError: true` as a
  failure.
- **Timeout 15 minutes.** The call blocks for the whole task and returns
  `event: "complete"` with the answer. A measured run took 12 minutes, and a
  120 second timeout abandoned it while Perplexity kept working and billing.
  Set reset-on-progress, and cap total time at twice the timeout.
- **project_uuid matters.** A callback credential saved in a project vault is
  invisible to a session started with no project. Pass the project's UUID per
  account. Null only works if the credential lives in the user vault with
  "Always allow".
- Never put the callback token in the message text.
- Bill per client: each client's tasks run on that client's Perplexity
  account, resolved per client id, and never fall back to a shared default. A
  typo should mean "never signed in", not "bill someone else".

**Never retry paid dispatch.** Save state in this order, as separate writes:

1. Move the row from `queued` to `dispatching` before Perplexity is contacted.
2. Make the call, which blocks until the task finishes or times out.
3. Save `thread_id` and account the moment the call returns.
4. Mark the row `dispatched` in a separate write after that.

A row left on `dispatching` means paid work may have started that you have no
handle for. It must never be retried automatically; alert and let a person
decide. Merging these writes makes that state invisible.

**Sweeper numbers** (a timer that chases work that never came back):

| Setting                                     | Default                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tick interval for replies                   | 5 minutes                                                                          |
| Tick interval for research tasks            | 10 minutes                                                                         |
| Chase a row sent but silent for             | 15 minutes                                                                         |
| Chase attempts                              | 3                                                                                  |
| Give up on any row older than               | 60 minutes                                                                         |
| Alert on a row stuck on `dispatching` after | the larger of 15 minutes and call timeout + 2 minutes (17 at defaults)             |
| Rows dispatched per pass                    | 5, never more than 25                                                              |
| Dispatch budget per pass                    | equal to the call timeout; checked before each row, so the first row always starts |
| Daily call cap per account, replies         | 200                                                                                |
| Daily call cap per account, research        | 10 (each task researches several people)                                           |

- Dispatch is sequential and one call can run 15 minutes, so a pass can outlast
  its tick. Drop the tick rather than run two passes at once.
- Give replies and research separate timers, locks and daily caps, so a
  research backfill can't use up the day's reply allowance.
- The stuck alert must sit above the call timeout. An alert inside that window
  fires on healthy slow tasks, and people learn to ignore it.
- Cost seen in practice: about 50 Perplexity credits per drafted reply.

**When a result never shows up:** no row means the intake never fired; stuck on
`queued` means the sweeper is off, the account is halted or the cap is hit;
`dispatched` with no result means the callback credential or project UUID is
wrong.

## ZoomInfo enterprise API

Auth is a PKI JWT exchange:

1. Hold three per-tenant values: username, client id, RSA private key
   (`ZOOMINFO_USERNAME`, `ZOOMINFO_CLIENT_ID`, `ZOOMINFO_PRIVATE_KEY`).
2. Mint a client JWT signed RS256. Header `{typ: JWT, alg: RS256}`. Payload:
   `aud: "enterprise_api"`, an `iss` of your choosing, `username`,
   `client_id`, `iat` set 60 s in the past, `exp` about 4 minutes ahead (a
   5 minute life minus 60 s skew).
3. POST it as `Authorization: Bearer <client JWT>` to
   `https://api.zoominfo.com/authenticate`. The response body's `jwt` is the
   session token, good for about 60 minutes. Read `exp` from its payload; fall
   back to 50 minutes if absent.
4. Cache per tenant and refresh 60 s before expiry. Share one in-flight auth
   request among concurrent callers: the auth endpoint allows about 1 request
   per second per credential.
5. On 429 from auth, wait 2 s then 4 s, two retries.
6. On 401 from a data call, evict the cached token, mint a new one, retry once.

- Private keys pasted into env vars often carry literal `\n`. Replace them with
  real newlines before signing.

**Endpoints** (legacy enterprise v1, POST JSON, base `https://api.zoominfo.com`;
the newer `/data/v1` API needs a separate seat):

| Path              | Use                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `/search/company` | Find a company id by name, optionally website. Page size up to 25, default 5             |
| `/enrich/company` | Firmographics. Ask for explicit output fields                                            |
| `/search/contact` | People at a company. Free, returns summaries with no PII. Page size up to 25, default 10 |
| `/enrich/contact` | Full person profile. This spends credits                                                 |

- Search free, then enrich only the people you'll actually contact.
- Company enrich fields worth requesting: id, name, website, revenueRange,
  employeeRange, city, state, country, phone, street, zipCode, primaryIndustry,
  type, numberOfContactsInZoomInfo, foundedYear.
- Contact enrich fields: id, firstName, lastName, jobTitle, companyName,
  companyId, companyWebsite, contactAccuracyScore, email, phone, mobilePhone,
  externalUrls, street, city, state, zipCode, country.
- **Rate limit about 1 request per second.** On 429, wait 5 s, up to 2 retries.
- Name mismatches return zero results; retry with the company-name variants in
  [scoring.md](scoring.md) section 6.

## Exa

- Base `https://api.exa.ai`, header `x-api-key`. Operations: `/search`,
  `/findSimilar`, `/contents`, `/answer`. `numResults` defaults to 10, cap 100.
- **People search gotcha:** to get LinkedIn profile pages, send
  `category: "linkedin profile"` plus `include_domains: ["linkedin.com"]`.
  The domain filter alone also returns posts, job listings and company pages.
- Over-request when you'll filter afterwards: four times the count you need,
  at least 25, at most 100.
- Pace at 100 requests a minute, 200 ms apart.
- Use Exa for content- or intent-based discovery (what a company publishes or
  engages with), and to save Clay credits.

## Clay webhooks

**Pushing rows into a Clay table** ("Send webhook to a table" source):

- One JSON object per POST. Each POST appends one row.
- Cap a push at 500 rows; trim the rest and report the truncation.
- At most 5 concurrent POSTs, so a big push never floods one table.
- A bearer token is optional; most table webhooks are unauthenticated.
- **Webhook URLs are secrets.** Anyone with the URL can write rows. Keep them in
  env vars, never in docs, tickets or commits.
- Report pushed, failed and truncated counts rather than throwing on a partial
  failure.

**Receiving from Clay:**

- Clay signs with HMAC-SHA256 over the raw request body using a shared secret.
  Header `X-Clay-Signature`, value `sha256=<hex>`. Accept a bare hex value too.
  Reject non-hex values as malformed.
- Compute over the **raw bytes**, not re-serialised JSON, and compare in
  constant time after checking the lengths match.
- A Clay connector your columns call should always answer 200 with flat JSON,
  so one bad row can't break the whole column.
- Clay retries. Make the receiver idempotent on Clay's row id.
- A round trip (push rows, let Clay enrich, Clay calls back) is slow: poll
  every 5 s for up to 3 minutes before treating it as a timeout.

**Replying through Clay:**

- The "reply to lead in a campaign" action is keyed on **lead_id plus
  campaign_id** and sends from the same mailbox that sent the original, so the
  reply threads. Missing either id means the send must refuse; there is no
  fallback.
- The send table's payload: lead_id, campaign_id, email, subject, body,
  in_reply_to, client_id.
- **Form fills need their own table.** A website form fill has no campaign to
  reply into, so first-touch outreach to it needs a separate webhook table.
- Start every new intake column with a test client id, smoke-test it, then
  switch to the live id and re-run on replies that arrived in between.

## Smartlead

- Message history: `GET https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/leads/{lead_id}/message-history?api_key=...`
  returns every message with type SENT or REPLY. Sort by time; the first SENT
  is your original, the last REPLY is the latest inbound.
- **The API key rides in the query string**, so any logged URL leaks it.
  Redact URLs before logging and never log request lines raw.
- Abort after 10 s. On any error return nulls so the rest of the pipeline
  carries on.
- Webhooks are signed HMAC-SHA256 over the raw body in `X-Smartlead-Signature`.
- For senders that can set a header but can't compute an HMAC (a Clay HTTP API
  column), a static shared key in a custom header is the fallback.

## BigQuery

- **Rows in the streaming buffer can't be UPDATEd or DELETEd.** If a row will
  be updated soon after insert (a subscription a payment webhook will flip),
  insert it with a DML INSERT so it lands in standard storage right away.
- **No unique constraints.** Uniqueness is a property of your write path. Route
  every write to a table through one MERGE keyed on the natural id. A raw INSERT
  anywhere else duplicates rows on the first retry from Clay.
- A resent row should return 200 with `duplicate: true`, never an error that
  triggers another retry.
- Use the source system's row id as the dedup key for passthrough ingest.
- Keep schema changes as numbered, idempotent DDL files.

## Slack

- **Signature checks need the raw body.** Slack signs
  `v0:<timestamp>:<raw body>` with HMAC-SHA256; the header is `v0=<hex>`.
  Parsed-then-restringified JSON won't match. Reject timestamps more than 300 s
  old (replay protection) and compare in constant time.
- **3000 character section limit.** Slack rejects the whole message if any one
  section passes 3000 characters. Clip every section at 2900.
- **Interactivity routing by prefix drops new buttons.** If the interactivity
  handler only forwards action ids with one prefix, every new button is
  acknowledged and silently dropped with no log line. Route with an explicit
  set of known action ids plus the prefix, and test that every button id a card
  can emit is routed.
- **Tombstone retired clients.** If unknown client ids fall back to a default
  client, deleting a retired client re-points its old cards at the default,
  and a click sends from the wrong mailbox to someone else's leads. Keep the
  entry with a `retired` flag so the webhook answers 410 and buttons refuse
  cleanly. Delete it only once every card carrying that id is gone.
- Put a schema version in card payloads so old cards can be recognised.
- Test clients cloned from a live one must explicitly reset auto-send,
  autopilot, workspace id, approvers and channel overrides. One test clone once
  posted into a live client's channel.
- A bot that wasn't invited to the channel fails quietly in your own
  workspace. Check logs, not just the absence of errors.

## Shared failure markers

Treat these as gateway errors worth a retry rather than real responses: any
52x status, a body containing "cloudflare", a body starting with
`<!DOCTYPE html`, or a JSON parse error mentioning `Unexpected token '<'`.
