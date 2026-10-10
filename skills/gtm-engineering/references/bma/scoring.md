# Scoring rubrics for contacts, accounts, leads and signals

Synced from togari-platform 0b7d51d and togari-sandbox adace00.

Every number below is the full rule. Nothing here needs the source repos to
apply. Each section says what the score is for and when Chewbacca uses it.

## 1. Primary contact at a company

**What it's for:** picking the one person to reach at an account when an
enrichment returns several candidates. The reasons that fired are kept with the
pick, so a human can see why this person won.

**When Chewbacca applies it:** after a people search or enrichment returns more
than one contact for a target account, before any sequence enrollment.

| Rule                                                              | Points |
| ----------------------------------------------------------------- | ------ |
| Title matches an owner-target title (substring, case-insensitive) | +40    |
| Has an email that is marked verified                              | +20    |
| Has a mobile phone                                                | +15    |
| Has a LinkedIn profile URL                                        | +10    |
| Last activity within the past 90 days                             | +10    |
| Tenure at the company of 10 years or more                         | +5     |
| Title contains former, ex, ex-, interim or advisor                | -20    |

- Default owner-target titles: CEO, Chief Executive Officer, Founder,
  Co-Founder, Owner, President, Managing Partner. A campaign can replace this
  list with its own thesis titles.
- The penalty is applied first so it stays visible even when bonuses fire.
- The title bonus fires once, on the first matching keyword.
- **Tie rule:** if the top two are within 5 points, every candidate within 5
  points of the leader goes to a model tiebreaker with the company and thesis as
  context. If the model fails or returns an id that isn't in the candidate set,
  the rule-based leader wins and the reason says so.
- Zero candidates is an error for the caller to handle, never a silent skip.

## 2. Account tier against a thesis

**What it's for:** sorting enriched accounts into tier 1 (call now), tier 2
(partial match worth a call) and tier 3 (adjacent, nurture).

**When Chewbacca applies it:** after a fit score (0 to 100) exists for an
account and the primary-contact step has run.

| Tier | Rule                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 1    | Fit score 80 or higher, a primary contact exists, and revenue or headcount sits inside the thesis band |
| 2    | Fit score 60 or higher (including an 80+ account that fails a tier 1 condition)                        |
| 3    | Everything else                                                                                        |

- **Escalation band:** a fit score within 5 points of either threshold (75 to
  85, or 55 to 65) goes to a model for the final call plus a written rationale.
  If the model is unavailable, the rule-based tier stands and the rationale says
  so.
- An account with no reachable contact is never tier 1. You can't call a company
  you can't reach.
- The thresholds are conservative on purpose: a marginal account in tier 3
  costs little, a real tier 1 buried in tier 3 costs a lot.

## 3. Relationship strength between two people

**What it's for:** a 0 to 100 score of how warm a connection is, from an
interaction log (email, meetings, texts, calls). It decides who to ask for a warm
intro and which relationships have gone cold.

**When Chewbacca applies it:** warm-intro routing, `people` relationship views,
and ranking which existing contact at an account should make the ask.

| Component         | Weight | How the 0 to 100 component is computed                                                                                      |
| ----------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Frequency         | 0.30   | Each interaction counts 0.5 raised to (age / 30 days); 10 recency-weighted interactions maps to 100, capped                 |
| Recency           | 0.25   | 100 times 0.5 raised to (days since last / 30). 0 days is 100, 30 is 50, 60 is 25                                           |
| Channel diversity | 0.15   | 25 per distinct channel, so 4 or more channels is 100                                                                       |
| Both-ways contact | 0.15   | Two-way: 50 plus 50 times (smaller direction count / larger). One-way only: 25. None: 0                                     |
| Duration          | 0.15   | 25 times ln(1 + months since first interaction), capped at 100. 1 month is about 17, 12 months about 64, 48 months about 97 |

- **Half-life is 30 days** for both frequency and recency.
- A "bilateral" interaction (a meeting) counts toward both directions.
- No interactions means every component is 0.
- Composite is the weighted sum, rounded and clamped to 0 to 100.

## 4. Signal strength, 1 to 10, with the HOLD rule

**What it's for:** deciding whether this account gets an email this week. The
signal has to answer "why now, and not any other week".

**When Chewbacca applies it:** before writing any cold email. The score gates
copy generation.

| Score   | What it takes                                               | Example                             |
| ------- | ----------------------------------------------------------- | ----------------------------------- |
| 9 to 10 | Company-specific and time-sensitive, from the last 30 days  | New CRO hired, Series B closed      |
| 7 to 8  | Relevant industry signal plus a company match, last 60 days | A competitor moved into their space |
| 5 to 6  | Category relevance with no timing trigger                   | "They are in digital health"        |
| 3 to 4  | Tangential connection, weak timing                          | An industry conference happened     |
| 1 to 2  | No real signal                                              | The company exists                  |

- **Below 6 is HOLD.** Don't write the email. Output what stronger signal to
  look for instead.
- The research step looks back 90 days for: funding (amount, round, lead),
  executive hires (sales, strategy, partnerships, data, product), launches,
  conference or keynote slots, press on expansion, job posts that reveal intent
  (ten enterprise AE openings means going upmarket), regulatory filings,
  announced partnerships, and earnings or investor-day commentary.
- Keep the top 3 external signals, each with source and date.
- Ask honestly whether the timing is real or just a plausible reason to email.
  If it's weak, say so.
- **The why-now sentence format:** "[Company] just [specific signal], which
  means they are about to [specific implication], and we have [specific asset]
  that maps directly to that move."
- If you hold no company-level data, a segment-level proxy is allowed but must
  be labelled segment-level.

## 5. Lead scoring constants and routing tiers

**What it's for:** a composite lead score that routes inbound and outbound
leads to high-touch, standard, nurture or disqualify. Built for a healthcare
CRM, but the channel, budget, authority and maturity tables are general.

**When Chewbacca applies it:** scoring a mixed-source lead list where the
source channel and company size are known, or routing inbound leads.

**Routing tiers on the composite (0 to 100):**

| Tier       | Range     |
| ---------- | --------- |
| High touch | 80 to 100 |
| Standard   | 60 to 79  |
| Nurture    | 40 to 59  |
| Disqualify | 0 to 39   |

Composite is 50% internal score and 50% external score. New leads default to
nurture with scores of 0. A new relationship defaults to strength 50.

**Source channel points:**

| Channel           | Points |
| ----------------- | ------ |
| Warm referral     | 25     |
| Event             | 20     |
| Partner           | 18     |
| Inbound marketing | 15     |
| Direct            | 12     |
| Social media      | 12     |
| Paid ads          | 10     |
| Cold outbound     | 10     |

**Budget points by employee count:** 0 to 10 is 5; 11 to 50 is 10; 51 to 200
is 15; 201 to 500 is 20; 501 and up is 25.

**Authority points by role:** decision maker 25, influencer 15, champion 12,
unknown 10, end user 8, gatekeeper 5.

- Decision-maker title keywords: ceo, chief executive, founder, co-founder,
  president, owner, partner, managing director, vp, vice president, director,
  head of, chief, cto, cfo, cmo, coo, cio, cpo.
- Influencer title keywords: manager, senior, lead, principal, architect,
  specialist, analyst, consultant, advisor, strategist.
- Check decision-maker keywords first. "Senior Director" is a decision maker.

**GTM maturity points from the tech stack:** high 25, medium 15, unknown 10,
low 5.

- High: salesforce, hubspot, marketo, pardot, outreach, salesloft, gong, chorus,
  clari, seismic.
- Medium: pipedrive, zoho, mailchimp, constant contact, activecampaign,
  intercom, drift, calendly.
- Low: spreadsheet, excel, google sheets, email only, manual.

**Vertical keywords** (match company name or title to tag a vertical):

- Healthcare: hospital, clinic, medical center, health system, physician,
  doctor, healthcare, health care, medical, clinical, patient, nursing,
  surgical, cardiology, oncology, pediatric, orthopedic, dermatology, radiology.
- Mental health: therapy, therapist, counseling, counselor, psychologist,
  psychiatrist, mental health, behavioral health, psychology, psychiatric,
  addiction, recovery, mindfulness.
- Wellness: wellness, spa, massage, acupuncture, chiropractic, holistic,
  integrative, naturopath, nutrition, dietitian, weight management, preventive.
- Fitness: fitness, gym, personal trainer, crossfit, yoga, pilates, athletic,
  sports medicine, physical therapy, rehabilitation, strength, conditioning.
- Digital health: telehealth, telemedicine, digital health, health tech,
  healthtech, medtech, ehr, emr, health app, remote monitoring, wearable, ai
  health, health ai.
- Medical supply: medical device, medical equipment, medical supply,
  pharmaceutical, pharma, biotech, life science, diagnostics, laboratory,
  imaging, prosthetics, implant.

**API pacing used alongside scoring:** Exa 100 requests a minute (200 ms
apart), Clay 60 a minute (1 s apart).

## 6. Company-name variants for vendor lookups

**What it's for:** ZoomInfo, state business registries and similar APIs match
on their stored name string. A legal suffix, abbreviation dots or "&" against
"and" returns zero results or the wrong company.

**When Chewbacca applies it:** when a company search returns nothing, retry
with each variant in order before giving up. Also when deduping accounts across
sources.

Generate, deduplicated, original first:

1. Try the original name as given.
2. Strip the legal suffix, checking the longest forms first: Co. Inc, Co. LLC,
   L.L.C, Inc, LLC, Ltd, Corp, Co, LP, LLP, Incorporated, Corporation, Company,
   Limited. After one strips, keep stripping, so a name ending in both Co and
   Inc loses both.
3. Remove the dots inside abbreviations, on the original and on the stripped
   form, so that MB Kiser comes from the dotted initials and JS Thomas from
   the dotted pair.
4. "&" swapped with "and" both ways, on the dot-free stripped form and on the
   stripped form.
5. A joined prefix when the first word is 2 or 3 capital letters and more
   words follow: "GA Central Mechanical" becomes "GACentral Mechanical".

Example: "JS Thomas Service, Inc." yields the original, then "JS Thomas
Service", then "JSThomas Service". A name with dotted initials, an ampersand
and "Co. Inc" yields four forms: original, suffix gone, dots gone, and the
"and" spelling.

**For similarity comparison** (not for search) normalise harder: lowercase,
strip inc, llc, ltd, corp, co, company, incorporated, corporation; then "&
associates", "and associates", "associates"; then services, solutions,
consulting, group; then turn punctuation into spaces and collapse whitespace.

## 7. Contact-to-company affiliation and mismatch detection

**What it's for:** catching enrichment results that attach the wrong person to
an account before they're saved or emailed.

**When Chewbacca applies it:** on every enriched contact, before writing it to
a list or CRM. An auto-reject drops the row; a warning flags it for review.

**Step 1, obvious mismatch (auto-reject, score 0):**

- The contact's company name carries an industry word the target's name
  doesn't: equipment; architectural or elements; capital, partners, holdings,
  equity or investment (finance, unless the target says capital or partners);
  law, law firm, law office, law group; insurance; real estate.
- The first significant word (over 3 letters) of the two normalised names has
  Jaro-Winkler similarity under 0.5, and the email domain's similarity to the
  target website domain is under 0.4.
- The email domain is not personal, the base domains (TLD removed) have
  similarity under 0.4, and either the email domain carries an industry word
  the target domain doesn't (doctor, medical, health, care; equip, machine,
  tool; architect, design, build; law, legal, attorney) or the similarity is
  under 0.3.

**Step 2, score 0 to 100 = 60% domain score + 40% name similarity:**

| Email domain case                  | Type             | Domain score         |
| ---------------------------------- | ---------------- | -------------------- |
| Personal provider (list below)     | personal         | 50                   |
| Exact match to website domain      | company match    | 100                  |
| Same last two labels (a subdomain) | company match    | 90                   |
| Jaro-Winkler over 0.8              | company match    | similarity times 100 |
| Jaro-Winkler over 0.5              | unknown          | similarity times 60  |
| Otherwise                          | company mismatch | 20                   |
| No email                           | unknown          | 0                    |

- Name similarity is Jaro-Winkler on the normalised names. With no company name
  on the contact, use 0.5 (benefit of the doubt).
- Warnings: personal domain always ("cannot verify affiliation"); unknown type
  under 70; any company mismatch.

**Personal email domains** (allowed, but affiliation can't be verified):

gmail.com, googlemail.com, yahoo.com, yahoo.co.uk, ymail.com, rocketmail.com,
aol.com, hotmail.com, hotmail.co.uk, outlook.com, live.com, live.co.uk,
msn.com, icloud.com, me.com, mail.com, protonmail.com, proton.me, comcast.net,
att.net, verizon.net, bellsouth.net, sbcglobal.net, cox.net, charter.net,
flash.net, frontiernet.net, frontier.com, earthlink.net, peoplepc.com,
windstream.net, windstream.com, centurylink.net, centurytel.net,
embarqmail.com, netzero.net, juno.com, optonline.net, optimum.net,
suddenlink.net, twc.com, roadrunner.com, rr.com, cfl.rr.com, wi.rr.com,
ny.rr.com, nc.rr.com, tx.rr.com, consolidated.net, snet.net, swbell.net,
pacbell.net, ameritech.net, nvbell.net, cableone.net, mediacombb.net,
wowway.com, wccs.net, mchsi.com, q.com, lisco.com, epix.net.

That's 63 domains. The regional ISP ones come from people-search vendors that
return home addresses for small-business owners, so expect them on SMB lists.
