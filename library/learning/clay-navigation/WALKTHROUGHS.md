# Clay walkthroughs, distilled

Every concrete Clay procedure found in Clay University, Clay's YouTube channel,
practitioner walkthroughs and GTM engineer interview material, one entry per
procedure, each with its source. Gathered 2026-10-09 and 2026-10-10. Raw pages
and transcripts stay private in `~/second-brain/raw/clay-videos/` with a
`LEDGER.tsv` of every source; nothing here quotes more than a short phrase.

Read [procedure.md](procedure.md) first. It holds what was observed live in a
client workspace; this file holds what the tutorials and practitioners say,
which is documented, not observed. An entry graduates to procedure.md only after
a real run and a readback. Entries already covered by procedure.md or
[demand-gen-playbooks.md](../../../skills/gtm-engineering/references/demand-gen-playbooks.md)
were left out (FETE, the 30% to 80% waterfall lift, Auto-run off, five-row tests).

Each entry carries one **Kit** tag, so an answer can say how it would be done:

- `kit-read`: the kit answers it today with `chewbacca clay <op>` (a read).
- `ui-only`: a Clay page action the kit routes to with `clay-go` but never presses.
- `untaught-write`: a write listed in `chewbacca clay ops` under untaught_writes.
- `formula`: a Clay formula or AI-formula pattern, free of credits, written by hand.
- `practice`: judgment or process, nothing to press.

Source tags: `U:` is `https://university.clay.com/lessons/`, `D:` is
`https://university.clay.com/docs/`, `CB:` is `https://university.clay.com/claybooks/`,
`YT:` is `https://www.youtube.com/watch?v=` with a timestamp.

## Credits and cost control

### W-001 Pick the cheapest tool that can answer

- Order: AI formula (free, deterministic) for data already in the row; Use AI (no internet) for reasoning; Claygent only when the answer lives on the web.
- Bring your own OpenAI or Anthropic key to cut AI cost by up to 90%.
- Claygent model tiers: about 1 credit for yes/no, 2 for moderate, 3 for multi-part analysis. Helium was 1 credit and Argon 3 in the credits lesson.
- Clay's own counterweight: dropping to the cheap model saves money but a 10% quality drop across 100k accounts costs about 10k leads.
- Kit: `practice`. Read spend after with `chewbacca clay credit-usage ws=... days=7`.
- Source: U:best-practices-to-maximize-your-credits ("Strategy 2"); U:enriching-with-claygent ("Tips").

### W-002 Conditional run so a paid column only fires when needed

- Column > Run settings > Conditional run (or "Use AI" there) and describe the condition; Clay writes the formula. Example: personal email only when the validated work email is blank.
- Waterfalls are this same mechanism under the hood, so any waterfall step can be edited the same way.
- Kit: `ui-only` (configure-column); read the saved condition with `chewbacca clay columns table=t_...`.
- Source: U:ai-formulas-conditional-runs-clay-101 ("Mastering Conditional Runs").

### W-003 Metaprompter before any paid prompt iteration

- In a Claygent or AI column click "Help me" and describe the output in plain English; it returns a structured prompt. Iterating a prompt by re-running paid rows is the most common waste.
- Claygent Builder test runs are free, so iterate there instead of in a table.
- Kit: `ui-only`. Caleb's rule: never Sculptor; the metaprompter inside a column is not Sculptor.
- Source: U:best-practices-to-maximize-your-credits ("Strategy 1"); U:build-scale-and-deploy-claygents-with-claygent-builder ("Free Testing").

### W-004 Sandbox mode and the R&D budget

- Sandbox mode drafts prompts and previews outputs without spending credits; switch back to production to run.
- Clay recommends 10-15% of monthly credits as an experiment budget, and a written library of plays that worked.
- Kit: `practice`.
- Source: U:how-to-experiment-inside-of-clay ("Setting Up Your Clay R&D Budget").

### W-005 Credits refund on a miss, and nothing pings twice

- Waterfalls charge only for data found; a provider that returns nothing is refunded, and an email already invalidated is not re-validated.
- Anything that does not call an external API (formulas, normalizers) costs no data credits, but every operation consumes an action.
- Kit: `practice`; verify with `chewbacca clay credit-usage`.
- Source: U:get-started-in-clay ("Waterfall Enrichments", "Transform").

### W-006 Price a tech-stack search before running it

- HG Insights bills per company per technology (about 8 credits each in the lesson): two technologies across 100 companies is about 1,600 data credits plus actions.
- Start with 10-50 companies or Sandbox; product categories cost the same as single products and return broader lists.
- Kit: `practice`.
- Source: U:building-company-lists-based-on-tech-stack ("Understanding Credit Usage").

### W-007 Reuse company data in the people table instead of paying per person

- Find People links the people table to the company table. Enrich the company once and pull the field through the lookup column; re-run that lookup column after enriching companies.
- Kit: `ui-only`.
- Source: U:find-people-clay-101 ("Bonus: Linked Tables"); U:enrich-people-waterfalls-automated-outbound.

## Finding companies, people, jobs and local businesses

### W-010 Find Companies into a workbook

- Home > New > Workbook > Find Companies. Filters: industry, headcount, location (city, state, region, country ISO, postal code, is headquarters), keywords, founding date. Preview, then import.
- Skip the default enrichments offered at import; they auto-run on the whole list.
- One hypothesis per list, 1,000-3,000 records, negative keyword exclusions (agency, consultant).
- The dataset is a self-reported snapshot; use Enrich Company for live values.
- Kit: `ui-only` (find-people route covers the find modal); read the result with `chewbacca clay tables ws=...`.
- Source: U:find-companies-clay-101 (Steps 1-4); U:finding-companies-in-clay ("Best Practices").

### W-011 Find People at these companies

- In the company table: Actions (top right) > Find People at These Companies. Company identifier: LinkedIn URL preferred, domain as fallback.
- Filters worth knowing: experience in role (6+ months, 1+ year), bio keywords, connections or followers, certifications (HubSpot, Salesforce), languages, education, past experiences, exclusions (CRM customer list).
- Editing the source column later appends new people without removing existing rows.
- Kit: `ui-only` (`chewbacca clay` prints the `clay-go find-leads-menu` route).
- Source: U:find-people-clay-101 (Steps 1-4); U:finding-people-in-clay.

### W-012 Find Jobs as a source or as an enrichment

- Source: Sources > Find Jobs, search all companies or one company list, list every title permutation (no semantic search), filter location and job type, preview counts, up to 1,000 jobs per query.
- Enrichment: the Find Jobs waterfall runs PredictLeads, then Google Jobs, then Clay's jobs database on a company domain plus keywords; Google Jobs takes at most 4 keywords.
- Write job rows to a new table to segment by hiring volume.
- Kit: `ui-only`.
- Source: U:find-jobs-source-enrichment-clay-101 ("How To: Jobs as Source", "Pro Tips").

### W-013 Google Maps for businesses missing from B2B data

- Create New Table > Google Maps. Set a location, drag the pin, adjust radius; pick a Business Type rather than free text.
- Results cap at 1,000 per search and keep loading after the first count; run one search per area.
- Follow with Claygent on each website for the qualifier no database has, then filter (example: 4.5+ stars, 100+ reviews, mentions Invisalign).
- Kit: `ui-only`. Outside Clay, `chewbacca api` has a Google Maps reader for small checks.
- Source: U:finding-businesses-with-google-maps; U:enrich-with-claygent-for-last-mile-data-discovery ("Finding Invisalign Providers").

### W-014 Lookalikes from a closed-won account

- Ocean.io's action was sunset; use the native Find Company Lookalikes action, which returns 10 per seed matched on industry, size, hiring, revenue growth and technology.
- Automate on CRM closed-won: add the customer, run lookalikes, write to a new table, run a Claygent competitor check, then route.
- Kit: `ui-only`.
- Source: U:find-your-next-customer-with-company-lookalikes.

### W-015 AI ICP search from your own domain

- Source modal > AI ICP search, enter your domain; it infers buyers, sizes, industries and titles and returns a company list you can edit.
- Kit: `ui-only`.
- Source: U:find-your-icp-with-ai.

### W-016 Tech-stack company lists with HG Insights

- Add Column > Add Enrichment > Companies by tech stack with HG Insights. Define by vendor domain, product category or product name; check discovery.hgdata.com when a product is missing.
- Useful attributes: first verified date (recent adopters), product location and signal counts (how embedded), HQ versus subsidiary toggle.
- Plays: competitive displacement, complementary stack, migration off legacy versions.
- Kit: `ui-only`.
- Source: U:building-company-lists-based-on-tech-stack.

## Enrichment and waterfalls

### W-020 Work email waterfall with the catch-all switch

- Add enrichment > Work Email. Inputs: company domain plus the person's LinkedIn URL; fallbacks full name + company name, or full name + personal email.
- Validator defaults to ZeroBounce and can be swapped. Catch-all addresses count as valid by default; turn on "Only mark Safe to Send emails as valid" to drop them.
- Validation columns are hidden; unhide them in the Columns panel. A waterfall that keeps running after a hit means the hit failed validation.
- Save & Run (10 rows) first.
- Kit: `ui-only` to configure; `chewbacca clay columns` reads the provider order and inputs; `chewbacca clay table-status` reads per-column success and error counts.
- Source: U:enrich-people-waterfalls-clay-101 ("How It Works"); U:enriching-people-data.

### W-021 Company waterfall and how to read it

- Add enrichment > search the data point (Funding Stage in the lesson) > reorder providers if one covers your ICP better > input Company Domain > Save & Run (10 rows).
- A provider that succeeds but lacks the data point still falls through. Every provider feeds one final column. In the demo, one provider covered 0%, two reached 70% and three reached 100%.
- Corner pieces: company domain plus company LinkedIn URL; person full name plus LinkedIn URL.
- Kit: `ui-only`; `chewbacca clay table-status` for coverage.
- Source: U:enrich-companies-waterfalls-automated-outbound; U:enrich-companies-waterfalls-clay-101.

### W-022 Enrich Person or Enrich Company first

- The first column on a new table should be Enrich Person or Enrich Company: it returns readable data and unlocks downstream waterfalls across 150+ providers.
- Kit: `ui-only`.
- Source: U:get-started-in-clay ("Enrich").

### W-023 Claygent column that answers one question per row

- Add column > Claygent. Map the domain into the URL input. Write the prompt in second person with explicit Yes/No criteria, a fallback ("if no recent posts, use the About section") and a length cap (under 50 words).
- Add confidence or reasoning outputs to audit; run 10 rows.
- Inputs: company domain (plus LinkedIn URL); person LinkedIn URL (plus name, company, title as context).
- Kit: `ui-only`; read results with `chewbacca clay rows`.
- Source: U:enriching-with-claygent ("Step-by-Step", "Tips").

### W-024 Claygent model choice

- Neon formats answers into several output columns from one run; GPT-4 or Claude-class models reason better but format worse; templates exist for common jobs such as finding a 10-K URL.
- Claygent cannot read paywalled or logged-in pages.
- Kit: `ui-only`.
- Source: U:claygent-ai-web-scraper-limitless-research ("Choosing the Right Model").

### W-025 Scraper ladder: native, Claygent, Zenrows, Apify, extension

- Clay's native scraper is the cheap default for static pages and has built-in extraction of emails, phone numbers, links and body text.
- Claygent for general web research. Zenrows when anti-bot blocks (enable auto-parse, JavaScript rendering with Premium Proxy, anti-bot). Apify for bulk sources. The Chrome extension for logged-in directories.
- Kit: `ui-only`.
- Source: U:deep-dive-clay-scrapers-limitless-research; U:deep-dive-zenrows-scraping-limitless-research.

### W-026 Apify actor inside a table

- In Apify: pick an actor, Create Task, switch input from Manual to JSON and copy it. In Clay: Actions > Run Apify Actor, select the task, paste the JSON under Input Data. Some actors carry their own subscription (the Reddit one was $45 a month).
- Kit: `ui-only`.
- Source: U:data-collection-with-third-party-scrapers-tam-sourcing ("Apify: Setup and Configuration").

### W-027 Chrome extension recipe for a list page

- Open the extension; auto-detect finds lists. If it misses: Select Data > new recipe > URL pattern > click two items in the list > choose attributes > save; the data opens as a new table.
- Kit: `ui-only`.
- Source: U:deep-dive-clay-chrome-extension-limitless-research.

### W-028 Logos off a homepage into rows

- Analyze Image (or Get Page Screenshot first) with a prompt asking for a comma-separated list of every logo's company name; then an AI column converting the list to JSON with a JSON schema output; then on the JSON cell, Take action on list > Write each item to a new row in another table; then Claygent per logo for its domain.
- Same pattern detects a LinkedIn Hiring badge or a live chat widget from a screenshot.
- Kit: `ui-only`.
- Source: U:enrich-from-images-and-screenshots ("Step-by-Step Process").

### W-029 Facts from 10-K and 10-Q filings

- Domain waterfall, then Claygent (via metaprompter) for the stock ticker, then Oakie AI with ticker, date range, filing type and questions, then an AI column to compress to three challenges, split to columns.
- Oakie when you need a few reliable answers; Claygent when you need many questions or a custom shape and can accept missing a filing.
- Kit: `ui-only`. `gtme-signals formd` covers private raises from SEC Form D for free.
- Source: U:enrich-from-financial-filings.

### W-030 Perplexity for unstructured questions with sources

- Perplexity enrichment per row (liquor license rules per city in the lesson); keep the answer and the sources in separate columns; summarize with Use AI, not Claygent, since the data is already in the row.
- Kit: `ui-only`.
- Source: U:enrich-with-perplexity.

### W-031 Normalize company names before they reach copy

- Add enrichment > Normalize > Normalize Company Names (strips Inc., LLC and "a company of" tails); also whitespace, phone numbers, locations. Free, and comes before any AI formula.
- Kit: `ui-only`; the result is readable with `chewbacca clay rows`.
- Source: U:data-cleaning-normalization-clay-101.

### W-032 AI formulas for list fields

- Formula column, describe the transformation, preview, and edit the generated code if needed. For list fields (experiences, education) use "Ask question about items with AI" to count, join or extract.
- Kit: `formula`.
- Source: U:ai-formulas-conditional-runs-automated-outbound ("The Beauty of AI Formulas").

## Audiences, workflows and functions

### W-040 Table or Audience

- A table caps at 50,000 rows; segments of millions belong in Audiences. Tables are the lab (multi-column conditional flows, Claygent you are unsure of), Audiences the production layer.
- Push tested results back with the table tool "upsert into Audiences": choose the Companies or People audience, match on domain and/or LinkedIn URL to avoid duplicates, map fields, run 10 rows.
- Kit: `kit-read` for audiences (`chewbacca clay audiences ws=...`, `audience-records`); the upsert is `untaught-write`.
- Source: U:audiences-workbooks-and-tables-explained.

### W-041 Enrich a segment with a Workflow (beta)

- Segment > Enrich > + > Create enrichment workflow (the legacy option is Create enrichment table) > View workflow. Steps: Source, Enrich segment, Map fields, Review & run.
- Tick several segments in Source to enrich them all with one workflow. Inputs auto-wire; "Suggest input mappings" restores Clay's guess.
- Test: 10 rows plus "Add data" to pick hard records; re-run by column, row or cell.
- Map fields: confirm, trash wrong matches, Add Field, and set "Ignore blank values" so an empty result never wipes good data. Finishing adds an Upsert segment record node.
- Review shows credits per enrichment and per run (about 5.5 for company lookup, enrich person, work email, mobile). Run menu: Publish (live, no run), Publish and run (whole segment), Test. A draft never fires.
- Runs tab: filter by status, version, trigger; open a record to see the step it failed on. Every node has a plain-English Run if panel.
- Kit: `kit-read` for `chewbacca clay workflows`; building is `ui-only`.
- Source: U:enriching-an-audience-with-workflows.

### W-042 Save columns as a Function

- Prove the workflow on a few rows, Cmd-click the columns, right-click > Save as function, name it, mark inputs required, untick unneeded outputs, toggle "replace the columns with this function". The function editor shows estimated cost per row.
- Edit once in the function library and every calling table updates.
- For MCP: enable it for MCP with a clear name and description, or toggle it off for expensive ones.
- Kit: `ui-only`.
- Source: U:build-your-first-function; U:functions-for-mcp.

### W-043 Claygent Builder for shared agents

- Left nav Agents. Build from scratch in the text editor or from a template (Caleb: not with Sculptor). Test runs are free. Web search is off by default.
- Deploy with an AI column > Saved Claygents; variables map to columns. One edit propagates to every table using it.
- Kit: `ui-only`.
- Source: U:build-scale-and-deploy-claygents-with-claygent-builder.

### W-044 Audience job-change play end to end

- Segment by title and location, add a job-change signal (last three months, then fires on every new change), add an AI column ("Congrats on [title] at [company]") run on 10 rows, map the output to a field, act (ads, sequencer, Slack); CRM sync rules write it back.
- Kit: `kit-read` for `chewbacca clay signals`; the rest `ui-only`.
- Source: U:how-audiences-works-import-enrich-action-export.

### W-045 Rolling Clay MCP out to reps

- MCP page (left nav, Labs): default credit limit for new users, hide managed functions, allowed MCP clients, invite up to 15 users at a time, per-user limits and usage.
- Settings > Team: reps as viewer. Budgets: a budget per team with members; a rep stops at the cap.
- Starting limits Clay suggests: about 500 credits per rep per month, 2,000-5,000 for heavy SDRs, watched for two weeks. Credit cost per action lives in the function view, not the calling table.
- Kit: `practice`.
- Source: U:how-to-set-up-your-reps-for-mcp; U:governance-credit-budgets-and-access; U:get-your-team-running-with-clay-in-their-ai-tools.

## Signals, scoring and ABM

### W-050 Custom signal from any enrichment

- Send the monitored value plus a timestamp to a history table; schedule re-runs of that column in Table Settings; a formula compares the latest value with the previous; on change, fire Slack, CRM or a sequence.
- Validate a candidate first: public or in your systems, changes often, correlates with buying, actionable within 24-48 hours, not tracked by competitors.
- Kit: `kit-read` for `chewbacca clay signals`; scheduling is `ui-only`.
- Source: U:advanced-tam-sourcing-techniques ("Building Custom Signal Systems"); U:building-custom-signals-in-clay.

### W-051 Signal stacking and velocity

- Sequential (ordered journey), parallel (N of M signals) or hybrid. Date-stamp every signal and compute days between first and latest; compressed timing means urgency.
- Point scores with the native Score Row; AI scores (1-100 with an explicit ICP description) for messy text. Log initial score, triggering signals, time to first conversation, outcome and deal size to recalibrate.
- Kit: `formula` for velocity; `practice` for the rest.
- Source: U:advanced-strategies-with-signals.

### W-052 Weighted account score and tiers

- Example weights: growth 20, tech fit 25, recent funding 15, executive change 10, competitive position 30. Tiers: 80-100 senior rep with custom research, 60-79 standard sequence, under 60 nurture.
- Kit: `formula`.
- Source: U:advanced-tam-sourcing-techniques ("Multi-Factor Scoring Models", "Tiered Account Routing").

### W-053 Three-table ABM with brand mentions

- Table 1: named-account contacts from the CRM on a schedule, with a normalized LinkedIn URL, ABM stage and grade. Table 2: a daily Find Post search for your domain or category, AI-classified, poster enriched and matched to CRM domains. Table 3: look up stage by LinkedIn URL and write stage changes back to the CRM.
- ABM means 100 to 2,000 accounts at most.
- Kit: `ui-only`.
- Source: U:claybm-abm-in-clay-signals-abm ("The Three-Table ABM Architecture").

### W-054 Job-change detection on the CRM

- Pull CRM contacts with LinkedIn URLs (a waterfall finds missing ones from email), enrich current employer, compare its domain to the CRM's, flag mismatches, route to the owner, update email and title.
- Kit: `ui-only`; the CRM writes are the CRM's own actions.
- Source: U:crm-enrichment ("Use Case 3").

## CRM, Sheets and exports

### W-060 Lookup before create, every time

- CRM integrations > Lookup Contact by email (name is a weak fallback), optionally an AI formula comparing email domain to company domain, then Create or Update Contact with a conditional run "lookup returned no contact ID". Test 10 rows.
- Update only when the field is empty, the new value is newer, confidence clears a bar, or the source outranks the old one. Never overwrite manually kept fields.
- Turn off auto-update while building and push small batches by hand.
- Kit: `ui-only`.
- Source: U:exporting-to-crm; U:clay-x-hubspot-actions-crm-enrichment ("Setting Up Conditional Logic").

### W-061 Salesforce specifics

- Test in a sandbox: Settings > Connections > Salesforce test environment.
- Imported objects do not all show in cell details; add a Salesforce Lookup by CRM ID, then Add as column.
- Upsert on an external ID replaces lookup-then-create. A SOQL action handles one-to-many pulls (opportunities per account); have a model write the SOQL. Convert Lead turns a lead into contact, account and optional opportunity.
- Kit: `ui-only`.
- Source: U:clay-x-salesforce-actions-crm-enrichment.

### W-062 Google Sheets actions

- Paid plans only. Add Enrichment > Google Sheets > Add Account. Actions: Add Row; Lookup Row; Lookup, Add, or Update Row (keyed on email or domain). Paste the sheet URL, pick the tab, map columns with "/".
- Kit: `ui-only`.
- Source: U:exporting-to-google-sheets.

### W-063 Clean CSV exports

- Actions > Export > Download CSV; past files under Available Exports. The CSV mirrors the table: object fields lose their raw values and "run condition not met" cells export blank.
- Duplicate the view, hide intermediate columns, export that view.
- Kit: `ui-only`; for reads, `chewbacca clay rows` returns every cell as JSON without an export.
- Source: U:download-as-a-csv-clay-101 ("Cleaning Up Your Exports").

### W-064 Inbound through a webhook table

- Import > Pull in data from a Webhook, copy the URL into the form or tool; Typeform has a native import. One webhook table holds 50,000 submissions, then needs a new table.
- Route inbound into Clay before the CRM so enrichment and routing are not waiting on sync lag.
- Kit: `ui-only`.
- Source: U:connecting-lead-sources-inbound-automation.

## Sequencer (Clay's own email sending)

### W-070 Buying sending domains and inboxes

- Campaigns > Email accounts > Add email account > buy managed accounts. Use the sizing helper (weekly sends to domains; 400 a week came back as two).
- Gmail or Outlook mix matches prospects' providers; Clay reads each prospect's DNS and sends from a matching account. About 3 inboxes per domain, 5 at most; put reps' names on the personas so replies route to them.
- Set the forwarding domain to the real site. Paid in credits, created in about 48 hours, warm for three weeks.
- Two one-way doors: no more inboxes on those domains later, and the forwarding domain is fixed.
- Kit: `ui-only`.
- Source: U:buying-domains-and-email-accounts-in-clay.

### W-071 Bringing your own inbox, and its silent failure

- Only for primary-domain sends to warm prospects, or for very large senders. Use Gmail or Outlook OAuth, not SMTP. A Workspace admin must mark Clay Sequencer as a trusted app for warmup.
- OAuth connections break without any alert; check the accounts table for auth errors by hand.
- Kit: `practice`.
- Source: U:bringing-your-own-inbox-or-domain ("The Maintenance You're Signing Up For").

### W-072 Campaign context, variables and fallbacks

- The campaign goal box holds the goal and house style rules (no em dashes, banned phrases). Company description, ICP and personas come from AI business context; attach docs or a Skill.
- Insert lead variables with "/". Each variable has Format, Sanitize (strips emoji and symbols) and Require variable data. Required means a lead missing the field is not enrolled; otherwise set a fallback value.
- Kit: `kit-read` for `chewbacca clay campaign ws=... campaign=...`; editing is `ui-only`.
- Source: U:ai-context-and-variables.

### W-073 AI snippets, spintax and a fixed CTA

- One agent writes every snippet with the whole sequence in view. Preview across several leads; near-identical output means thin context.
- Keep the CTA and middle hard-coded; let the model write the opener.
- Cost: one action per lead sequenced and one more per message using AI.
- Spintax {a|b|c} with 2-5 options for greetings, transitions and sign-offs, never the CTA.
- Kit: `kit-read` for `chewbacca clay campaign-variants`.
- Source: U:ai-snippets-and-spintax.

### W-074 Sequence shape and the spam check

- Add message; delay 1-10 days; Send as reply threads, off starts a new subject. Four messages is a hard cap. Clay's default: opener, threaded bump, breakup on a new thread.
- Spam check scores copy 0-100 live and names what costs points; 100 is a floor, not a deliverability guarantee.
- Kit: `kit-read` for `chewbacca clay campaign`.
- Source: U:building-a-sequence.

### W-075 A/B in Sequencer

- A/B test in the campaign editor creates variant B; test body or subject; reset removes a test; compare splits analytics. There is no significance test and no minimum sample: export and do the math. Rolling out the winner sends it to everyone not yet sequenced.
- Kit: `kit-read` for `chewbacca clay campaign-variants ws=... campaign=...`; `gtme-math` for the significance check.
- Source: U:a-b-testing-your-message ("What This Doesn't Do").

### W-076 Reading campaign health

- Analytics tab: processed, enrolled, completed; per-step conversion shows whether follow-ups earn anything. Categories are triage, not a record; track positive reply rate.
- Recipient bounce at 1%+ means fix the data. Sender bounces clustered on one domain mean the domain is worn out.
- Workspace Analytics: first touches versus follow-ups (follow-ups rising while first touches fall means segments are starving); the sender bounce table with "Show individual accounts" finds one bad inbox dragging a domain. Rotation is manual; check weekly.
- Pause is for editing. Complete is permanent.
- Kit: `kit-read`: `chewbacca clay campaign-stats`, `campaign-analytics`, `campaigns`.
- Source: U:campaign-analytics-and-actions; U:global-analytics.

### W-077 Global inbox and blocklist

- Inbox: campaigns, replies, conversation; filter by category and work interested and meeting requests first. A reply goes out from the account that sent the original.
- Blocklisting an address or domain stops all mail from the workspace for good; do it the same day someone opts out.
- app.clay.com/rep gives reps only their assigned accounts and replies.
- Kit: `kit-read`: `chewbacca clay inbox`, `thread`, `blocklist`; `blocklist-add` is a gated write a person types at a terminal.
- Source: U:global-inbox.

### W-078 Events table automations

- The Events tab streams every send, bounce, reply and category change into a Clay table. Any automation on it needs a run condition (event type is EMAIL_REPLY) or it fires on every send.
- Pre-built actions: Reply to lead email, Add email to blocklist (for do-not-contact categories), Get rep email, Forward email. Clay's advice: reply by hand until you know your replies; let Clay draft and a person approve in Slack.
- Kit: `kit-read` for replies; the actions are what the Zeutara autopilot workflow nodes use.
- Source: U:automating-campaign-events.

### W-079 Workflow campaigns from an agent

- The Clay agent plugin needs a campaign of type workflow campaign created in the UI first, named exactly as in the prompt. A draft cannot accept enrollments, so a person presses Launch campaign; nothing in a prompt can. Test with one record, then check Workflows > runs and campaign analytics.
- Kit: `ui-only`; launch-guard refuses this for agents in the kit.
- Source: U:create-a-campaign-with-the-agent-plugin.

### W-080 Deliverability basics Clay teaches

- Reputation attaches to the domain, not the address, so a bad campaign cannot be quarantined to one inbox. Spam and phishing reports put a domain in jail, including its invoices.
- Cold sends: bought lookalike domains, about 20 a day per inbox, plain text first email, weekday business hours with gaps, varied copy.
- Kit: `practice`.
- Source: U:how-email-deliverability-works; U:how-cold-outbound-email-works.

## Ads

### W-085 Syncing a segment to LinkedIn and Meta

- Segment > Send > sync to ad platform. The sync name becomes the platform audience name. 300 people is the floor and one platform can reject while another accepts.
- The red suppression count is compliance: Clay-sourced records only go to US audiences, and Google takes first-party data only. Set the schedule to recurring or the platform keeps a snapshot.
- Match tier Best, Good or None; mapping personal email fields adds identifiers; work email or LinkedIn URL lifts match rate most. Match rate arrives in about 48 hours.
- Kit: `ui-only`.
- Source: U:building-your-first-ad-audience.

### W-086 Self-maintaining exclusion list

- People audience filtered to customers, employees, open opportunities and closed lost; Clay suppresses by contact, not account. Sync recurring; apply it as an exclusion inside the LinkedIn campaign or the Meta ad set; wait 48-72 hours.
- Over-inclusion is the safe error on an exclusion list and the costly one on an inclusion list.
- Kit: `ui-only`.
- Source: U:exclusion-list-strategy.

## Copy

### W-090 Snippets assembled by formula

- Generate the subject, intro and PS as separate AI columns from research columns, then join them with a formula column into the message. Modular columns are easier to audit than one generated email.
- Kit: `formula` plus `ui-only` AI columns.
- Source: U:create-personalized-content-at-scale ("Implementation in Clay").

### W-091 Twain for a whole sequence

- Twain enrichment: a predefined 1-4 step sequence or your own Twain sequence ID; prospect description, signal, ICP and problem as parameters; first name, last name and LinkedIn URL as inputs; map each step to a column.
- Kit: `ui-only`.
- Source: U:create-multi-step-sequence-messaging-with-twain.

## Clay inside chat tools (MCP)

### W-095 Search, filter, then enrich

- Connect: claude.com/connectors (or Customize > Connectors) in Claude, @clay or Settings > Connectors in ChatGPT; 500 free credits. Add "use Clay" to a prompt so the tool does not fall back to web search.
- Pattern: broad find at one company, narrow (director and up, US, joined in the last year), then enrich only those. Results come 20 at a time; volume belongs in the app.
- Use domains, not names; one company per chat except head-to-head comparisons. Typing the same prompt repeatedly means it belongs in a table.
- Kit: `practice`.
- Source: U:find-and-verify-contact-info-for-any-prospect; U:best-practices-for-clay-in-chatgpt; U:creating-your-own-use-cases-in-chatgpt-with-ai.
