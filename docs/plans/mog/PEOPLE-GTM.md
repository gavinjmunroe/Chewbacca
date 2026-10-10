# People and GTM teardown: 11 products against Chewbacca

Written 2026-10-10. Extends docs/plans/COMPETITORS.md, which only had one-line snippets for these products (section "The 2026-10-07 sweep"). Nothing here repeats that file.

Mark key: [read] = page fetched through a summarizing fetch tool, so numbers are close to verbatim but not guaranteed exact. [video] = YouTube transcript pulled with yt-transcript. [snippet] = search result only, treat as a lead. All vendor numbers are vendor claims unless a third party is named. Nothing was bought or used hands-on.

Scope notes: Clay's own video search was blocked by the kit's launch-guard hook (it refuses any shell command that mentions Clay and is not a known read), so Clay has no [video]. No YouTube demo was found for Boomerang (search returned unrelated results). Two transcript fetches failed (Mesh "Introducing Clay", Artisan "What is Artisan"), so Mesh has no [video]. Lindy, Dex, Unify, 11x, Artisan, Happenstance, Actively did get a transcript.

Chewbacca baseline caveat that applies to every "test" line below: the repo has no recorded positive reply rate for the Zeutara run (grep of docs, skills and team/memory found none), and COMPETITORS.md says `bin/intro` has no recorded use. So the tests are written as targets to be measured, not as claims already won.

---

## 1. Dex (getdex.com)

**Does best.** Consolidates people into one record from 15+ sources (email, calendar, LinkedIn, WhatsApp, iMessage, Facebook, Instagram, phone contacts, CSV), merges duplicates by name, and keeps the timeline fresh with a background Mac sync. The iMessage sync is set up in the Mac app under Sync & Integrations, runs hourly while the Mac is online, captures iMessage and SMS (RCS added Sept 2026), and stores only the most recent message plus metadata locally. It is labelled beta. [read: getdex.com, /integrations/imessage, /changelog]

**Bar.**

- Price: Premium $12/mo annual ($20 monthly), Professional $20/mo annual, Team $40/mo. 7-day trial with card. [read: /pricing]
- LinkedIn sync cap 2,500 (Premium) or 9,000 (Pro). Bulk enhance 750 contacts. Mail merge to 200 contacts. Granola sync imports 30 days then re-checks every 4 hours. [read: /changelog]
- Research credits 10, 20, 50 per month by tier. [read]
- Users: "30,000+" [snippet, from prior COMPETITORS.md]. Setup time: unmeasured (the 2021 walkthrough is 14:45 long, not read).
- Newest: Voice Mode (Sept 2026), Dex Shuffle drafts outreach to lapsed contacts, never auto-sends (June 2026), MCP into Claude and ChatGPT (Apr/May 2026). [read: /changelog]

**Chewbacca counterpart.** `bin/people` (node, SQLite at PEOPLE_DIR) with `bin/lib/people/texts.js` (Messages sync), `import.js` (macOS Contacts, vCard, CSV), `linkedin.js` and `linkedin-match.js`, `identities.js` and `resolve.js` (identity before facts), `keeping-up.js` (who is slipping), `skills/people/SKILL.md`. WhatsApp via `bin/chewbacca-whatsapp`.

**Steal.**

- Dex Shuffle: a bounded daily batch (two a day) of "reconnect" drafts, so the keep-up queue is finite and never auto-sent.
- Caps shown as product copy ("most recent message plus metadata stored locally") because it answers the privacy question in one line.
- A dedicated auto-maintained group for iMessage-synced people, so a stranger sees the import landed.

**Test that Chewbacca beats it.** On Caleb's own Mac, `people texts sync` plus `people import` ingests the full Messages history (not last message only) and resolves at least 95% of the 20 most-texted handles to the right person with zero wrong-person merges, in under 10 minutes from a cold start, with no card and no trial. Dex stores one message per contact; the full-history, zero-bad-merge result is the thing it cannot show.

Sources: [getdex.com](https://getdex.com) [read], [pricing](https://getdex.com/pricing) [read], [changelog](https://getdex.com/changelog) [read], [iMessage integration](https://getdex.com/integrations/imessage/) [read], [What is Dex](https://youtu.be/OtEMxkQJF7o) [video], [dupple hands-on review](https://dupple.com/reviews/dex) [snippet].

---

## 2. Mesh (me.sh, formerly Clay the personal CRM)

**Does best.** Breadth of passive sources feeding one profile per person, then enrichment: it pulls email, calendar, address book, LinkedIn, Twitter/X, Facebook, Instagram, WhatsApp, Notion and iMessage, adds location and work history, and surfaces job changes and a "Reconnect" feed. Runs on Mac, Windows, web, iOS, Android. [read: me.sh, /pricing]

**Bar.**

- Free: up to 1,000 contacts, with iMessage import. Pro $10/mo (unlimited contacts, CSV import, faster network data refresh), 14-day trial. Team $40/seat/mo, up to 4 members. Enterprise has SOC 2 Type II and SAML. [read: /pricing]
- Homepage counter: 187,475,968 relationships managed. [read: me.sh]
- Setup time, contacts synced per user: unmeasured. One reviewer reports an iMessage import failure that could not be redone and weak duplicate resolution, a single anecdote. [snippet: Dex's own comparison and a review summary, so the source is a competitor]
- Funding $8M seed [snippet from prior doc]. No changelog (the /changelog URL returned 404). No video transcript obtained.

**Chewbacca counterpart.** `bin/people` as above. Group and "who knows whom" is `bin/intro` and `bin/lib/intro.py`.

**Steal.** Job-change and life-update alerts as the reason to reopen the app. Chewbacca has the people store but no change-detection feed; `bin/gtme-signals` only covers SEC Form D filings. A weekly "this person changed jobs" diff against the LinkedIn match would be the cheapest port.

**Test.** On the same 1,000-person slice, `people` produces zero duplicate person records after two consecutive import runs (idempotent re-import), and `people texts sync` can be re-run after a forced failure without losing rows. Mesh's only independent evidence is a failed, non-repeatable import; idempotent recovery is the measurable edge.

Sources: [me.sh](https://me.sh) [read], [me.sh/pricing](https://me.sh/pricing) [read], [Dex's Mesh review](https://getdex.com/blog/mesh-review/) [snippet, competitor-authored], [me.sh/changelog](https://me.sh/changelog) [404].

---

## 3. Happenstance (happenstance.ai)

**Does best.** Natural-language search over a graph built from up to seven accounts each person connects (Gmail, Calendar, Contacts, LinkedIn, Twitter, Instagram, Outlook), ranked by how well you know each person, then expanded to friends' and groups' networks. Each result shows mutual connections and drafts the intro request to the strongest mutual. Demo shows an agentic search: 3 searches for the first query, 5 more on "Find more", mostly second-degree results. Exposed as an MCP server, a REST `/v1/search`, and a CLI (`hpn`). [read: happenstance.ai; video: AutomateNow review]

**Bar.**

- 500,000+ users. Largest group makes 380,000+ people searchable. [read: happenstance.ai and /compare/happenstance-vs-boomerang]
- Free forever (usage-limited chat, unlimited accounts, friends, groups). Pro $24/mo billed yearly ($30 monthly). Team $24 per seat. API and MCP use separate credits. [read: /pricing and compare page]
- SOC 2 badge. Funding $500K (YC) [snippet]. Search latency and accuracy: unmeasured; the page gives none. A Product Hunt commenter asked whether it weights recency (an email from three years ago), with no answer found. [snippet]
- Video: an unrelated reviewer ran a live query ("people in Tokyo who studied at a Scottish university, interested in fintech") and described it as running an embedding search, narrowing, then returning profile snippets. [video: 8Z0yyIW2REU]

**Chewbacca counterpart.** `bin/intro` ("warm-intro paths from the people you know to a goal", reads people.db plus a contacts index, read-only, fact paths vs jev judgment paths) and `bin/lib/intro.py`. `skills/playbook-warm-intros` listed in the skill set. No recorded use of `intro`.

**Steal.**

- Search that returns a path (who, via whom) in one line, and drafts the ask. `intro` stops at listing paths and contacts nobody.
- Group graphs: sharing a network with a friend expands the radius. Chewbacca's graph is one person; a shared, opt-in second graph (Sagar, Karthik) is the cheapest way to get second-degree reach.
- Expose the lookup as MCP/CLI so other agents call it (already true via `mcp__chewbacca__who_do_i_know`).

**Test.** On 20 real goal queries Caleb has actually had ("a seed investor in fintech in Texas"), `intro` returns at least one path whose first hop is a person Caleb has texted in the last 12 months for at least 15 of 20, and Caleb confirms in writing that the top path is real for at least 10 of 20. Happenstance publishes no accuracy number, so any measured, hand-labelled precision beats an unmeasured claim; also must record the first actual use of `intro` leading to a sent ask.

Sources: [happenstance.ai](https://happenstance.ai) [read], [pricing](https://happenstance.ai/pricing) [read], [vs Boomerang](https://happenstance.ai/compare/happenstance-vs-boomerang) [read, vendor-authored], [review video](https://youtu.be/8Z0yyIW2REU) [video], [docs.happenstance.ai](https://docs.happenstance.ai) [DNS failed], [warm intro guide](https://happenstance.ai/guides/best-warm-introduction-software) [snippet].

---

## 4. Boomerang (getboomerang.ai)

**Does best.** Runs the intro itself as a sequence with timing and escalation. Its agent Rudy reads opportunities, accounts, signals, calendar and call recordings; scores each connector by capability and willingness per deal; holds the ask until a trigger (stalled deal, finished onboarding, a positive Slack mention); nudges, then escalates to the next connector if one goes quiet; enforces connector limits (deal size, channel, cadence, "No competitors"); and logs every step to the CRM record. Example timeline on the page: approved ask Day 0, booked meeting Day 8. [read: getboomerang.ai]

**Bar.**

- Price: Starter $80/mo annual ($100 monthly), Team $600/mo annual, Company $2,000/mo annual, Enterprise custom. Connectors never charged. Starter 75 connectors, Company 2,500. [read: /pricing]
- Own-metrics: the site makes no reply or meeting claims. The only numbers are customer-reported (Armis, 26,000 warm intro paths and 1,400 hours of research removed in year one, via a competitor's page; Storylane "3x growth"). [read, second-hand]
- Buyer's-guide estimate $15,000 to $25,000/yr for ten reps. [read, via Happenstance's compare page, a competitor]
- Setup time: unmeasured. SOC 2 Type II. Funding $3.7M [snippet]. No video found.
- Integrations: Slack, Gmail/Outlook, Salesforce/HubSpot/Attio, Gong, Outreach, MCP for Claude and Codex, REST and webhooks. [read]

**Chewbacca counterpart.** `bin/intro` finds paths. Nothing times, chases or escalates. `bin/work-ledger` and `bin/recur` could hold a pending ask with a next check date, but no intro-specific loop exists. `skills/playbook-warm-intros`.

**Steal.**

- The state machine: ask drafted, approved, held for trigger, nudged, escalated, booked. Each state a row in `work-ledger` with a due date, so an intro ask stops being a one-off draft.
- Connector limits as rows (never ask X about competitor Y), enforced at draft time. Chewbacca already does this style of refusal for `gtme-dnc`.
- Log the whole chain to the person record in `people`.

**Test.** Run one real intro end to end for Zeutara or Caleb: `intro` path, drafted ask, Caleb's press, a tracked follow-up that fires on its own date and escalates to the second connector after 5 business days of silence, logged in people.db. Success is one booked meeting with the path written down (the exact requirement COMPETITORS.md already sets). Boomerang has no published own number to beat; the first documented, reproducible Day-N booking is the bar it sets.

Sources: [getboomerang.ai](https://www.getboomerang.ai) [read], [pricing](https://www.getboomerang.ai/pricing) [read], [Happenstance comparison](https://happenstance.ai/compare/happenstance-vs-boomerang) [read, competitor-authored].

---

## 5. Clay, including Claygent and Sculptor (clay.com)

**Does best.** The enrichment table: a spreadsheet where every column is a data provider, waterfall, formula or agent call, run row by row, now extended with Claygent (a web-research agent that returns structured output, with a full reasoning trace), Account Agents (per-account, with memory, in beta), Sculptor (an in-product copilot that builds searches, enrichments and copy from natural language), a CLI plugin for coding agents, an MCP, and Sequencer 2.0 for sending from the same place the data lives. Claygent can read account context (CRM, warehouse, call data). Prompts are testable and versioned with rollback. [read: /claygent, /sculptor, /pricing, /changelog]

**Bar.**

- Free $0 (500 actions, 100 data credits, 200 rows/table, Claygent included). Launch $167/mo annual ($185 monthly), 15K actions, 2.5K credits, 50K rows/table. Growth $446/mo annual ($495 monthly), 40K actions, 6K credits. Enterprise custom. Data credit from $0.05, action under $0.01. [read: /pricing]
- Claygent: 5,060,235,046 runs ("and counting"). Customer claims: Pendo 55% of new-line revenue sourced, Mistral 25k+ accounts sourced in 2 weeks (est. 3 months otherwise), Verkada 100% of manual enrichment removed. No accuracy rate or benchmark published. [read, vendor testimonials]
- Sculptor: one testimonial, 15 minutes versus a couple of hours. No pricing or credit disclosure. [read]
- Latest changelog entries (Sep 7 to Oct 5, 2026): MCP cross-entity search over people, company and job data; CLI can create, edit and pause Ads. Valuation $7.1B, $115M raised 2026-09-09 [snippet from prior doc].
- Setup time: unmeasured. Chewbacca's own prior note: Claygent burned about 21 credits a row.
- Video: not obtained (shell guard).

**Chewbacca counterpart.** `bin/chewbacca-clay` (front door: official clay CLI, api-anything, kit bins, clay-go route; writes need a human typing the op name at a terminal), `skills/clay-navigation` (reads: campaigns, replies, tables, credits, workflows, mailboxes, blocklist; "never uses Sculptor and never sends or launches"), `bin/clay-balance`, `clay-build`, `clay-review`, `clay-inbox`, `clay-go`, `clay-map`, `clay-fixture-check`, `skills/clay-playbooks`, `skills/enrichment`, `bin/gtme-score`, `gtme-grade`, `list-audit`, `list-gate`, `gtme-dedupe`, `gtme-dnc`. There is no counterpart to Claygent itself (no stateless web-research agent with a reasoning trace); `skills/deep-research` and `bin/jev-browse` are the nearest.

**Steal.**

- Reasoning trace stored per cell. Chewbacca's `chewbacca clay` reads cells but nothing records why a value was chosen; add a trace column to any agent-filled row.
- Prompt versions with rollback, applied everywhere the prompt runs.
- Credit estimates before a run (Origami shows "40 to 110 credits per play"; Clay shows per-unit rates). Prior doc flagged the missing spend cap; port a pre-run estimate to `clay-build`.
- Account Agents memory: "track what changed" per account. Chewbacca's `gtm-memory` (`tools/gtm_memory.py`) is the place.

**Test.** Where it already beats Clay on Zeutara: no campaign launches without a passing `list-audit` and a full pre-send receipt (launch-guard.sh, checked in code). Measure it: on the real 1,039,715-row investor file the audit sized the usable pool at 81,460 (7.8%) before any credit was spent; on that same file, report Clay credits spent per verified-deliverable contact for `chewbacca clay` flows versus the ~21 credits/row Claygent baseline, target at most half of it, with bounce rate under 2% over the first 500 sends.

Sources: [pricing](https://www.clay.com/pricing) [read], [Claygent](https://www.clay.com/claygent) [read], [Sculptor](https://www.clay.com/sculptor) [read], [changelog](https://www.clay.com/changelog) [read], [roadmap blog](https://www.clay.com/blog/build-on-clay-clays-product-roadmap-with-ceo-kareem-amin) [snippet from prior doc].

---

## 6. Unify (unifygtm.com)

**Does best.** Signal-triggered plays that run end to end: pick an audience, attach a sequence, and a Play (an automated workflow) fires on a trigger such as an identified website visitor, a job change, funding, a new hire or a champion move, with AI research, qualification and enrollment in a multichannel sequence, plus managed mailboxes (create, warm, rotate) on the Business plan. Chat agent on top with 50+ skills and 40+ data sources, 1.1B people and 65M companies, an email and phone waterfall. [read: homepage, /pricing; video: Unify 101]

**Bar (all vendor-reported, no method given).**

- 2.5x outbound reply rate, 92% show rate on outbound meetings, 40% of pipeline sourced from signals, 4.2x/6.8x ROI, "$786,008,510" pipeline powered. [read: homepage]
- OpenPhone case: 2.5x reply rate, 25% of replies positive, 100+ opportunities. [snippet; the same quote and numbers also appear on a second customer page, so verify before citing]
- Playbook claim: product-usage signals give a 9.1% positive reply rate and 4.7x lift. [snippet]
- Price: Free (3 seats), Base $20/seat/mo (800 credits), Pro $60/seat/mo (2,400 credits), Business custom (adds website intent, signal-triggered automation, managed mailboxes, read-write CRM). Hard credit cap pauses actions. Email enrichment about 1 credit, phone about 4. 100 records per search. [read: /pricing]
- Setup: a third-party review reports 2 to 4 weeks for automated Plays, from $700/mo. [snippet, SyncGTM, a competitor]. Reviewers flag credit-spend unpredictability and enrichment accuracy. [snippet]

**Chewbacca counterpart.** Signals: `bin/gtme-signals` (SEC Form D only). Plays: `skills/playbook-*` set (new-in-role, hiring-surge, warm-intros, lookalikes) as instructions, not running automations. Scoring: `gtme-score`, `positive-reply-scoring` skill, `bin/gtme-reply` (reply intent, clean text, autosend verdict, OOO detection, bounce kind, ported from togari-platform). Sending: Smartlead via `chewbacca clay`/`launch-guard`. No website-visitor identification.

**Steal.**

- Make each playbook a named Play with trigger, audience, sequence and stop rule as data, not prose.
- Hard credit cap that pauses instead of billing.
- A leading-indicators dashboard (positive reply rate by signal type), which is how Unify can publish "9.1% for usage signals" at all.

**Test.** Over 500 sends on Zeutara's real list, positive reply rate of at least 5% (Octave's cold-email band for trigger-based sends is 5 to 8% reply, snippet; Unify's own 9.1% is the stretch target) with every send traced to a named signal and every reply classified by `gtme-reply`, plus hard-bounce rate under 2%. Unify's 25%-of-replies-positive is the ratio to beat on the same sample.

Sources: [homepage](https://www.unifygtm.com) [read], [pricing](https://www.unifygtm.com/pricing) [read], [Unify 101](https://youtu.be/ms6t-MieWo4) [video], [OpenPhone story](https://www.unifygtm.com/customers/openphone) [snippet], [SyncGTM review](https://syncgtm.com/blog/unify-gtm-review) [snippet], [Octave reply-rate guide](https://www.octavehq.com/post/gtm-engineers-guide-to-reply-rates) [snippet].

---

## 7. 11x (11x.ai)

**Does best.** Live web search to build the audience, then research and write. Alice takes a prose ICP ("engineering leaders at companies that posted about shipping AI products in the last 6 months"), splits it into criteria buckets you can loosen without restarting, builds the audience from 400M+ verified B2B contacts plus live web verification, shows source links for each match, does deep research per prospect (news, posts, earnings, launches), picks a pain point, and writes a "mini proposal" in your brand voice, then iterates and spins up lookalikes. Also handles replies and meeting booking, and Julian answers inbound calls. [read: 11x.ai; video: Launch Sequence ep. 1]

**Bar.**

- Reply rate 9.7% on outbound email (a customer quote on the site). "1.5x more qualified meetings"; customers report 5x (MMB Networks), 2x (Questex), 10 to 15 calls booked in a week, "$1M+ pipeline in 3 months". [read]
- Independent evidence: one solo founder's 60-day test, 3.8% reply in month one and 5.1% in month two. [snippet, single anecdote]
- Price: Growth reported from $3,750/mo billed annually (about $45K/yr). Other pages: $36,000/yr floor, $5,000/mo, and $25K to $200K+/yr ranges. Annual contracts, reports of exit difficulty. [snippet, several sources are competing vendors]
- Not stated on site: leads per month, setup time, pricing. TechCrunch (2025-03-24) reported 11x listed customers it could not support; CEO stepped down 2025-05-05. [snippet via prior doc and search]

**Chewbacca counterpart.** Research and drafting: `skills/prospect-brief`, `skills/personalize-email`, `skills/personalization-subagent-pattern`, `skills/campaign-copywriting`. Reply handling: `bin/gtme-reply`. Booking: none (stops before send/book by design). Live web audience build: `skills/deep-research` and `bin/jev-browse`, not wired into an audience-builder.

**Steal.**

- Criteria buckets: show the parsed ICP as editable criteria and a per-row "criteria matched" column with a source URL. This is precisely Jonah's five-defect lesson (every "X backed Y" line needs a public source URL on the row), and 11x ships it as UX.
- "Loosen the limiting criterion" instead of restarting a search.
- Lookalike spin-up from a winning segment.

**Test.** On Zeutara's real list, 100% of personalization lines carry a public source URL on the row (11x shows links per match; Jonah's review required this), the pre-send gate refuses a row with none, and positive reply rate is at least 4% over 500 sends (above the independent 3.8% to 5.1% band's low edge, with the 9.7% site claim as stretch), at a cost of $0 platform fee against a $45K/yr floor.

Sources: [11x.ai](https://www.11x.ai) [read], [Launch Sequence video](https://youtu.be/nsUTQ2dkmRg) [video], [Salesforge demo](https://youtu.be/oAqmPMtM1LU) [video, 1,153 words, skimmed only by size not read], [pricing and reviews roundup](https://www.artisan.co/blog/11x-pricing-and-reviews) [snippet, competitor-authored], [TechCrunch on 11x](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have) [snippet].

---

## 8. Origami Agents (origamiagents.com, now origami.chat)

**Does best.** One prompt becomes a verified contact list from live search, with an explicit credit price before you run. Type your website and it recommends plays; each prompt searches 50+ sources in real time (Google Maps, social, job boards, company sites), cross-checks data points, runs emails through a 5-provider waterfall and phones through a 9-provider waterfall using the first verified result, then drafts outreach. Plays show their cost up front: about 40 credits (find hiring teams), 100 (sequence leads), 110 (reach new sales leaders), 100 (website visitors). [read: origami.chat]

**Bar.**

- Starter $49/mo: 4,000 credits, 5 email senders, 1 LinkedIn sender, CSV export; top-up $22 per 1,000 credits. Free tier: preview only, 20 messages, 30 rows, no export or contact info. [read]
- 1,000+ active customers, 100M+ companies, 350M+ profiles. [read]
- "$0 to $50k MRR in 50 days" and $2M seed (Jan 2025, founders Finn Mallery and Kenson Chung). [snippet, company blog]
- Setup time: not stated; the 31-minute founder tutorial is titled "land 10 customers in 30 minutes" (title only, transcript not pulled). [snippet]
- Quirk: origamiagents.com redirects (308) to origami.chat, and its blog now pitches YC-founder contact lists, so the product has shifted from account research toward a list builder. [read]

**Chewbacca counterpart.** `bin/scrape`, `bin/gtme-lookup` (ZoomInfo/Fireflies reads), `skills/perfect-company-list`, `skills/decision-makers-map`, `skills/enrichment`, `bin/list-sift`, `bin/gtme-dedupe`. No single prompt-to-verified-list command and no credit-priced plays.

**Steal.**

- Credit price printed per play before it runs (and `chewbacca clay measure` already times surfaces; add dollars).
- Email 5-way and phone 9-way waterfall, first verified wins, as a configurable chain.
- "Connect a sender before sending" as a hard precondition (Chewbacca's launch-guard is the same idea, stronger).

**Test.** From one sentence about Zeutara's ICP, `chewbacca` produces a list of 100 contacts where at least 95% pass ZeroBounce and `list-audit` grade A or B, every row has a source URL, and the estimated spend printed before the run is within 20% of actual. Origami's own sample is 20 accounts; 100 verified rows at a measured per-row cost is the comparison.

Sources: [origami.chat](https://origami.chat/) [read], [origamiagents.com redirect notice](https://origamiagents.com) [read], [$2M raise](https://origamiagents.com/blog/2m-raise-announcement) [snippet], [tutorial](https://youtu.be/W05wSqjvc6I) [snippet, title only].

---

## 9. Artisan (artisan.co, Ava)

**Does best.** The shortest path from signup to a running autonomous BDR. The company's own video builds one in about 5 minutes: pick a data source (270M+ people), filter to a number (2M, then 372K, then 97K, then 17K people by title, geography, industry and headcount), attach an AI research agent ("if you can Google it, Ava can find it", used to exclude competitors), let Ava draft the sequence from your website (problem-solution pairs, social proof, calls to action, selectable personalization sources), regenerate with a plain-language "coaching point", then set autonomy: send without approval, 300 contacts a month, autonomous reply, book meetings, knowledge base for answers. [video: nsdmN2TIzy0; read: artisan.co]

**Bar.**

- Pricing opaque and changing. Reported public tiers of $250/mo and $600/mo (Employee: 30K credits, an estimated 4 to 30 replies a month) disappeared in mid-2026 per one September 2026 review; reported deals $1,500 to $5,000/mo; Vendr average first-year contract about $12,000. [snippet, third-party]
- Zirtual case study (Artisan's own): 81,785 emails, 27,132 new leads contacted, 80 positive replies over 3 months, "about 3x Apollo". That is 0.098% positive replies per email sent and 0.29% per new lead. [snippet; arithmetic done here from the reported counts]
- Independent test: 5.3% reply in a 30-day, 200-contact trial, from an article with internal inconsistencies. [snippet]
- Setup: about 5 minutes to a running campaign per their video. Dialer $67/seat/mo, unlimited minutes. [video; snippet]

**Chewbacca counterpart.** Campaign setup: `skills/gtm-engineering`, `skills/campaign-strategy`, `bin/gtme` and `gtme-grade`, `gtme-interview`, Smartlead/Clay launch through `chewbacca clay`. Reply handling: `bin/gtme-reply`. Dialer: none. Coaching points: none (copy edits are manual).

**Steal.**

- The narrowing funnel shown live (2M, 372K, 97K, 17K) with the count updating on each filter. `list-audit` outputs a pool size; make it interactive with the same shrinking number.
- "Coaching point" as a reusable instruction applied to every regeneration, stored on the campaign.
- Autonomy as explicit toggles (send without approval, autonomous reply, book meetings), default off. Chewbacca defaults all off already; make them visible.

**Test.** Zirtual's positive reply rate per email sent, 0.098%, is a low bar: on Zeutara's real list, positive replies per email sent of at least 0.5% (five times Artisan's own published case) over 500 sends, and a time from "new client brief" to a gated, launch-ready campaign under 60 minutes with every gate receipt present. Artisan's 5-minute setup is also a bar on time; Chewbacca's run includes a real gate, so measure and publish the number.

Sources: [artisan.co](https://www.artisan.co) [read], [setup video](https://youtu.be/nsdmN2TIzy0) [video], [pricing roundup](https://www.11x.ai/guides/artisan-pricing) [snippet, competitor-authored], [Zirtual case](https://www.artisan.co/casestudies/zirtual) [snippet], [pricing page](https://www.artisan.co/pricing) [read, contained no figures].

---

## 10. Lindy (lindy.ai)

**Does best.** An assistant you text, wired to your tools, that is proactive. Per its launch video: a morning brief by message, a pre-meeting note with attendee research and prior next steps, an in-meeting note-taker that also acts afterward (calendar invites, email drafts, Notion updates), reachable by iMessage, Slack @mention, and scheduled runs. Anything that writes or sends can wait for approval. Teach it a task once and it becomes a skill the whole team uses. Falls back to driving a browser when no integration exists (Pro and up). [read: lindy.ai; video: Lindy Assistant launch]

**Bar.**

- 1,500+ integrations plus any hosted MCP. 40+ skills. "Setup in 2 minutes" on the free plan. [read]
- Price: Free ($50 credits that last 7 days, no card), Team $49.99/mo for 5,000 credits (about a cent each; per active user, pooled), top-ups $10 per 1,000, Enterprise custom with SSO and HIPAA. Per-task credits: 2 to 250 for everyday asks, 250 to 1,000 for deep work, 1,000 to 2,500 for big builds. [read: /pricing]
- No sales-outcome numbers published (no reply rate, no meetings booked). Its sales use is a "Lead gen & outreach" role and a "deal pulse" stalled-deal example with a drafted follow-up waiting for approval. [read]
- Funding about $53M [snippet from prior doc].

**Chewbacca counterpart.** `skills/mac-brief` and `chewie brief` (morning brief), `skills/meeting-prep`, native meeting capture (`bin/room-capture`, `bin/room-listen`), `skills/texts` (drafts now, send later), `bin/work-ledger`, `bin/recur` (scheduled), `bin/chewbacca-slack`, `jev-browse` for no-API sites. Consent-line and Go-press from meetings are noted in COMPETITORS.md as built 2026-10-10.

**Steal.**

- One-line credit band per task type shown at ask time.
- "Show it once, save as a skill" is the same loop as `skill-forge` and `ux-learning`; surface it as a single phrase for a stranger.
- iMessage as the primary channel (Chewbacca replies in chat only).

**Test.** From a cold install on a second Mac, time from install to the first useful morning brief naming at least three real items from the user's own calendar, mail and texts is under 10 minutes (Lindy claims 2 minutes for setup, but it needs OAuth to hosted accounts; a 10-minute fully local result is the bar to document and then cut). Not a sales test: Lindy has no sales claim to beat, so the comparison is time-to-value and $0 versus $49.99/mo.

Sources: [lindy.ai](https://www.lindy.ai) [read], [pricing](https://www.lindy.ai/pricing) [read], [Lindy Assistant launch](https://youtu.be/m0bkNFIOLb4) [video].

---

## 11. Actively (actively.ai)

**Does best.** A persistent agent per account that holds context across the full lifecycle (top of funnel, close, expansion) and tells the rep what to do next, then does the work, with output landing in an "Agent Inbox" (prioritized, prepared, ready to act on). For AEs: research, surface risks, build close plans; for SDRs: prioritize accounts and draft outreach. The founder's pitch in the talk is that there will be "a lot more agents than sellers". Accounts are worked continuously, not on demand. [read: actively.ai; video: Anshul Gupta interview, 2,652 words, skimmed for the pitch only]

**Bar.**

- Pricing unstated on the site (demo only). A third-party directory estimates $20K/yr and up. [snippet]
- Results: the site publishes no numbers. Samsara "2x conversion on Actively-driven pipeline" and "20% productivity per rep" across Attentive, Ironclad, Abnormal, Ramp come from a company LinkedIn post. [snippet]
- Funding: Series B $45M (TCV, First Harmonic) in April 2026, $68M total. [snippet] Customers named: Samsara, Ramp, Verkada, Ironclad, SentinelOne.
- Setup time: unmeasured. Signals used: unspecified on the site. Blog titles argue against DIY GTM agents and generic intent data but carry no metrics. [read]

**Chewbacca counterpart.** None as a per-account agent. Nearest: `tools/gtm_memory.py` and `bin/gtm-memory` (client-level memory), `bin/gtme-learning`, `skills/account-research`, `skills/prospect-brief`, `skills/account-fit-rank`, `skills/disqualification-handling`, `DECISIONS.json` per client repo (per the feedback_client_rulings_first note).

**Steal.**

- An inbox where agent-prepared work waits for one tap, as the only surface (matches the Docket design in AFTER-PANES.md and the "propose, never act" rule for client-facing agents).
- Per-account context file kept current across touches: who we emailed, what they said, what is queued, so the next draft starts from state, not from the list row.

**Test.** For Zeutara's accounts that replied (positive or objection), a per-account record in `gtm-memory` that is updated on each reply with classification, next action and date, and a draft follow-up exists within one run of the daily job for 100% of positive replies, with zero follow-ups sent before Caleb's or the client's approval. Actively publishes no number to beat, so the measurable claim is coverage and latency: share of positive replies with a prepared follow-up inside 24 hours.

Sources: [actively.ai](https://www.actively.ai) [read], [blog](https://www.actively.ai/blog) [read], [Anshul Gupta interview](https://youtu.be/_91l-j4_x-I) [video], [funding coverage](https://fintech.global/2026/04/29/tcv-and-first-harmonic-back-activelys-45m-funding-round/) [snippet].

---

## Count and the hardest bars

Covered: 11 of 11 products (Dex, Mesh, Happenstance, Boomerang, Clay with Claygent and Sculptor, Unify, 11x, Origami, Artisan, Lindy, Actively). Site and pricing page [read] for all eleven except Artisan, whose pricing page returned no figures (figures are [snippet]) and Mesh, whose changelog 404ed. Demo video [video] for Dex, Happenstance, Unify, 11x, Artisan, Lindy, Actively; none for Mesh (fetch failed), Boomerang (none found), Origami (title only), Clay (blocked by shell guard).

**The three hardest bars, in order:**

1. **Reply rate on real sends.** 11x's site claims 9.7% reply and Unify's playbook claims 9.1% positive reply for product-usage signals, with 25% of replies positive at OpenPhone. The only independent number found is 3.8% to 5.1% reply (a solo test of 11x). Chewbacca has no recorded Zeutara reply rate in the repo, so it currently has no number to put against any of these. The practical bar is at least 5% reply and at least 4% positive of replies measured over 500 sends, from a traced signal, with bounce under 2%. Artisan's own published case (0.098% positive per email) is the floor, not the bar.

2. **Time to first value on a stranger's machine.** Lindy says setup in 2 minutes, Artisan's own video reaches a running autonomous campaign in about 5 minutes, Origami starts from a website URL alone. COMPETITORS.md already records that a stranger's first ten minutes with Chewbacca fail (Gmail and Calendar OAuth in Testing mode, WhatsApp QR, manual grants). Until that passes, every people and GTM claim is unfilmable.

3. **Warm-path reach with a recorded result.** Happenstance searches up to seven accounts per person and groups up to 380,000+ searchable people for free or $24/mo, and Boomerang reports 26,000 intro paths and 1,400 hours saved at one customer (second-hand). `bin/intro` has no recorded use and contacts nobody. One real, logged intro that ends in a booked meeting is the minimum evidence, and a second-degree graph (shared with a friend) is the reach gap.
