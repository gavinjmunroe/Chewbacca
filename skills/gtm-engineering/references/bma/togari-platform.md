# togari-platform: what it holds and what to take

Maintainer-only map into a private repo. The usable knowledge lives in
[scoring.md](scoring.md), [vendor-recipes.md](vendor-recipes.md),
[outbound-rules.md](outbound-rules.md) and [reply-handling.md](reply-handling.md).

**The whole repo now lives in Chewbacca at [togari/platform/](../../../../togari/platform/README.md)**, with every other Togari repo beside it ([togari/README.md](../../../../togari/README.md)). Caleb, 2026-10-19: "For chewbs clients we will not be using the togari repo to keep things clean, so literally all things needed from togari should be in chewbs". So for a Chewbacca client, read, port and deploy from `togari/`, never from a Togari clone or the togari-bma-prod MCP. To refresh the copy, take the remote's main, never the local checkout: on 2026-10-19 `~/code/work/bma/togari-platform` was 61 commits behind its own origin/main. Scan before landing: that copy turned up a live Anthropic key, a live Structify key, two real Clay webhook URLs and 119 real 48North prospects.

Harvested 2026-10-09 from `bluemodernadvisory/togari-platform` at `4308237` (2026-10-09; the ported reply functions were rechecked unchanged at `8d7ad77` on 2026-10-10), local clone `~/code/work/bma/togari-platform`. It is the live Togari bot on Railway, so pushing to it deploys: never push from a Chewbacca session unless the task says to. Line numbers drift; re-open the file before quoting one.

## Summary

1. **What the repo is.** `@togari/admin` is an Express app on Railway (`togari-bma-prod.up.railway.app`, `railway.json` runs `node dist/server.cjs`). It is backed by BigQuery project `midyear-glazing-485303-u3`. The README says Cloud Run, but `docs/SAGAR_TOGARI_HANDOFF.md` and `railway.json` say Railway. The README also points at a root `CLAUDE.md` that doesn't exist.
2. **What's live.** The busiest code is the reply loop: Clay → `POST /replies` → Perplexity Computer over MCP → `POST /replies/result` → Slack card → Clay sends the reply from the same mailbox. Around it sit the per-client replybot registry, an autopilot, auto-send, the BMA deal agent, DNC, ICP funnel, Clay connector and V1 CRM.
3. **Top port: `replyIntent()`.** A deterministic classifier with 11 reply kinds, tuned on real Zeutara replies, multilingual out-of-office, and bounded regexes against slow backtracking. It is pure, has its own test file, and Chewbacca has no equivalent.
4. **Top port: reply cleaning.** `cleanReplyText`, `readableReply` and `stripEmDashes` turn HTML mail into plain text and cut quoted threads, signatures and legal footers. All pure functions.
5. **Top port: `autoSendable()`.** Every guard must pass before a reply sends unreviewed. It is the best written rule in the repo for "when may an agent send without a human".
6. **Top reference doc: drafting rules.** The "DIRECTION OF THE CONVERSATION" block, deterministic URL/link injection, the banned-phrase list, and the Zeutara reply guide's table of 15 edge cases with decided handling.
7. **Perplexity Computer recipe.** OAuth discovery values, PKCE S256, loopback-only redirect, the double JSON parse, a 15-minute call timeout, and a dispatch ordering that never retries paid work. Chewbacca mentions Perplexity Computer in 9 files but has none of these mechanics.
8. **Scoring rubrics.** Primary-contact score (+40/+20/+15/+10/+10/+5/-20), tier thresholds (80/60, ±5 escalates to Claude), relationship strength (30-day half-life, five weights), and Jaro-Winkler mismatch detection.
9. **Matching and normalising.** Company-name variants, a personal-email domain list (about 60 ISP domains), `registrableDomain`, and deterministic matching of employers against a target list.
10. **Vendor patterns.** ZoomInfo PKI JWT auth, Exa endpoints, Clay webhook push limits and HMAC, the Smartlead message-history endpoint (its API key goes in the query string, so it can leak into logs). Default pricing per call is in `src/lib/costTracking.ts`.
11. **Decision docs.** Three versions of the Sagar question set. The unresolved core is that tenancy is keyed four different ways, AIJ isn't yet a tenant, and DNC stores 4,323 contacts but enforces nothing. Caleb pre-decided the technical half.
12. **Env vars.** About 120 names, grouped by service in section 4.
13. **Secrets.** Two findings, path only: a Clay inbound webhook URL in `docs/BMA_REPLYBOT_CLAY_COLUMN.md:9` (the code says Clay webhook URLs are themselves secrets), and one `xoxb-` test token that doesn't look obviously fake. The other test tokens look fake. I couldn't scan `.env.example` values because a deny rule blocked it.
14. **Not yet in Chewbacca.** Chewbacca has `gtme-dedupe` and other gtme-* tools, but nothing from this repo's reply handling. `REPO-ATLAS.md` only links out.

---

## 1. Architecture map

**Runtime and deploy**

- `railway.json` uses the NIXPACKS builder and restarts on failure (up to 10 times).
- `build.mjs` bundles `src/server.ts` with esbuild into one CommonJS file for Node 20, leaving Google Cloud, Anthropic and Express packages external.
- `src/server.ts` (1154 lines) mounts every route:
  - Slack: `/slack` (OAuth) plus `/slack/events` and `/slack/interactivity`.
  - Clay inbound: `/api/ingest/clay`, `/webhooks/clay` (passthrough, lead, icp-callback).
  - Reply loop: `/replies`, `/connections`.
  - Clay connector: `/clay/v1`.
  - REST: `/api/v1` (ingest, enrich, fetch, calendar), `/api/v1/website`, `/api/v1/portal` (DNC, opportunity, provision behind portal auth).
  - Other: `/d/:token` (deck links), `/health`, `/admin/status`, `/deals/write`, `/email/process`, MCP, and the replybot/Smartlead webhooks.
  - It also runs the ICP sweeper and a one-off cleanup hook at line 1128.
- `scripts/` holds 22 operational tsx scripts. The notable ones are `issue-token.ts` (mints per-org MCP JWTs), `perplexity-signin.ts`, `perplexity-dispatch.ts`, `requeue-failed-replies.ts`, `purge-replies.ts`, `resolver-accuracy-test.ts`, `cost-test-enrichment.ts`, `dedupe-context-source-ref.ts` and `preflight-network-check.ts`.
- **Tests:** vitest (`vitest.config.ts`) covers `tests/smoke/**` and `src/**/__tests__/**`, with setup in `tests/smoke/setup.ts`, a 10s timeout and silent output. There are 72 test files; `tests/smoke/slack.test.ts` alone is 2173 lines.

**`src/` modules** (file counts and line totals exclude tests)

| Module                                                                                                  | What it does                                                                                                                                                          | Key files                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents/replybot`                                                                                       | Per-client registry: Slack channel, sender, voice prompts, send method, webhook auth, approvers, fitReview, autoSend, autopilot                                       | `client-config.ts` (891), `webhook.ts`                                                                                                                                           |
| `agents/smartlead-responder`                                                                            | Reply pipeline: classify and draft, intent labels, fit-review cards, auto-send, Slack actions, Smartlead API                                                          | `index.ts` (1598), `classifier.ts`, `reply-intent.ts`, `reply-text.ts`, `fit-review.ts`, `auto-send.ts`, `slack-actions.ts` (1695), `campaign-strategies.ts`, `smartlead-api.ts` |
| `agents/scoring`                                                                                        | Contact/company affiliation, data-quality scoring, cross-source validation, company-name variants                                                                     | `affiliationScoring.ts`, `qualityScoring.ts`, `crossValidation.ts`, `companyNameUtils.ts`                                                                                        |
| `agents/enrichment`                                                                                     | Prompt and tools for the private-equity buy-side contact-finding agent                                                                                                | `systemPrompt.ts`, `tools.ts`, `accumulator.ts`                                                                                                                                  |
| `enrichment`                                                                                            | Thesis fit (Perplexity), tier assignment, primary-contact resolver                                                                                                    | `primary-contact-resolver.ts`, `tier-assigner.ts`, `perplexity-reasoner.ts`, `prompts/*`                                                                                         |
| `replies`                                                                                               | `reply_items` store (MERGE-based dedup), queue, autopilot, deck library                                                                                               | `store.ts`, `autopilot.ts`, `decks.ts`, `queue.ts`                                                                                                                               |
| `perplexity`                                                                                            | Perplexity Computer OAuth, tokens, dispatch, sweeper, outcome parsing, call log                                                                                       | `config.ts`, `computer.ts`, `dispatch.ts`, `sweeper.ts`, `outcome.ts`, `task-message.ts`, `oauth.ts`                                                                             |
| `connections`                                                                                           | Warm-intro path research for Serif: target CSV, deterministic employer matching, push to Clay                                                                         | `task-message.ts`, `targets.ts`, `results.ts`, `store.ts`                                                                                                                        |
| `core`                                                                                                  | BMA deal agent: intent router, Claude tool-use loop, deal/calendar/meeting/proposal/email tools, identity and date resolution                                         | `engine.ts`, `intent-router.ts`, `tool-registry.ts`, `tool-use-runner.ts`, `identity/*`, `tools/*`, `prompts/system.ts`                                                          |
| `transports`                                                                                            | Thin shells for Slack events, MCP server, REST API and webhooks (including Fireflies)                                                                                 | `slack/index.ts`, `slack/confirm-actions.ts`, `mcp/server.ts`, `api/router.ts`                                                                                                   |
| `mcp`                                                                                                   | About 81 `togari_*` MCP tools (v1 CRM, pipeline, tiering, Clay outbound, Exa, ZoomInfo, provisioning, DNC). The `togari_core` sourcing tools were disabled 2026-05-12 | `tools/v1.ts` (1616), `tools/*`, `server.ts`, `auth.ts`                                                                                                                          |
| `routes`                                                                                                | HTTP routers: Clay ingest/passthrough/lead/connector, replies, connections, portal, website ICP                                                                       | `ingest/clay-passthrough.ts`, `ingest/clay-lead.ts`, `clay-connector/index.ts`, `replies.ts`                                                                                     |
| `ingest`                                                                                                | Universal raw-to-entities extractor, Clay HMAC/parse/persist, Gmail and Fireflies ingest                                                                              | `universal/extractor.ts`, `clay/hmac.ts`, `clay/parser.ts`                                                                                                                       |
| `integrations`                                                                                          | Clients for Clay (push out), Exa and ZoomInfo                                                                                                                         | `clay/client.ts`, `exa/client.ts`, `zoominfo/auth.ts`, `zoominfo/client.ts`, `zoominfo/normalize.ts`                                                                             |
| `dnc`                                                                                                   | Do-not-contact service and guard (fails open, flag-gated)                                                                                                             | `guard.ts`, `service.ts`, `tools.ts`                                                                                                                                             |
| `icp`                                                                                                   | Website "Generate my ICP list" funnel: job store, lead scoring, thank-you email, Clay push                                                                            | `service.ts`, `lead-record.ts`, `email.ts`, `clay-push.ts`                                                                                                                       |
| `pdw`                                                                                                   | Personal Data Warehouse: person resolver, relationship scorer, Gmail/Fireflies/Drive/Loom adapters                                                                    | `person-resolver.ts`, `relationship-scorer.ts`                                                                                                                                   |
| `v1`                                                                                                    | Client-centric CRM (clients, client_tasks, client_context)                                                                                                            | `service.ts` (1031)                                                                                                                                                              |
| `opportunity`                                                                                           | Opportunity/signal emails: draft, approve, send                                                                                                                       | `service.ts`                                                                                                                                                                     |
| `provision`, `schema`                                                                                   | Natural-language client provisioning; custom fields stored as rows, not columns                                                                                       | `planner.ts`, `registry.ts`                                                                                                                                                      |
| `dialer`                                                                                                | Cold-call script generator                                                                                                                                            | `script-builder.ts`                                                                                                                                                              |
| `email-engine`                                                                                          | Gmail triage into TRASH / EASY / COMPLEX                                                                                                                              | `classifier.ts`, `processor.ts`                                                                                                                                                  |
| `ontology`                                                                                              | Platform limits, send-volume rules, compliance, the "guardrails" doctrine                                                                                             | `platform-constraints.ts`, `guardrails.ts`                                                                                                                                       |
| `secrets`, `auth`, `middleware`                                                                         | Three-tier secret lookup, AES-GCM per-tenant secrets, `tgc_` client keys (SHA-256 hashed), JWT/Auth0, rate limits, audit                                              | `tenantSecrets.ts`, `client-keys.ts`, `jwt.ts`                                                                                                                                   |
| `lib`, `resilience`, `observability`                                                                    | Retry with gateway markers, cost tracking, tracing, circuit breakers, Sentry                                                                                          | `retry.ts`, `costTracking.ts`, `circuit-breaker.ts`                                                                                                                              |
| `bigquery`, `storage`, `events`, `tenant`, `config`, `errors`, `sources`, `worker`, `services`, `utils` | Infrastructure                                                                                                                                                        |                                                                                                                                                                                  |

**`sql/`.** `migrations/0000` to `0039` are idempotent BigQuery DDL. The `togari_core` tables run 0000 to 0021; that dataset was never created in production. Later migrations hold `reply_items` (0033/34/36), `perplexity_calls` (0035), `connection_items` (0037), `client_decks` (0038/39), v1 core (0032), client API keys (0031) and the Clay connector registry (0030). `pdw_create_tables.sql` and `phase15a_*` hold the PDW tables.

## 2. Worth funneling into Chewbacca

Each item ends with a recommendation: (a) reference doc in a skill, (b) ported pure function or tool, (c) pointer only.

**Reply classification and handling**

1. **`src/agents/smartlead-responder/reply-intent.ts:17-304`, `replyIntent()`.** Ordered, deterministic rules: ignore, unsubscribe, new address, lender, out of office (with "N weeks" mapped to `later`), moved on, form, deck, later, pass, question, interested, unclear. Each result carries a label, a next step and the addresses to use.
   - Hard-won details:
     - Email regex bounded to `{1,64}@{1,253}`: the unbounded version took 1.6s on a 6000-character input (2026-10-09).
     - Input capped at 6000 characters before any regex runs.
     - `ownWords()` cuts the quoted thread with a newline-spanning "On … wrote:" match, then stops at the sign-off or legal footer. A Zurich firm's "No, txs" was read as a referral because of its disclaimer text.
     - Free-mail addresses in a "left the firm" note are dropped.
     - "More information" alone matches signature lines (mimecast), so a deck request needs a verb.
     - Death notices are deliberately never automated.
   - **(b)** Port as `gtme-reply-intent` together with its tests (`__tests__/reply-intent.test.ts`).
2. **`reply-text.ts:41-156`.** `cleanReplyText` (entity decoding up to three passes because real mail is double-encoded, HTML stripping, quoted-thread and confidentiality-notice cut) and `stripEmDashes` (a spaced dash becomes a comma, a joining dash becomes a hyphen). **(b)**
3. **`fit-review.ts:218-249`.** `readableReply`, with `SIGNATURE_START` and `SIGNATURE_LINE` covering bold-name lines, phone numbers, street addresses and links (Infinity Ventures card, 2026-10-09), plus `splitCampaign` ("Client | Company | detail"). **(b)**
4. **`auto-send.ts:21-59`, `autoSendable()`.** Sends only when all of these hold:
   - sentiment is interested or wants more info, and confidence is at or above the client's threshold (0.9 for Zeutara);
   - the draft is at most 900 characters;
   - the draft doesn't promise a file (attach, deck, one-pager, data room);
   - no template gap (brackets, TBD, XX);
   - `CARRIES_PAYLOAD` finds no URL, email, phone number, money figure, percent or "k/m/bn" number, which guards against an injected reply steering the draft;
   - lead and campaign ids are present;
   - `replyIntent` agrees the reply is basic.
   - **(b)** for the function, plus **(a)** as the "unreviewed send" rule in gtm-engineering.
5. **`replies/autopilot.ts:40-337`.**
   - At most 4 forwards per reply.
   - `returnDate()` reads English, `dd.mm.yyyy` and French "au dd/mm" dates, and defaults to 7 days away.
   - `followUpDue()` is two business days after return at 14:00 UTC; `inSendWindow()` is 6 to 10am Pacific on weekdays.
   - Your own domain is never forwarded to.
   - A failed hook falls back to a Slack card, so a reply is never dropped.
   - Caleb's ruling is in the comment: autopilot runs on the server, not his Mac.
   - **(b)** for the date functions, **(a)** for the policy.
6. **`email-engine/classifier.ts:22-79`.** Inbox triage into TRASH / EASY / COMPLEX, with "when in doubt, COMPLEX". **(a)**

**Drafting prompts and rules**

7. **`agents/replybot/client-config.ts:270-288` (BMA/Sagar) and `472-488` (Zeutara).**
   - The DIRECTION block: we cold-emailed them, never compliment "their" subject line, any subject line is ours. It came from the inverted drafts of 2026-09-02.
   - 3 to 8 sentences, match their tone, confirm and stop selling once they say yes.
   - Never invent details, write no URLs (code injects them), no em dashes.
   - Sign-off is the bare first name.
   - Banned phrases: `strong fit`, `great fit`, `synergy`, `leverage`, `circle back`, `touch base`, `I hope this email finds you well`, `reach out`, `reaching out`, `just wanted to`, `quick question`.
   - For investors: never state terms, valuation or traction; never discuss fees; never imply returns.
   - **(a)** "reply-drafting rules" reference.
8. **`client-config.ts:434-455`, AIJ article outreach.** Never name or contrast individual outlets (it reads machine-generated when run across many leads); keep the publication name out of the prompt entirely. **(a)**
9. **`classifier.ts:154-189` and `484-502`.** Links are injected by code: strip any URL the model wrote, then insert the real one just before the sign-off. `classifier.ts:551-573`: label the subject line as ours so the model doesn't "congratulate" it. **(b)** small helper plus **(a)**.
10. **`campaign-strategies.ts:46-58`.** LinkedIn profiles attached to a reply are framed as past placements, never as available candidates. **(a)**
11. **`docs/ZEUTARA_REPLY_GUIDE.md:77-183`.**
    - Three categories (positive, negative, needs_review). Negative is discarded unseen, so it's used only when nothing is left to do.
    - needs_review always gets a draft.
    - A 15-row table of decided edge cases: licensing and broker questions, NDA or data-room requests, "send me other deals", out-of-office (a reply pauses the sequence for that firm, so it must not be dropped), and one-word replies.
    - **(a)** This is the best single reference doc to lift, with client names stripped.
12. **`dialer/script-builder.ts:50-60`.** Cold-call script rules: an 8-second (about 25-word) opener, 3 to 5 open questions, 4 to 6 objection handlers, ask for "15 minutes". **(a)**
13. **`agents/enrichment/systemPrompt.ts:19-117`.** Private-equity contact-finding agent: tier rules, which tool to call when, stop early, never call the same tool more than 4 times running. **(a)**
14. **Smaller prompts.**
    - Universal extractor (`ingest/universal/extractor.ts:20-41`): the entity schema, plus the rule that a deal is emitted only with a value, stage or explicit intent.
    - Intent router (`core/intent-router.ts:17-391`).
    - Proposal prompt (`core/tools/proposal-ops.ts:15-56`).
    - Meeting matcher (`core/tools/meeting-intel.ts:117-319`).
    - Provisioning planner (`provision/planner.ts:36-59`).
    - Opportunity email (`opportunity/service.ts:30-45`).
    - **(c)**, except the extractor, which is **(a)**.

**Scoring and fit**

15. **`enrichment/primary-contact-resolver.ts:9-130`.** Rubric: +40 title match, +20 verified email, +15 mobile, +10 LinkedIn, +10 active within 90 days, +5 tenure of 10+ years, -20 for former / ex- / interim / advisor. A near-tie (within 5 points) goes to Claude (`prompts/primary-contact-tiebreaker.ts:54-73`). **(b)**
16. **`enrichment/tier-assigner.ts:31-90`.** Tier 1 needs fit ≥80, a primary contact, and revenue or headcount on band. Tier 2 is fit ≥60. Scores within ±5 of a threshold escalate. "You can't call a company you can't reach." Prompts at `prompts/perplexity-fit-evaluation.ts:52-87` and `tier-assignment.ts:45-72`. **(b)** plus **(a)**.
17. **`pdw/relationship-scorer.ts:13-90+`.** Weights: frequency 0.30, recency 0.25, channel diversity 0.15, both-ways contact 0.15, duration 0.15. 30-day half-life; channel score is 25 per channel up to 100. Fits the `people` CLI. **(b)**
18. **`agents/scoring/affiliationScoring.ts`.**
    - `PERSONAL_EMAIL_DOMAINS` (lines 34-100, about 60 domains including regional ISPs).
    - `jaroWinklerSimilarity` (172-222) and `normalizeCompanyName` (228-249).
    - `detectObviousMismatch` (255+): industry keywords plus Jaro-Winkler thresholds below 0.5 and 0.4.
    - `qualityScoring.ts:13-80`: completeness points and cross-source bonuses.
    - **(b)**
19. **Lead tiering.** `docs/HANDOFF-SLA.md:22-46`: tier definitions; role, firm and deal-size checks; a warm intro moves a lead up one tier; auto-classification is only a hint above 0.75 confidence. `icp/lead-record.ts` (`scoreIcpLead`). **(a)**

**Dedup, merge and matching**

20. **`agents/scoring/companyNameUtils.ts:17-190`.** `generateCompanyNameVariants`: strip legal suffixes (several in a row), drop abbreviation dots, swap & and "and", join short acronym prefixes. Built for ZoomInfo and Enformion returning nothing on exact name mismatches. **(b)** It would feed `gtme-dedupe`.
21. **`connections/targets.ts:1-90+` and `results.ts:22-114`.**
    - The model's list matching fails silently both ways ("Brown & Toland" vs "Altais"; a Baptist hospital in Florida matched to one in Kentucky), so matching is redone deterministically.
    - `registrableDomain` treats co/com/org/ac/gov/edu/nhs as second-level labels.
    - A row whose domain has a path only proves the parent company.
    - Match grades: domain, parent_domain, name, model_only.
    - Roles without a source URL are dropped, as is a match on the customer itself.
    - `parseCsv` is a minimal RFC 4180 parser.
    - **(b)**
22. **`pdw/person-resolver.ts:15-90`.** `person_id = sha256(lowercased email)`; merges take incoming non-null values and union email lists. **(b)** small.
23. **`core/identity/mention-resolver.ts:236-275`.** Fuzzy name rules: exact match is high; a first-name prefix is high only at 4+ characters and when unique; Levenshtein ≤2 or a last-name substring is low. **(b)** for `people`.
24. **`replies/store.ts` header.** BigQuery has no unique constraint, so all writes go through one MERGE; resent rows return 200 with duplicate: true. **(a)** idempotency pattern.

**Vendor and API patterns**

25. **Perplexity Computer** (`perplexity/config.ts:12-141`, `computer.ts:43-120`, `docs/PERPLEXITY_COMPUTER_MCP.md`).
    - Endpoint `https://www.perplexity.ai/rest/computer/mcp` with `/authorize`, `/token`, `/register` (dynamic client registration), scope `asi:query`, PKCE S256 only.
    - The redirect must be a localhost loopback, so sign-in runs as a local script.
    - The tool is `call_perplexity_computer` (message, thread_id, project_uuid, private visibility).
    - The result's `content[0].text` is a JSON string and needs a second parse.
    - The call blocks for the whole task (a 12-minute run was measured), so the timeout is 15 minutes.
    - `project_uuid` is required or the session can't see the project's saved credentials.
    - Never put the callback token in the message.
    - `dispatch.ts` header: save "dispatching" before the call and never auto-retry a row stuck there (it could pay twice).
    - `sweeper.ts`: chase after 15 minutes, up to 3 attempts, give up after 1 hour, enforce a daily cap.
    - **(a)** new reference, plus **(b)** for `parseComputerResult`.
26. **ZoomInfo** (`integrations/zoominfo/auth.ts:1-225`, `client.ts:1-90`).
    - Mint an RS256 client JWT (aud `enterprise_api`, 5-minute life), POST it to `https://api.zoominfo.com/authenticate`, cache the returned JWT (about 60 minutes) with a 60s margin, and share in-flight requests (about 1 auth request per second allowed).
    - Normalise literal `\n` in env-var private keys.
    - Legacy endpoints `/search/company`, `/enrich/company`, `/search/contact`, `/enrich/contact` with explicit output fields. On 429, retry after a 5s delay.
    - **(a)**
27. **Exa** (`integrations/exa/client.ts:40-110`). `https://api.exa.ai`, header `x-api-key`, operations search, findSimilar, contents and answer. Cost is logged after the body is consumed. **(c)** or **(a)** one paragraph.
28. **Clay** (`integrations/clay/client.ts:1-145`, `ingest/clay/hmac.ts`, `routes/clay-connector/index.ts`, `client-config.ts:131-187`).
    - Table webhooks take one object per POST; cap 500 rows per push and 5 concurrent requests; bearer auth is optional.
    - HMAC verification via `X-Clay-Signature: sha256=<hex>` over the raw body with constant-time comparison.
    - The connector always answers 200 with flat JSON so one bad row can't break a column.
    - Clay's "reply to lead in a campaign" action is keyed on lead_id + campaign_id and sends from the same Smartsenders mailbox.
    - Form fills need a separate Clay table because there's no campaign to reply into.
    - Webhook URLs are secrets.
    - Inbound passthrough is routed by tag, uses an allowlist, and passes `row_id` as the insertId (`docs/PR17_CHANGES.md`).
    - **(a)**, adding to the existing Clay notes.
29. **Smartlead** (`smartlead-api.ts:46-129`). `GET https://server.smartlead.ai/api/v1/campaigns/{cid}/leads/{lid}/message-history?api_key=` (key in the query string, so a log risk), 10s abort, and failures return nulls. Webhook auth is `X-Smartlead-Signature` HMAC-SHA256 (`client-config.ts:20-27`). **(a)**
30. **Retry and cost.** `lib/retry.ts:26-52` lists gateway markers (52x status codes, "cloudflare", `<!DOCTYPE html`, `Unexpected token '<'`). `costTracking.ts:58-84` holds default prices, in cents. **(c)**

**Slack bot patterns**

31. **Card design.**
    - `fit-review.ts:161-299`: the task in bold with an @mention, then their words, buttons, and the draft. Off-email tasks (deck, form) get a "done" button, with the draft as an optional holding reply. Slack rejects any section over 3000 characters, so clip at 2900.
    - `fit-review.ts:41-48`: interactivity routing only matched the `smartlead_` prefix, so new buttons were acknowledged and silently dropped.
    - `client-config.ts:195-209` and `815-871`: retired clients are kept as tombstones, because unknown ids fall back to the default client and a click would send from the wrong mailbox. Card payloads carry a schema version (`cv`).
    - Test clients cloned with object spread must explicitly reset autoSend, autopilot, slackTeamId and approvers (lines 784-810).
    - `transports/slack/confirm-actions.ts`: confirmation-gated writes.
    - **(a)** "Slack approval cards" reference.
32. **`ontology/platform-constraints.ts:26-84` and `guardrails.ts:76-97`.**
    - Character limits per channel: LinkedIn fold at 210, cold email 900 characters and 40 a day.
    - Send rules: 40 per inbox and 200 per domain per day, Tuesday to Thursday 8 to 11am recipient time, a 4-week warmup (5/10/20/40).
    - Compliance: CAN-SPAM footer, unsubscribe means remove immediately, separate sending domains.
    - **(a)** Verify these against the Lieben playbook already in team memory before adopting.

**Process docs**

33. **`docs/REPLYBOT_NEW_CLIENT.md`.** Onboarding playbook: look in Slack and meeting notes before asking anything, then ask at most 4 questions. **(a)**
34. **`docs/TOGARI_CODED_VS_CUSTOM.md`.** Code the verbs once; per-client nouns are data rows. A three-question test decides which. **(a)**
35. **Other docs.** `docs/ICP_LIST_FUNNEL.md` (the list is never emailed; it's the reason for the call). The Serif connections, send-path and Clay-build docs. **(c)**

## 3. `docs/` and the SAGAR_TOGARI files

- **`SAGAR_TOGARI_DECISION_QUESTIONS.md`.** A read-only production inspection dated 2026-07-10. Findings:
  - The deployed warehouse is far richer than the repo: DNC with 4,323 contacts and 0 flagged, a live opportunity/signal subscription for Caleb's BMA address, an empty healthcare vertical, and 42 clients with one deal each.
  - AIJ is client_id `aij_communications_06302026`, one $3,800 proposal.
  - `togari_core` doesn't exist in production, so the sourcing MCP suite is dark.
  - Tenancy is keyed four ways: `tenant_id`, `client_id`, `org_id`+`owner_did`, `client_brand`.
  - Recommended path: unify the key, promote AIJ to a tenant, make DNC an enforced control, point the opportunity product at AIJ, expose it via MCP plus a portal.
- **`SAGAR_TOGARI_QUESTIONS_SHORT.md`.** 30 lettered questions (P0/P1/P2), each with a recommendation: canonical key `client_id`, a dedicated GCP project, what DNC blocks, the opportunity email approval flow, which MCP actions skip confirmation, one connector per org, the Joe portal scope, the second ingestion source, and more.
- **`SAGAR_TOGARI_QUESTIONS_FINAL.md`.** Caleb pre-decided the technical half:
  - `client_id` is canonical; a dedicated project; full MCP write except live send and hard deletes.
  - Silent auto-reorganise and silent pipeline changes.
  - Data siloed per client, enrichment per client, retained indefinitely, soft-delete by default.
  - DNC keyed on email + domain + id; BMA sees everything, Joe sees only AIJ; AIJ has its own Clay account; the sourcing engine is retired.
  - Sagar still owes 8 answers: AIJ as a tenant, DNC scope, the opportunity email flow, the Joe portal scope, the first demo workflow, status visibility, block or tag on a DNC hit, and what replaces his spreadsheet. I didn't find his answers in the repo.
- **`docs/SAGAR_TOGARI_HANDOFF.md`.** Production URL and MCP endpoint, connector token via `?token=` (connectors can't send headers), and Exa/ZoomInfo tools registered last because clients truncate the tool list at about 20 to 25. Remove and re-add the connector in Perplexity to refresh its cached tool list.
- **`docs/HANDOFF-SLA.md`.** A proposal dated 2026-05-28 that still needs Karthik's sign-off. Covers 2-hour acknowledgement and a 24-hour first reply, tiered ownership, and a manual Acknowledge button.
- **Clay docs.** `CLAY_INTEGRATION_BRIEF`/`ROADMAP` (inbound fan-out with DNC first, 4 open questions for Karthik), `TOGARI_CLAY_CONNECTOR`, `PR17_CHANGES` (idempotency).
- **`KARTHIK_GCP_HANDOFF.md`.** Deploy order, IAM matrix, env-var contract, open decisions.
- **Perplexity docs.** `PERPLEXITY_*`, `REPLY_RESULT_ENDPOINT`, plus per-client setup and handling guides for Serif and Zeutara.
- **Slack docs.** `SLACK_EXTERNAL_WORKSPACE`, `SLACK_USER_TOKEN`.
- **`phase1*`.** Refactor inventory and follow-ups.

## 4. Env vars (names only)

- **Anthropic:** ANTHROPIC_API_KEY.
- **OpenAI:** OPENAI_API_KEY.
- **Perplexity:** PERPLEXITY_API_KEY, PERPLEXITY_MODEL, PERPLEXITY_ACCOUNT_<CLIENT>, PERPLEXITY_PROJECT_UUID[_<ACCOUNT>], PERPLEXITY_OAUTH_PORT, PERPLEXITY_CALL_TIMEOUT_MS, PERPLEXITY_DAILY_CALL_CAP, PERPLEXITY_CONNECTION_DAILY_CALL_CAP, PERPLEXITY_ALERT_SLACK_CHANNEL.
- **Google Cloud and BigQuery:** GCP_PROJECT_ID, GCP_CREDENTIALS_BASE64, GOOGLE_CREDENTIALS_BASE64, BIGQUERY_DATASET, BACKFILL_DATASET.
- **Google OAuth (Gmail, Calendar):** GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN, GMAIL_OAUTH_REFRESH_TOKEN, GMAIL_INGEST_USER, GOOGLE_CALENDAR_REFRESH_TOKEN(S), GOOGLE_CALENDAR_LEGACY_OWNER_SLACK_ID.
- **Slack:** SLACK_BOT_TOKEN, SLACK_USER_TOKEN, SLACK_SIGNING_SECRET, SLACK_CLIENT_ID/SECRET, SLACK_BMA_TEAM_ID, SLACK_DEFAULT_TENANT_ID, SLACK_WEBSITE_NOTIFY_WEBHOOK, REPLYBOT_ALERT_CHANNEL.
- **Smartlead:** SMARTLEAD_API_KEY, SMARTLEAD_WEBHOOK_SECRET, AUTO_POLL, POLL_INTERVAL_MINUTES.
- **Clay:** CLAY_API_KEY, CLAY_INGEST_API_KEY, CLAY_INGEST_RATE_LIMIT_PER_MIN, CLAY_HMAC_INGEST_ENABLED, CLAY_WEBHOOK_SECRET, CLAY_DEFAULT_TENANT_ID, CLAY_CONNECTOR_KEY, CLAY_OUTBOUND_MAX_ROWS, CLAY_ICP_WEBHOOK_URL.
- **Replybot (Clay-backed):** REPLYBOT_{AMBER,BMA,SERIF,HHH,AIJ}_WEBHOOK_SECRET, REPLYBOT_{AMBER,BMA,SERIF,ZEUTARA}_CLAY_REPLY_URL, REPLYBOT_SERIF_CLAY_OUTREACH_URL, REPLYBOT_ZEUTARA_CLAY_{FORWARD,BLOCKLIST}_URL.
- **Reply loop:** REPLIES_INGEST_TOKEN, REPLY_RESULT_TOKEN, REPLIES_DEFAULT_CLIENT_ID, REPLIES_FORCE_CLIENT_ID, REPLIES_DELETE_AFTER_SEND, REPLIES_CARD_REQUIRES_DRAFT, REPLY_SWEEP_{ENABLED,INTERVAL_MINUTES,STALE_MINUTES,MAX_ATTEMPTS,GIVE_UP_MINUTES,DISPATCHING_MINUTES}, REPLY_DISPATCH_PER_PASS, CONNECTION_SWEEP_{ENABLED,INTERVAL_MINUTES}, CONNECTION_DISPATCH_PER_PASS.
- **Published Google Docs/Sheets:** SERIF_REPLY_GUIDE_URL, SERIF_TEST_REPLY_GUIDE_URL, ZEUTARA_REPLY_GUIDE_URL, SERIF_CONNECTION_GUIDE_URL, SERIF_TARGET_ACCOUNTS_URL, SERIF_CONNECTIONS_CLAY_URL.
- **Exa:** EXA_API_KEY.
- **ZoomInfo:** ZOOMINFO_USERNAME, ZOOMINFO_CLIENT_ID, ZOOMINFO_PRIVATE_KEY.
- **Fireflies:** FIREFLIES_API_KEY, FIREFLIES_WEBHOOK_SECRET, FIREFLIES_DEFAULT_TENANT_ID.
- **Auth and MCP:** MCP_JWT_SECRET, MCP_BEARER_TOKEN, MCP_DEFAULT_TENANT_ID, MCP_TRANSPORT, AUTH0_DOMAIN, AUTH0_AUDIENCE, AUTH0_TOKEN, OAUTH_RESOURCE_URL, TOGARI_API_KEY, TENANT_SECRETS_MASTER_KEY.
- **Website and ICP funnel:** WEBSITE_INGEST_API_KEY, WEBSITE_RATE_LIMIT_PER_MIN, ICP_CALLBACK_KEY, ICP_CALLBACK_URL, ICP_{AUTOSEND_ENABLED,PIPELINE_ENABLED,DAILY_CAP,PER_EMAIL_DAILY_CAP,JOB_TIMEOUT_MINUTES,SWEEP_INTERVAL_MINUTES,EMAIL_SENDER,EMAIL_SENDER_NAME,EMAIL_BCC}.
- **Feature flags:** DNC_ENFORCEMENT_ENABLED, OPPORTUNITY_EMAIL_SEND_ENABLED, TOGARI_TOOL_LOOP_ENABLED, TOGARI_LEGACY_TOOLS_ENABLED, TOGARI_WORKER_ENABLED, FEATURE_REMINDER_OWNER_ROUTING.
- **Runtime:** PORT, NODE_ENV, SENTRY_DSN, TOGARI_PUBLIC_BASE_URL, TOGARI_INTERNAL_DOMAINS, TOGARI_DEFAULT_CONCURRENCY, PRIMARY_OWNER_ID, NETWORK_CHECK_URL/TIMEOUT_MS.
- **Scripts only:** COST_TEST_*, SPRINGDALE_XLSX, DRY_RUN, SEED, TENANT_ID, TENANT_TIER, USER_EMAIL, USER_ID.

## 5. Possible committed secrets (paths only)

- `docs/BMA_REPLYBOT_CLAY_COLUMN.md:9`: a full Clay inbound source webhook URL with its id. The repo's own comment (`client-config.ts:184`) says Clay webhook URLs are secrets. Worth rotating or redacting.
- `src/agents/smartlead-responder/__tests__/external-workspace.test.ts:31`: an `xoxb-` string of 20 characters, too short to be a real Slack token. Almost certainly a fixture, but it isn't labelled as fake.
- Fixtures that look fake: `tests/smoke/setup.ts:293`, `zeutara-clay-reply-send.test.ts:37`, `routes/__tests__/slack-oauth.test.ts:62,108`, and the ZoomInfo test, which only matches a "BEGIN PRIVATE KEY" header pattern.
- **Keep out of team memory as-is, though none of it is a secret:** `client-config.ts` hardcodes Slack channel ids, Jonah's Slack user id, sender emails, a Calendly URL and placement LinkedIn URLs. The team-memory rule forbids personal emails.
- **Not checked:** the values in `.env.example`. A deny rule blocked reading them, and I didn't route around it. Git history for deleted secret files wasn't scanned either. The tracked files with secret-like names are code and SQL, not credential files.
