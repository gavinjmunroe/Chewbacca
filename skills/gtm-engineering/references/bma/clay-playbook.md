# Clay playbook: lists, prompts, templates, credits, webhooks

Synced from togari-sandbox adace00.

The team's standard for running Clay so outreach stays cheap and traceable.
Read it before building a table, writing a Claygent or AI column, or turning on
auto-run. Webhook mechanics (signatures, row caps, reply actions) are in
[vendor-recipes.md](vendor-recipes.md).

## List building

**The goal** is a targeted, deduplicated list that matches the ICP and can go
straight into enrichment, scoring and outreach. Every list should:

- map to one clearly defined ICP and persona;
- be filtered enough that no credits go to bad-fit accounts;
- be structured so each row flows into enrichment, scoring and outreach with
  minimal cleanup.

**Which source to use:**

| Source                      | Use it when                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clay native, Find Companies | Starting from nothing. Net-new accounts from ICP filters (industry, size, location, keywords). Top of funnel.                                          |
| Clay native, Find People    | The company segment is known and you need decision makers or personas (titles, seniority, departments). Usually runs after Find Companies.             |
| Exa                         | You need content- or intent-based search: companies or people found by what they publish or engage with, or niche keywords. Also to save Clay credits. |
| CSV upload                  | The client hands over an existing list (CRM export, event list, Sales Navigator export) that needs cleaning, dedup and enrichment.                     |

**Standard fields on every list:**

- Company lists: company name, website, domain, industry, size, location when
  it matters, and any ICP tags already known.
- People lists: full name, title, company, domain, LinkedIn URL when
  available, and persona tags.
- Always a **Source** column (LinkedIn search, CSV upload, Exa query) and a
  **Campaign / Play** column tying the list to one motion.

**Practices:**

- Go ICP, then segment, then source. Never grab everything and filter later.
- Filter on industry, size, geography and keywords early, before enrichment.
- Dedupe by domain or email whenever sources merge (CSV plus LinkedIn plus
  Exa).
- Tag every list by client and campaign so reporting and debugging are easy.

**Mistakes to avoid:**

- Pulling a broad list and burning credits enriching unqualified accounts.
- Mixing very different ICPs in one table. Make separate, clearly named lists.
- Skipping the Source column, which makes bad data impossible to trace.

## Prompts (AI columns, Claygent, scoring, ICP intake)

Use prompts for ICP scoring, scrape instructions for Clay's prompt-to-search
features, and ICP document intake. When a client sends an ICP document, run it
through a model to pull out what they're asking for: per-segment scrape
instructions, step-by-step list-building instructions, context analysis.

**Rules for a prompt that works in a column:**

- Name the one task: research, scoring, summarising, segmenting or enrichment
  support.
- Give the context the model needs: ICP details, target industry, persona,
  offer, and what the output will be used for.
- Ask for structured output: bullets, categories, labels, short summaries or
  clearly separated fields.
- Keep output short when it lands in a Clay column or feeds another prompt.
- Split big jobs. Don't research, summarise, score and categorise in one
  prompt; chain smaller stages.
- Define what "qualified", "relevant" or "high fit" means for this workflow.
  Don't leave it ambiguous.

**Output shapes that work well in Clay:**

- a 0 to 100 score with a tier label;
- an ICP fit label;
- a persona-match explanation;
- an industry bucket;
- a bullet list feeding a scrape or enrichment step;
- true/false or high/medium/low with a separate reason field.

**Two prompt patterns worth reusing:**

- _ICP document intake:_ "Analyze this document from {client}. For each company
  segment, write a bullet list telling Clay's search what to scrape for."
- _Building a scoring prompt:_ give the model the target market, the size sweet
  spot, the revenue band (enough to afford the service, not so large they've
  built it in-house), how likely they are to outsource, the priority
  industries, and one named example of an ideal customer. Ask it to return a
  0 to 100 scoring prompt that singles out the top 10% most likely to become
  high-value contracts.

## Templates and column colours

**Colour convention**, so anyone can read a table at a glance:

| Colour | Column type      |
| ------ | ---------------- |
| Blue   | Formulas         |
| Red    | CRM              |
| Green  | AI               |
| Purple | Not yet assigned |

**When to make a template:** a workflow gets duplicated across tables, reused
across clients, or rebuilt by several people. Template only workflows that are
already tested and reliable.

**Template rules:**

- Keep it modular: sourcing, enrichment, scoring and output steps can each
  change without rebuilding the rest.
- Name columns so any teammate understands the table quickly.
- Strip client-specific details before saving: names, filters, URLs, one-off
  prompt logic.
- Standardise the final outputs: qualification status, research summary,
  persona fit, next-step recommendation.

## Credits

Clay charges in two currencies.

**Actions** measure orchestration. One per enrichment run, one per AI call, one
per export or GTM task (CRM push, send to a sequencer). Each costs about $0.001
or less.

**Data credits** pay the data providers:

| Enrichment                                         | Data credits                 |
| -------------------------------------------------- | ---------------------------- |
| LinkedIn enrichment                                | 1                            |
| Email find                                         | 0.7 to 1.1                   |
| Phone number, basic                                | 2 to 5                       |
| Phone number, mobile or hard to find               | 5 to 25, by provider         |
| Claygent AI research                               | varies by task               |
| Fully enriched record (email + company + LinkedIn) | 6 to 20 total                |
| A lookup that finds nothing                        | 0, no result means no charge |

**Bring your own keys.** Connecting your own Apollo, ZoomInfo, Clearbit or
similar key removes that provider's data-credit cost. You still pay one action
per run.

**Cost by plan:**

| Plan       | Per data credit | Per action   |
| ---------- | --------------- | ------------ |
| Free       | $0              | $0           |
| Launch     | $0.067          | under $0.001 |
| Growth     | $0.074          | under $0.001 |
| Enterprise | negotiated      | under $0.001 |

Plan prices change; check Clay's pricing page before quoting a number to a
client.

**Credit practices:**

- Set run conditions so a column runs only on the rows that need it.
- Leave auto-run off until you're fully confident in the workflow.
- Test every enrichment on a few rows first and check the output is what you
  wanted.
- Measure the credit cost of one row before running a column on the table.

## Webhooks into Clay

A webhook lets another app push events into a Clay table as they happen.
Typical pairings: sequencer replies flowing to Slack through Clay, and website
visitor tracking.

**Setup:**

1. Add a Webhook source to the table in Clay and copy its URL. Paste it into
   the app where the event happens. Treat the URL as a secret.
2. Trigger a test event so Clay receives a real sample payload.
3. Confirm the payload arrived intact, then map the fields you want into
   columns.
4. Build enrichments on top of the payload columns.

Remember the limits from [vendor-recipes.md](vendor-recipes.md): one object per
POST, push in batches of at most 500 rows with 5 in flight, and verify signed
callbacks against the raw body.
