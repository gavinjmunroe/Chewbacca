# togari-sandbox: what's in it and what to take

Maintainer-only map into a private repo. The usable knowledge lives in
[scoring.md](scoring.md), [clay-playbook.md](clay-playbook.md) and
[outbound-rules.md](outbound-rules.md).

Read 2026-10-09 from `bluemodernadvisory/togari-sandbox` at `adace00`
(2026-08-03, the last commit, which folded sibling projects into one repo).
Local clone `~/code/work/bma/togari-sandbox`. Line numbers drift; re-open a file
before quoting it.

## What's actually in it

- Root: the internal wiki and dashboard, live on Railway, last touched 7/23.
- `togari-schedule`: the Opportunity Engine, the only live product logic. 8 MCP
  tools in `agents/opportunity-notifications/index.ts:89-749`, Stripe-billed
  signal subscriptions and data pulls, Slack Connect onboarding. Prices in
  `types.ts:22-77` disagree with its own `docs/repo-context.txt`; read the code.
- `amber-chrome`: Caleb's extension, published on the Chrome Web Store, 5/27.
- `bma-expenses-bot`: already covered in team memory
  (`project_bma_expenses_bot`).
- `togari-stitch`: a healthcare CRM MCP server on Cloud Run, dormant since 4/8.
- `new-loom`, `internal-fireflies`: scaffolds only.

The repo description promises a 5-stage, 59-tool GTM pipeline (TOF, MOF, BOF,
CS, Analytics). `togari-schedule/BUILDOUT.md:9-323` describes it, but merge
`4d9b60c` (2026-04-16) deleted `src/agents/{top,middle,bottom}-of-funnel`,
`customer-success` and `analytics`. It's recoverable with
`git show 0edfd7f:src/agents/...` and hasn't been read yet.

## Worth taking

- Signal scoring: `prompts/signal-generation.ts:76-83`, a 1-10 rubric where
  anything under 6 is HOLD. Pairs with `gtme-signals`.
- Email review: the 7-point checklist and the banned-word blacklist in
  `schemas/email-templates.ts:63-131`. Cross-check against
  [reply-handling.md](reply-handling.md) and the slop scanners before adopting.
- Lead scoring constants and tiers: `togari-stitch/src/core/constants/index.ts:15-340`.
  Chewbacca has no lead-tier table yet; this and the primary-contact and tier
  rubrics in [togari-platform.md](togari-platform.md) are the starting point.
- Prompts for email generation (`prompts/email-generation.ts`) and meeting
  briefs (`prompts/meeting-brief.ts`). `prompts/reply-classification.ts` has
  example labels at `:67-70` that don't match its own schema, so prefer the
  platform classifier.
- Natural language to BigQuery: `data-pull-pipeline.ts:158-195` has good
  rules (AND across filter groups, drop a filter rather than guess one). Its
  only guard is `startsWith('SELECT')` with no tenant filter, and the vendored
  stub `packages/togari-admin/index.js:124-155` returns a string where
  `src/tools/query-contacts.ts:52-68` expects `{sql, params, rawSql}`, so that
  path runs `undefined` today. Take the prompt rules, not the code.
- The Clay playbook in the wiki, `src/pages/WikiPage.jsx:87-500`: list hygiene,
  a per-enrichment credit table, column colour conventions, webhook setup.
  Merge into the Clay notes under `library/learning/clay-navigation`.

## Gotchas from the code and history

- Exa returns people pages only with `category: 'linkedin profile'`.
- The Clay webhook round trip polls for up to 3 minutes.
- BigQuery rows still in the streaming buffer can't be UPDATEd.
- Slack signature checks need the raw request body.
- The dashboard's MCP token rides in the URL query string, so it can land in
  logs.

## Leave as pointers

Sagar's per-channel framing and the Six Dimensions governance
(`config/channels.ts:230`, `config/guardrails.ts`) are his strategy; read them
for context, don't port them as rules.

## Design system

`DESIGN.md` and `PRODUCT.md`: slate `#315f7b` on `#f5f8fa`, Newsreader for
titles, Inter for UI, WCAG AA. Card radius is given as both 10px and 14px.

## Secrets

None committed in tracked files or history. The Google client ID and GCP
project ID are present and aren't secrets. `VITE_PORTAL_PASSWORD` is built
into the client bundle on purpose, so treat it as public.
