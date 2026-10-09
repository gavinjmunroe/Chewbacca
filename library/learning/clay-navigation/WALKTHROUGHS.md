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
`YT:` is `https://www.youtube.com/watch?v=` with a timestamp in seconds, and `W:`
is any other web page, given as host and path.

Coverage is honest about depth. Clay University lessons, core docs and claybooks
were read in full. The 196 integration docs were skimmed for limits, costs and
gotchas, not read line by line. Video transcripts were mostly blocked by
YouTube's rate limit on 2026-10-09; `LEDGER.tsv` marks each one `BLOCKED` or
`empty` with the reason, and only the seven that landed are cited as `YT:`.

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

### W-101 Two meters: actions and data credits

- Actions count orchestration: one per enrichment, AI run or exported record, even on your own provider key. Data credits pay providers and vary by data point, roughly 0.5 to 10+; a fully enriched record lands around 6-20.
- No actions for list sourcing (Find People), CRM, warehouse or webhook imports, formulas, filters, Send Table Data, lookups, or CSV export. Sequencer charges one action per lead enrolled, not per email.
- Your own provider key costs actions but no data credits; Clay puts the data-credit saving at 50-80%.
- Actions do not roll over; data credits roll over up to twice the monthly amount. Top-ups carry a premium (30% on modern plans).
- Kit: `kit-read`: `chewbacca clay credits ws=...`, `chewbacca clay credit-usage ws=... days=7`.
- Source: D:actions-data-credits; D:workspace-administration-documentation ("Understanding actions and data credits").

### W-102 Find where the credits went

- Account name > Usage: Balance, Workbooks (with a Recurring flag and CSV export), Workflows, Integrations, Signals, MCP per user, API. Per table: Credits popover > Table credit usage, or History, by time, column or run; drag across the spend chart to zoom into a spike.
- The pre-run warning appears only when a run is at least 5% of the monthly budget and over 500 credits, so smaller waste never warns.
- Usual culprits: stopped runs still charge for what ran, auto-run, AI columns, re-runs.
- Kit: `kit-read`: `chewbacca clay credit-usage ws=... days=7`, then `chewbacca clay columns table=t_...` on the top table.
- Source: D:credit-usage; D:actions-data-credits.

### W-103 Caps that actually stop spend

- Enterprise Budgets (name, limit, reset never, monthly, quarterly or annual at midnight UTC) cap data credits only, not actions. A blocked run does not resume after the reset, and a cancelled run is charged up to the cancel.
- A workbook credit limit and a budget both apply; functions and Claygents charge the calling workbook.
- Some sources carry their own cap: web intent has a monthly cap on the connection; HG Insights and TrustRadius take a maximum credit cost per run and truncate results.
- Kit: `practice`.
- Source: D:credit-budgets; D:credit-spend-limits-faq; D:website-tracking ("How do I cap what web intent spends?"); D:hg-insights-integration-overview; D:trustradius-integration.

### W-104 AI model pricing and how to price a prompt

- About 80% of models (Neon, Helium, Argon among them) have a fixed price; reasoning models are variable with no markup. Variable runs withhold an estimate per row, reconcile and refund the surplus; a zero balance stops the run and keeps finished rows.
- Use AI in content mode is cheap (the demo picker showed 0.1 credit); Claygent web research is mostly variable. Run a complex research prompt on 10 or 50 rows to learn the real per-row charge.
- Own keys for Claygent research need high provider tiers (OpenAI Tier 2+, Anthropic Tier 4+) or they rate-limit, and their spend never shows in Clay.
- Kit: `practice`.
- Source: D:ai-pricing; D:ai-tokens; YT:oCIBPDtKNYo&t=1002.

### W-105 Check refund behavior before a big run

- Many providers refund an empty row (Crunchbase, Explorium, Beauhurst, Leadfeeder, Magellan, GovSpend, Lusha headcount growth). Some do not: Aviato charges unless its Require toggle is on, Pubrio refunds only when the request itself fails, BetterContact charges catch-alls.
- Kit: `practice`.
- Source: D:aviato-integration; D:pubrio-integration; D:bettercontact-integration; D:explorium-integration; D:crunchbase-integration.

### W-106 Filter before rows exist, qualify before you enrich

- Find Companies AI filters (sub-industries, revenue streams, business types) cut rows before you pay; pulling a big list and qualifying it with enrichments pays for rows you throw away. The technographic filter in search costs 3 credits per company returned, the same as enriching afterward.
- Score with a cheap AI column first and gate paid columns on the result; ConnectWise kept its paid enrichment column on manual so a bulk import could not fire it.
- Kit: `practice`.
- Source: D:finding-companies-and-people-in-clay; CB:enrich-and-score-event-signups; CB:how-connectwise-uses-clay-to-keep-their-account-database-clean.

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

### W-111 Run a people search only for qualified companies

- Search sources take no run condition. Build a filtered view of the company table showing only the rows you want, then run Find People from that view; it processes only visible rows.
- In-table Find People can read a per-company location column. Its reduced-data mode returns up to 500 people per row with name and LinkedIn URL only, so enrich afterward.
- Limits: 50,000 records per source; Find People up to 50,000 total and 100 per company; up to 3 exclusion sets of 300,000 people (needs profile URLs).
- Kit: `ui-only` (`find-people`).
- Source: D:finding-companies-and-people-in-clay; D:find-people-overview.

### W-112 Find Companies precision settings

- Keywords accept quoted exact phrases; a semantic company description ranks results; up to 3 exclusion sets of 300,000 companies; result limit 10,000; domain filters (has a domain, domain is live, redirects).
- Find People title modes: "is similar to" (synonyms and translations), "contains", "is exactly" (case-sensitive).
- Kit: `ui-only`.
- Source: D:find-companies; D:find-people-overview.

### W-113 Search (open beta) and saved searches

- Find leads > People or Companies; a plain-language box or Filters with an Editor or Query toggle. Cross-entity filters work (companies hiring 5+ engineers that have a Head of RevOps). Filtering is free; save to a one-time table or to an Audience, which lands as a draft first.
- Save a search with a name before importing; Browse past searches shows yours, recents and the workspace's.
- Hiring, news and funding are filters on people or companies, never results of their own; say which of the two you want back.
- Kit: `ui-only`.
- Source: D:search; D:saved-searches; D:using-clay-plugin ("Play 1").

### W-114 Local businesses at scale without hitting the row cap

- Serper's Google Maps results by city list and industry, written across three tables so none passes 50,000 rows; Claygent finds the owner from the website (no website, no run), then the email waterfall.
- US SMBs by footprint: Enigma resolves the company, returns up to 100 operating locations and a count, then formulas tier 1, 2-5, 6-20, 21+ locations and spread across one state, 2-3, or 4+, giving six messaging groups.
- Kit: `formula` for the tiers; sourcing is ui-only.
- Source: CB:turn-google-maps-listings-into-a-target-account-list-with-contacts-and-emails; CB:segment-smb-prospects-by-physical-footprint-with-enigma; D:enigma-integration.

### W-115 Lookalikes from customer seeds

- Lusha Find Company or People Lookalikes as a table source: 5-100 seeds (10+ advised), up to 500 exclusions such as existing customers, up to 5,000 results by default. Enrich and ICP-score before anything reaches a sequencer.
- Kit: `ui-only`.
- Source: CB:turn-closed-won-accounts-into-net-new-pipeline-with-lusha-lookalikes; D:lusha-integration.

### W-116 One PE firm into its whole portfolio

- PE firm domains (domains match better than names) > Magellan Enrich PE portfolio companies (it returns the full portfolio or nothing, so set the size threshold above the portfolio) > write the list to rows in a new table > enrich size band, industry, country > AI fit score with a one-line reason > filter at 4 or above. One firm returned 186 companies.
- A win at one portfolio company is the reference for the rest.
- Kit: `ui-only`.
- Source: CB:turn-one-pe-firm-into-hundreds-of-qualified-accounts; D:magellan-data.

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

### W-121 Work Email waterfall settings that save credits

- Tools > Work Email > Quick setup or Full configuration. Turn on Infer Email: a free first step builds first.last@domain and stops the waterfall if validation passes (Clay saw about 31% valid on a software dataset). Test patterns on about 10 rows.
- Validation strategy: Conservative for cold email, Balanced accepts catch-alls, Aggressive for coverage. Require validation success; Threshold for duplicate results stops when providers keep returning the same failing address.
- Output the successful provider's name so the order can be tuned later.
- Kit: `ui-only` (configure-column); `chewbacca clay columns table=t_...` reads the order, `chewbacca clay table-status ws=... table=t_...` the coverage.
- Source: D:work-email-waterfall.

### W-122 What "valid" means per validator

- Statuses: valid, invalid, catch-all, unknown (retry), role-based. ZeroBounce and Debounce count catch-all or risky as valid unless Safe to Send is on. Lusha returns a confidence score to threshold on.
- Clay's work-email test scored a wrong-person email below an empty cell; enterprise traps were shared addresses, subsidiary versus parent domains, and legacy aliases.
- Kit: `practice`.
- Source: D:email-verification-statuses; D:zerobounce-integration-overview; D:debounce-integration-overview; D:data-test-work-email-providers; CB:enrich-contacts-with-verified-emails-direct-dials-via-lusha.

### W-123 Phones: what Clay's own test found

- 6,000 contacts returned about 9,800 numbers and only 23% scored good. Use a phone waterfall, then verify: Trestle for line activity and litigator checks (0.6 each), SureConnect for likely-to-answer (2-3 hours, up to a business day).
- Personal email test: 53% returned, 43% correct.
- Phone DNC via Meer (an admin accepts its terms first); Lusha returns a DNC flag per number.
- Kit: `practice`.
- Source: D:data-test-methodology-mobile-phone-region; D:data-test-methodology-personal-emails; CB:find-verified-phone-numbers-likely-to-answer-with-only-an-email; D:sureconnect-integration-overview; D:trestle-integration; D:meer-integration.

### W-124 Child columns and list references

- Click a cell > Cell details > hover an endpoint > Add as column, or map it to an existing column (which overwrites it).
- In prompts, "/" references a whole enrichment, a list, a zero-based index, or an endpoint like experience[0].url. Marking a reference "Required to run" skips rows where it is empty.
- List cell actions: filter, turn items into rows in another table, combine into one text field, ask AI.
- Kit: `ui-only`.
- Source: D:table-columns-overview; D:referencing-dynamic-data-from-other-columns; D:manage-cell-data.

### W-125 Cell size limits

- Text and formula cells hold 8 KB, action cells 200 KB; a waterfall's final column is a basic cell. Gong transcripts, full BuiltWith stacks and raw HTTP responses overflow: return field paths or extract keywords. The Gong action takes one call ID at a time.
- Kit: `practice`.
- Source: D:manage-cell-data; D:gong-integration-overview.

### W-126 Two models and an arbiter for a fuzzy label

- Rate with two models, average when they agree, flag when they differ by two or more levels, and let a reasoning model pick the stronger explanation.
- Split detection from description: detect on the narrowest text (agent messages only), describe only flagged rows. Clay reported fewer hallucinations.
- Kit: `practice`.
- Source: CB:classify-ticket-complexity-to-prioritize-route-and-improve-support.

### W-127 Research prompts feed decision prompts

- Several narrow research prompts (what they do, what they sell, pricing model, who they serve) feed one decision prompt per label (is_saas, is_b2b). Swap the definitions for your category.
- Kit: `practice`.
- Source: CB:clean-crm-with-names-domains-headcount-and-acquisitions; CB:how-connectwise-uses-clay-to-keep-their-account-database-clean.

### W-128 Inbound form enrichment in five columns

- Claygent person research from name and email into one CRM-note paragraph (title, industry, decision maker, what the company does); Claygent company research for funding, launches, acquisitions; Use AI in content mode sorts into persona 1, 2 or 3 by how many ICP criteria match; CRM create record with the notes and persona; then a sequence.
- Kit: `ui-only`.
- Source: YT:oCIBPDtKNYo&t=324 (the five steps); YT:oCIBPDtKNYo&t=982 (the qualification prompt).

### W-129 Parent and subsidiary hierarchies

- Clay's Enrich account hierarchies (beta): Clay company ID preferred; parents all, immediate or ultimate; subsidiaries all or immediate; limit 500 by default, 10,000 max; refunded when empty; best for 50+ employees. HG Insights Find company corporate structure takes an HGID or domain; write each child to its own row.
- Terms: group HQ is the ultimate parent, corporate parent the next layer up, domestic parent the same-country parent, subsidiaries where users sit.
- Plays: references across sister subsidiaries, contract consolidation, never pitching connected companies as if they were separate.
- Kit: `ui-only`.
- Source: D:account-hierarchies; YT:YS6bbhm1tn0&t=136; YT:YS6bbhm1tn0&t=308.

### W-130 HG Insights or a cheap tech-stack provider

- Scraper-based providers (BuiltWith, 2 credits) see website tags; HG Insights reads documents and filings, so it sees product lines, spend and contracts, at about 8 credits per technology. Pay for HG on high-touch deals, complex enterprises, or when renewal timing matters.
- Kit: `practice`.
- Source: YT:baZjV42exMQ&t=44; YT:baZjV42exMQ&t=222; D:builtwith-integration-overview.

### W-131 Domain risk check before a send

- Google MX Records enrichment (no MX means no inbox; a very low TTL is a red flag), WHOIS age and expiry, Hunter for catch-all and trap domains, then one Domain Red Flags column; send clean rows, and route catch-alls to a second validation flow.
- Kit: `formula` for the red-flag column.
- Source: CB:domain-deliverability-check.

## Tables, runs and limits

### W-201 Auto-run at three levels

- Table auto-run is the master switch; a column's auto-run only matters when the table's is on; "Keep existing results" lets only empty, errored or new cells run. Turning it on asks: continue without running, or update cells.
- Building: table auto-run off, 5-10 sample rows, run by clicking cells, then switch it on.
- Kit: `kit-read`: `chewbacca clay table table=t_...` shows AUTO_RUN_ON and AUTO_RUN_MODE.
- Source: D:table-management-settings.

### W-202 Dedupe, automatic and manual

- Auto-dedupe rows on one column, keeping the oldest or newest row; blanks and cells over 200 characters are skipped. Column Dedupe deletes for good and matches exact strings, case- and whitespace-sensitive, so normalize into a formula column first (lowercase, trim, strip protocol and www).
- Kit: `formula`.
- Source: D:table-management-settings; D:table-columns-overview.

### W-203 Sandbox mode for a table

- Toolbar Sandbox Mode copies the top 10 rows (up to 50); production turns read-only and outbound actions are disabled. Review changes, then Publish and don't run or Publish and run; sandbox results carry over without a second charge.
- Kit: `ui-only`.
- Source: D:sandbox-mode.

### W-204 Versions and history

- History > Save table configuration before restructuring; Clay also snapshots after about 15 idle minutes, and a restore keeps a pre-restore snapshot. Only structure comes back: cell data is never restored, and restored columns apply to new rows until re-run. Retention 30 days on Launch and Growth, 180 on Enterprise.
- Kit: `ui-only`.
- Source: D:table-versions; D:table-management-settings.

### W-205 The 50,000-row wall

- Every table and source stops at 50,000 rows without an error (Salesforce reports at 2,000). A webhook counts 50,000 submissions even after rows are deleted.
- Options: split by filter or date across tables; Enterprise auto-delete for webhook, Send Table Data, signal or Audiences sources; bulk enrichment; or Audiences.
- Editing a source's filters after a run does not reprocess old rows; re-run or duplicate the table.
- Kit: `kit-read`: `chewbacca clay table table=t_...` for the row count.
- Source: D:sources; D:auto-delete; D:webhook-integration-guide.

### W-206 Table alerts

- Enterprise, free: column failure rate (75% default), row count (45,000), data inactivity (1 day, for signal, scheduled and webhook tables). Mute noisy upstream columns; email or Slack; one alert per type per table per day.
- Kit: `kit-read`: `chewbacca clay table-status ws=... table=t_...` gives the same error counts on demand.
- Source: D:table-alerts.

### W-207 Scheduled columns and sources

- Schedule icon > Re-run columns on a schedule (hourly on Enterprise, daily, weekly, monthly). A source on a schedule with Update existing rows on refreshes every row (more credits; turn off Keep existing results) or off for net-new only. 100 scheduled tables on Launch and Growth, 1,000 on Enterprise.
- Kit: `kit-read`: `chewbacca clay table table=t_...` lists scheduled runs.
- Source: D:scheduled-columns; D:scheduled-sources; D:table-management-settings.

### W-208 Send Table Data and lookups

- Send Table Data pushes: Send row (re-sends update the same destination row unless Update existing rows on re-run is off) or Send row for each item in a list (always new rows). At most 20 connected tables, one direction only; read back with Lookup Single or Multiple Rows. Write to Other Table was deprecated in December 2025.
- A Lookup Multiple Rows on the same table finds repeats (the count includes the row itself); gate downstream work on a count of 1.
- Neither costs an action.
- Kit: `ui-only`.
- Source: D:send-table-data; D:lookup-rows; D:write-to-table-integration-overview.

### W-209 Infinite loops

- Causes: a webhook writing into its own table, circular writes across tables, auto-run on a column's own output, two-way API sync. Fixes: a status column (Not Sent to Sent) with "only run if processed is empty", one-way flow, 5-10 row tests.
- Symptom: credits draining while columns never stop running.
- Kit: `kit-read`: `chewbacca clay table-status ws=... table=t_...` (running counts that never settle) and `chewbacca clay credit-usage ws=...`.
- Source: D:infinite-loops.

### W-210 Formulas are JavaScript

- Column tokens like {{Email}}, Lodash as `_`, moment, FormulaJS; && || ! with parentheses. Choose "Save and don't run enrichments" when editing a formula so downstream paid columns stay put.
- Domain from email: `{{Email}}?.split("@")[1]?.trim().toLowerCase()`. Clear a Salesforce number field with `{{Employees}} ?? null`, since Ignore blank values only skips text.
- Kit: `formula`.
- Source: D:formula-generator; D:logical-operators; D:salesforce-integration-overview.

### W-211 HTTP API column without the 400

- Method, endpoint, query params, JSON body: string tokens go inside quotes, numbers without. Save auth as an HTTP API (Headers) account so the key is not plain text in the table. Return only field paths you need. Set a rate limit (10 per 1,000 ms, say). Test one row.
- Errors: 400 is quoting or hidden characters pasted from docs, 401 credentials, 403 scopes, 404 URL, 429 means set the rate limit. Token APIs such as Gong use the HTTP API JWT Auth account, refreshed about every 55 minutes.
- Kit: `ui-only`.
- Source: D:http-api-integration-overview; D:http-api-with-jwt-authentication-integration-overview.

### W-212 HTTP API as a source, with pagination

- Import data from an HTTP API; the results path must point at an array. Pagination by query parameter ($page, $offset, or a cursor path), body parameter, or a next-URL field; it stops on an empty page or a falsy has_more path, and at 50,000 rows.
- A paginated site with no API: one row per page number, a formula builds each URL, scrape it, then send rows to a new table.
- Kit: `ui-only`.
- Source: D:http-api-integration-overview; CB:extract-data-from-paginated-databases-in-seconds.

### W-213 Webhooks in and out

- In: Webhooks > Monitor webhook > copy the URL; an optional auth token is shown once. Out: an HTTP API POST to a Zapier, Make or n8n catch hook; a 200 confirms.
- Patterns: an Intercom ticket opens, Clay enriches the person and posts a note back through Intercom's API; a Gong webhook sends call IDs and an HTTP API column pulls the transcript.
- Kit: `ui-only`.
- Source: D:webhook-integration-guide; D:clay-to-zapier; CB:instantly-enrich-intercom-support-tickets-every-time-a-new-one-gets-opened; CB:find-specific-feedback-in-gong-calls-and-route-it-to-the-right-teams-via-slack-automatically.

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

### W-141 Workflow nodes and what each costs

- Run enrichment: 1 action plus the enrichment's credits, one action only, so wrap a waterfall in a function. Run function: no added cost. Run Claygent: 1 action plus AI. Update audience members: free. Conditional: rules and code are free, an AI branch costs about one action. Run code: Python, free, one-second ceiling, not on the free plan. Delay: 60 minutes at most.
- Triggers: Run manually, New member in segment, Segment on a schedule, On a schedule, On a signal, On webhook call, On CSV upload, Source on a schedule.
- Kit: `kit-read`: `chewbacca clay workflows ws=...`.
- Source: D:workflows; D:using-clay-plugin ("Choosing when a play runs").

### W-142 The silent wiring bug in workflows

- A tool step's output is wrapped: read `$.toolResult.result.name`, not `$.name`. The missing prefix hands the next step an empty value with no error. Run once and read the real output shape.
- Pin exact values (scores, IDs, booleans) to a node and field rather than letting a Claygent fill the placeholder.
- A Code conditional routes with `context.transition_to('Node name', 'label')` written as literal strings, and has no Otherwise branch.
- Kit: `practice`.
- Source: D:workflows ("Connecting nodes", "Routing to several branches in code").

### W-143 Testing and publishing a workflow

- A single-node run (recent data or typed values) carries a Partial badge and stops there; prove a whole path with Run manually on one record. Runs take about 30 seconds to appear.
- Each run keeps the version it started on, so a fix only reaches the next run. Publish names a version and turns triggers live; Run on all members now shows a backfill estimate.
- There is no whole-graph estimate: run a small batch and read the real credits. A fast-changing segment fires thousands of runs, so use Segment on a schedule there.
- Kit: `kit-read`: `chewbacca clay workflows ws=...` for last run and stats.
- Source: D:workflows; D:workflow-faqs.

### W-144 Workflow, table or bulk enrichment

- Workflow for triggered, per-record plays that branch (routing, signal-based outbound). Table for exploring and prototyping with every cell visible. Bulk enrichment for the same enrichments across a large existing set.
- Runs share state only through Audiences; a workflow cannot call another (use functions); loops become schedule triggers; joins happen in Run code after loading each source.
- Kit: `practice`.
- Source: D:workflow-faqs.

### W-145 Functions, the parts the first lesson skipped

- Edit function is a sandbox: add test inputs, replay recent inputs, debug archived rows, then Review Changes and Publish Changes. There is no version history. Passthrough removes the row limit; credits charge the calling table; a formula-only function costs nothing.
- Managed functions: Detach and edit is permanent; Duplicate as custom keeps the managed copy.
- Kit: `ui-only`.
- Source: D:functions; D:managed-functions.

### W-146 Audience imports and matching

- Each import matches on one identifier (people: email, phone, profile URL or external ID; companies: domain, profile URL, exact name or external ID); records sharing that value merge.
- A Salesforce SOQL subset needs SystemModstamp and IsDeleted and takes no LIMIT or aggregates. A table reaches an Audience through an Upsert segment record column.
- Enrichments on one audience run in parallel and cannot read each other; chain them in a workflow or a table.
- Kit: `kit-read`: `chewbacca clay audiences ws=...`, `chewbacca clay audience-records ids=...`.
- Source: D:audiences; D:audiences-faqs-and-best-practices.

### W-147 Clay's CLI for audiences

- `clay whoami`; `clay audiences fields list --entity-type people` (filters key on field ids); `clay audiences records search-count` to check fill rate before paying to enrich; `clay audiences records search-ids --query 'select from opportunities where is_won = true order by amount desc'`; `records get --ids` takes 100 per call. Reads are free; writes go through the upsert workflow action.
- Kit: `kit-read` (the kit's audience ops call the same CLI).
- Source: D:audiences-for-agents; D:clay-api-cli.

### W-148 Prompting the agent plugin

- Say who you are and what the list is for; settle tie-breakers and exclusions up front; state the quality bar (a blank beats a guessed email); ask for a plan and a cost estimate and approve with a cap; name what gets built.
- Count what the workspace already holds first, which is free. A silent agent is working; resending doubles work and spend.
- Kit: `practice`.
- Source: D:using-clay-plugin ("Writing a prompt an agent can act on", "Keeping an agent on budget").

### W-149 Account Agents

- An Account Agent step needs an account-segment trigger (new member or segment on a schedule); start with 10-25 accounts; ask for discrete typed output fields; there is no spend cap inside workflows yet.
- Kit: `ui-only`.
- Source: D:account-agents-in-workflows; D:account-research-agents.

## Signals, scoring and ABM

### W-050 Custom signal from any enrichment

- Send the monitored value plus a timestamp to a history table; schedule re-runs of that column in Table Settings; a formula compares the latest value with the previous; on change, fire Slack, CRM or a sequence.
- Validate a candidate first: public or in your systems, changes often, correlates with buying, actionable within 24-48 hours, not tracked by competitors.
- Kit: `kit-read` for `chewbacca clay signals`; scheduling is `ui-only`.
- Source: U:advanced-tam-sourcing-techniques-tam-sourcing ("Building Custom Signal Systems"); U:building-custom-signals-in-clay.

### W-051 Signal stacking and velocity

- Sequential (ordered journey), parallel (N of M signals) or hybrid. Date-stamp every signal and compute days between first and latest; compressed timing means urgency.
- Point scores with the native Score Row; AI scores (1-100 with an explicit ICP description) for messy text. Log initial score, triggering signals, time to first conversation, outcome and deal size to recalibrate.
- Kit: `formula` for velocity; `practice` for the rest.
- Source: U:advanced-strategies-with-signals-signals-abm.

### W-052 Weighted account score and tiers

- Example weights: growth 20, tech fit 25, recent funding 15, executive change 10, competitive position 30. Tiers: 80-100 senior rep with custom research, 60-79 standard sequence, under 60 nurture.
- Kit: `formula`.
- Source: U:advanced-tam-sourcing-techniques-tam-sourcing ("Multi-Factor Scoring Models", "Tiered Account Routing").

### W-053 Three-table ABM with brand mentions

- Table 1: named-account contacts from the CRM on a schedule, with a normalized LinkedIn URL, ABM stage and grade. Table 2: a daily Find Post search for your domain or category, AI-classified, poster enriched and matched to CRM domains. Table 3: look up stage by LinkedIn URL and write stage changes back to the CRM.
- ABM means 100 to 2,000 accounts at most.
- Kit: `ui-only`.
- Source: U:claybm-abm-in-clay-signals-abm ("The Three-Table ABM Architecture").

### W-054 Job-change detection on the CRM

- Pull CRM contacts with LinkedIn URLs (a waterfall finds missing ones from email), enrich current employer, compare its domain to the CRM's, flag mismatches, route to the owner, update email and title.
- Kit: `ui-only`; the CRM writes are the CRM's own actions.
- Source: U:crm-enrichment ("Use Case 3").

### W-155 Topic intent

- Providers: Bombora (companies, premium), Delivr (companies and people, medium and high only), Intentsify. Provider choice locks once the signal exists; weekly is the fastest cadence; a monitored view must hold under 250,000 records.
- Tiers by raw score: High 60+, Medium 40-59, Low under 40. Sourcing charges per result per matched topic; monitoring charges per topic per record checked.
- Read intent as a priority cue combined with fit, not a deal probability.
- Kit: `kit-read`: `chewbacca clay signals ws=...`.
- Source: D:topic-intent.

### W-156 Web intent without overspending

- Snippet before the closing body tag on every page. Filter for 20-30 second sessions and several pages; use the waterfall de-anonymizer, not best match; IPs cache 30 days. Paths are exact (/blog and /blog/ differ; /blog/* for children). Cap monthly spend on the connection. It resolves accounts, not people.
- Kit: `ui-only`.
- Source: D:website-tracking.

### W-157 Job changes three ways

- The Job Change signal on a contacts table (1 action plus 0.2 data credits per check); Monitor for Job Changes on target-account contacts (3, 6 or 12 month window, on a schedule); or formulas on LinkedIn enrichment for "new role within N months" and "new role and new company".
- Former bosses of recent movers just lost someone and may need help.
- Kit: `kit-read`: `chewbacca clay signals ws=...`.
- Source: D:job-change-signal-overview; CB:signals-monitor-job-changes-at-target-accounts; CB:find-prospects-who-changed-companies-using-formulas; CB:find-contact-information-for-job-movers-and-their-former-bosses.

### W-158 Stack signals into one flag

- A Claygent website signal (active blog, PLG, demo page) plus GTM hires in the last 3 months plus open roles in your problem area, and one formula that flags rows matching all of them, rescheduled weekly. Every competitor buys the single signals.
- Hiring maps to need: AE openings mean pipeline pressure, HR openings mean recruiting work.
- Kit: `formula`.
- Source: CB:stack-custom-website-signals-recent-hires-and-job-openings; YT:ylXLZQvZXIA&t=184.

### W-159 Lusha and PredictLeads signal enrichments

- Lusha signals charge per result, so set topic filters and max departments before running; the promotion and company-change booleans make good run conditions; a traffic decrease is a churn cue.
- PredictLeads news and jobs, filtered against a "your use case" column, feed a one-sentence opener.
- Kit: `ui-only`.
- Source: CB:prioritize-outreach-with-buying-intent-signals-via-lusha; CB:predictleads-news-and-job-openings-to-create-tailored-icebreakers.

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

### W-161 Salesforce connection and write gotchas

- Connect with a restricted, least-privilege user. OAuth approval errors come from integration-user licenses or unapproved connected apps; relax IP restrictions and allow self-authorization, or use Client Credentials.
- Picklists take the exact API value; multi-select values are semicolon-separated with no spaces. Ignore blank values skips only text. Creates cannot be undone. Reports cap at 2,000 rows (set uniqueness fields); the SOQL source caps at 50,000 with no aggregates.
- Kit: `ui-only`.
- Source: D:salesforce-integration-overview; D:creating-a-restricted-salesforce-user.

### W-162 HubSpot actions and scopes

- Lookup object returns 10 by default, 200 at most; Update object has Ignore blank values on by default; Add record to list works on static lists only. Enrolling in a HubSpot sequence needs optional scopes that are off by default: reconnect and tick them. Custom object scopes need HubSpot Enterprise.
- Kit: `ui-only`.
- Source: D:hubspot-integration-overview; D:oauth-optional-scopes.

### W-163 Sequencer integrations need the campaign first

- Smartlead, HeyReach, Reply.io, Twain and Nooks campaigns must exist in the tool; Clay cannot create them. Smartlead refuses a lead already in another of its campaigns unless allowed, and Update or Remove need Smartlead's Lead ID from Lookup lead, not Clay's row ID. Outreach sequences must be Active; Reply.io skips contacts active elsewhere; HeyReach variable names must match exactly.
- Kit: `ui-only`.
- Source: D:smartlead-integration-overview; D:heyreach-integration-overview; D:reply-io-integration-overview; D:outreach-integration-overview; D:twain-integration-overview.

### W-164 Round robin routing

- Distribute Leads Round Robin takes labels plus values such as owner IDs and outputs label, value and a raw counter; the weighted version reads a reps table with an active-reps view and weights. Label slots with real rep names.
- Kit: `ui-only`.
- Source: D:round-robin-integration-overview; CB:enrich-classify-and-route-leads-from-typeform-submissions.

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

### W-171 Sequencer limits worth knowing cold

- 4 emails; delays of 1-10 days; 500,000 leads per campaign; 8 KB per email; 2 variants; one sequence per lead per campaign; 10-500 sends per account per day (30 on bought accounts); about 20 per inbox per day; 3 inboxes per domain, 5 at most; 3 weeks of warmup; a platform ceiling of 100,000 new sequence starts a day. Cost: 1 action per lead plus AI snippet credits.
- Kit: `kit-read`: `chewbacca clay campaign ws=... campaign=...`.
- Source: D:getting-started-with-sequencer; D:sequencer-faqs-and-best-practices.

### W-172 Why leads are not going out

- Check in order: blocklist; missing variable data (Require variable data is on by default, so every variable narrows who is eligible, and under 70% ready warns); exclusions or cooldown; duplicates; a sender disconnected or at its limit; budget or schedule; a deselected sender. Activity shows Enrollment failed.
- Copy freezes at enrollment: fix the data, pause, start a new campaign.
- Kit: `kit-read`: `chewbacca clay campaign-leads ws=... campaign=...`, `chewbacca clay blocklist ws=...`, `chewbacca clay campaign ws=... campaign=...`.
- Source: D:sequencer-faqs-and-best-practices; D:get-leads-ready-to-sequence; D:build-your-sequence.

### W-173 Bounce thresholds and a worn-out domain

- Aim under 1%; Clay flags 5% after 20+ sends in a trailing 30 days. Split recipient bounces (list or verification) from sender bounces (authentication, warmup, limits). Buy and warm replacements before retiring a domain; deleting one bought account deletes that domain's whole set.
- Kit: `kit-read`: `chewbacca clay campaign-analytics campaign=...`.
- Source: D:sequencer-deliverability; D:buying-email-accounts.

### W-174 A/B test mechanics in detail

- Variant B splits 50/50; a reply-thread message can only test its body; a variable used in one variant gates enrollment for both. Reply rate is over delivered, and the mature share (sends 3+ days old) says when to read it. End test promotes the winner for future enrollments only. A 60/40 split on a few hundred leads is normal.
- Kit: `kit-read`: `chewbacca clay campaign-variants ws=... campaign=...`.
- Source: D:ab-test-sequence-copy; D:campaign-analytics-and-replies.

### W-175 Exclusions, cooldowns and the blocklist

- Exclude People segments (customers, open deals, do-not-contact) with a cooldown of none, 30, 60, 90 or custom up to 365 days; a new campaign starts at none. Blocklist CSV imports take 1,000 rows each. Pausing stops a lead mid-sequence; the blocklist only stops future enrollments.
- Kit: `kit-read`: `chewbacca clay blocklist ws=...`.
- Source: D:get-leads-ready-to-sequence; D:campaign-analytics-and-replies.

### W-176 Campaign event types and timing

- Events: EMAIL_SENT, EMAIL_REPLY, EMAIL_OPEN, EMAIL_LINK_CLICK, EMAIL_BOUNCE, LEAD_UNSUBSCRIBED, LEAD_CATEGORY_UPDATED, CAMPAIGN_STATUS_CHANGED; 99% land within 5 minutes on bought senders. Opens and clicks need tracking and HTML. Missing events usually mean a sender auth error. Custom webhooks take one event type each and are set before the campaign goes live.
- Kit: `kit-read`: `chewbacca clay inbox ws=...`.
- Source: D:automate-campaign-events.

### W-177 Schedules and what going live locks

- Schedule presets: Optimized for deliverability (weekday business hours, 20-minute gaps), Send immediately, Custom (3-30 minute gaps). Going live locks step count, order and the lead email field; copy and timing stay editable while paused; Completed is final. There is no per-campaign daily cap on new leads.
- Kit: `kit-read`: `chewbacca clay campaign ws=... campaign=...`.
- Source: D:launch-and-manage-a-campaign; D:email-sequencer.

### W-178 Connecting your own inboxes

- Gmail OAuth needs a Workspace admin to trust the Clay Sequencer app (up to 24 hours); Outlook OAuth needs admin consent; SMTP on 465 or 587 with IMAP on 993 (Gmail needs an app password); or a bulk CSV. OAuth reconnects from the 3-dot menu; SMTP accounts are deleted and re-added. Clay does not monitor domain health on your own inboxes.
- Kit: `ui-only`.
- Source: D:connect-your-own-email-accounts.

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

### W-186 Ad sync limits and match rates

- LinkedIn is the only destination for account audiences: 300 matchable minimum, 300,000 cap. Meta, Google, Bing and Reddit need 1,000 matched and cap at 1,000,000; a multi-destination sync uses the smallest cap.
- Work email alone matches 60-70% on LinkedIn and 10-20% on Meta. Enhanced matching (Good, 1-2 credits a row; Best, 2-3) lifts that to about 90-95% and 50-70%. Google and Bing take first-party contacts only.
- Start with 5,000-10,000 records; each exported record is 1 action.
- Kit: `ui-only`.
- Source: D:clay-ads; D:clay-ads-compliance-best-practices; D:linkedin-ads-in-clay; D:google-ads-in-clay.

## Copy

### W-090 Snippets assembled by formula

- Generate the subject, intro and PS as separate AI columns from research columns, then join them with a formula column into the message. Modular columns are easier to audit than one generated email.
- Kit: `formula` plus `ui-only` AI columns.
- Source: U:create-personalized-content-at-scale ("Implementation in Clay").

### W-091 Twain for a whole sequence

- Twain enrichment: a predefined 1-4 step sequence or your own Twain sequence ID; prospect description, signal, ICP and problem as parameters; first name, last name and LinkedIn URL as inputs; map each step to a column.
- Kit: `ui-only`.
- Source: U:create-multi-step-sequence-messaging-with-twain.

### W-192 Message drafting per external sequencer

- Table Export Messages to Sequencer supports conditional snippets ("/" then Where conditions, with an if and an else value such as a greeting fallback). Format quirks: Lemlist wants HTML line breaks, Salesloft takes no HTML or newlines, Reply.io allows 50 custom variables, La Growth Machine 10 attributes of 250 characters, Outreach reserves custom10-custom15.
- Kit: `ui-only`.
- Source: D:message-drafting-overview.

### W-193 Openers from what the prospect is doing now

- Pull the prospect's own case studies (who they serve) or PredictLeads news and jobs filtered by your use case; the opener mirrors something happening now, not what the company does. Tell the prompt to vary the first line so emails do not all start alike.
- Kit: `ui-only`.
- Source: CB:personalize-outbound-using-case-studies-from-your-prospects-websites; CB:level-up-your-recruiting-game-finding-the-right-talent-at-scale; YT:ylXLZQvZXIA&t=149.

## Clay inside chat tools (MCP)

### W-095 Search, filter, then enrich

- Connect: claude.com/connectors (or Customize > Connectors) in Claude, @clay or Settings > Connectors in ChatGPT; 500 free credits. Add "use Clay" to a prompt so the tool does not fall back to web search.
- Pattern: broad find at one company, narrow (director and up, US, joined in the last year), then enrich only those. Results come 20 at a time; volume belongs in the app.
- Use domains, not names; one company per chat except head-to-head comparisons. Typing the same prompt repeatedly means it belongs in a table.
- Kit: `practice`.
- Source: U:find-and-verify-contact-info-for-any-prospect; U:best-practices-for-clay-in-chatgpt; U:creating-your-own-use-cases-in-chatgpt-with-ai.

### W-196 Admin controls for Clay in chat tools

- Settings > MCP users: a default monthly limit plus per-user overrides, resetting on the 1st at midnight UTC. A limit of 0 is the hard stop, because a Viewer can still run through MCP.
- Expose a function with MCP for reps, a routine name and a description; it needs an output column, and its name must not collide with built-ins like "find contacts". ChatGPT custom functions need run_subroutine_no_mapping enabled there. Results page 20 at a time up to 100. Glean and Microsoft 365 Copilot need their own admin to install Clay first.
- Kit: `practice`.
- Source: D:mcp-settings; D:mcp-security-privacy; D:mcp-troubleshooting-and-faqs; D:using-clay-in-chatgpt; D:using-clay-in-microsoft-365-copilot.

### W-197 MCP for reps or the agent plugin

- MCP for AEs and SDRs: an admin approves functions and budgets. The agent plugin for RevOps and GTM engineers: skills plus the clay CLI and Public API under the user's own permissions; it cannot start or pause campaigns and cannot write Audiences fields.
- Setup in Claude Code: `/plugin marketplace add clay-run/agent-plugins`, `/plugin install clay@clay-plugins`, `/clay:setup`; then `clay login --device` and `clay api-keys create`.
- Kit: `practice`.
- Source: D:mcp-for-reps-vs-agent-plugin; D:clay-api-cli.

## GTM engineer interviews

### W-231 Clay's own interview loop

- Recruiter screen, hiring manager, an open-ended take-home with a video and live presentation (candidates report 40+ hours when new to Clay; judged on Clay depth plus creativity and personality), a mock discovery call where you explain Clay to a non-technical buyer, then a founder round.
- Reported questions: how you start designing a GTM motion, how you would describe Clay to a customer, a mistake you made and fixed.
- Kit: `practice`.
- Source: W:interview.norahq.com/interview-guides/clay-gtm-engineer-interview-guide-2026; W:glassdoor.com/Interview/Clay-GTM-Engineer-Interview-Questions-EI_IE9850794.0,4_KO5,17.htm.

### W-232 The take-home prompts Clay publishes

- Outbound reply-rate analysis (which variables drive replies), an outbound campaign built in 60 minutes from supplied data, hypothesis-then-execute targeting, and inbound lead analysis (who converts, where routing stalls).
- Strong answers break the problem down, state assumptions and fallbacks, and name external levers (new data) and internal ones (SDR-to-AE routing delay). Red flags: one channel only, ignoring deliverability, fatigue or data quality, complex before simple, no business outcome.
- Kit: `practice`.
- Source: W:thegtme.com/p/how-to-hire-a-gtm-engineer; W:clay.com/blog/how-to-hire-a-gtm-engineer.

### W-233 Speed-to-lead system design

- Scope (volume, what qualified means, the SLA, the metric); ingest by webhook into a queue with an idempotency key; enrich by waterfall with a per-domain cache; match to existing accounts and compute fit and intent scores with a short rep summary; route to the existing owner first, then territory and capacity-weighted round robin; act (booking link and Slack for high fit, nurture for low); assure (retries, dead-letter queue, alert when a lead waits 3 minutes, a rollback flag); learn (speed and meeting rate by score band, thresholds tuned weekly).
- Kit: `practice`.
- Source: W:aiengineeringinsider.substack.com/p/cracking-the-gtm-engineer-interview.

### W-234 Coding and SQL rounds

- An enrichment client for 10,000 domains at 10 requests a second, retrying 429 and 5xx with backoff and jitter, never enriching a domain twice: a rate limiter, a seen-set cache, structured logs.
- SQL: accounts whose usage grew 50% month over month with no open opportunity, via a monthly CTE, LAG, and a left join filtered to nulls.
- Clay's engineering loop: an in-memory file system extended spec by spec, a job that runs exactly once across two workers, a client for a paginated, rate-limited API, and a waterfall pipeline that resumes at row 60,000 without double-charging a credit when a response is lost.
- Kit: `practice`.
- Source: W:aiengineeringinsider.substack.com/p/cracking-the-gtm-engineer-interview; W:techinterview.org/post/3233477228/clay-interview-guide.

### W-235 What interviewers score

- Business impact in numbers; ownership you can show; engineering (tests, retries, idempotency, rollback); AI judgment (an agent for research, rules for routing, a human gate before sending); explaining attribution to an AE and a CEO; prioritization (declining low-value asks with data).
- Is an outbound agent safe to run alone? A golden set, a groundedness rubric where every claim traces to a field, sampled human review, a cost and latency budget, a kill switch, and a staged rollout of 5%, 25%, then 100%.
- Kit: `practice`.
- Source: W:aiengineeringinsider.substack.com/p/cracking-the-gtm-engineer-interview.

### W-236 Diagnosis questions

- Reply rate fell 30%: deliverability first (bounce rate, sender bounces by domain, auth errors), then the list (segment drift, data age), then copy and timing, compared by cohort. Lead volume up but pipeline flat: qualification, routing delay, speed-to-lead. An opportunity going cold: a scheduled check on last activity that alerts the owner. Double pipeline without headcount: signals over volume, then automation of research.
- Kit: `practice`.
- Source: W:thegtme.com/p/how-to-hire-a-gtm-engineer; W:sloane-staffing.com/insights/gtm-engineer-interview-questions-job-description-template.
