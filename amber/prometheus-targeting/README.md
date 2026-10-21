# Prometheus targeting

Turns the 1,039,715-row prometheus investor file into targeted, deduped,
Clay-ready lists.

Sagar, 2026-09-20: *"Caleb, I think the first task for you is to figure out how
to do a people search for each of the 5 companies we're fundraising. Scoring and
prioritizing this 220mb file is tough, and we need subset lists to target (as
well as enrich for more data)."*

## The file is 20x smaller than it looks

```
1,039,715  rows
  594,147  are people        445,568 are organizations, not humans
   52,350  people with an email and grade A or B
   51,320  after removing role inboxes           <- can be SENT to
   27,393  that also have a usable company name  <- can be PERSONALISED, 2.6%
```

Two numbers, and the second is the one that matters. **48% of the pool has no
usable company name**, so `{{company}}` breaks on nearly half the file. Plan
outbound against **roughly 27,000**, not a million.

### The company-name defect, which a first pass missed

Found by `chewbacca list-audit` after a hand-rolled audit of this same file
reported it clean. Four distinct kinds of junk in one column:

| Count | Value | Why it survives an eyeball check |
| --- | --- | --- |
| 9,526 | the literal string `Person` | The entity type leaked into the company column. Looks like data |
| 8,259 | blank | Obvious once you look, invisible in a row count |
| 5,879 | `Unknown`, `Company`, `company` | Looks like a real value |
| 1,289 | `11283.jpg (https://dl.airtable.com/.attachments/...)` | The source was an Airtable export and an image column got merged in |

The junk is concentrated in the segments made of individuals rather than firms,
which is why it hides: VCs mostly have real company names, angels and LPs do
not. Filtering it changed the lists enormously.

| Profile | Before the filter | After | Qualified after |
| --- | --- | --- | --- |
| `lp` | 1,626 | 181 | **3.6% → 100%** |
| `angel` | 2,460 | 654 | 89.8% → **100%** |
| `crypto` | 1,190 | 239 | 96.6% → 90.4% |
| `vc-any` | 10,784 | 9,753 | 97.2% → **97.4%** |

`lp.csv` as first generated had **18 usable rows out of 500**. Every other row
carried `organization = "Person"`.

### The stranger-LinkedIn defect

`list-audit` also found that where a LinkedIn slug shares no token with the
person's name, **89.7% are confirmed wrong** when triangulated against the email
domain. Christopher Hehmeyer's row carried `/in/shannon-collins-thackray`.
Personalising off a stranger's profile is worse than not personalising, because
it is specific and wrong. `target.py` now blanks any slug it cannot vouch for
and keeps the row. That cleared the defect on seven of the eight lists.

**Run `chewbacca list-audit <file>` on anything before building a sequence on
it.** It caught both of these and a hand-written audit caught neither.

## What it can and cannot segment on

This is what made the file tractable. It is an **investor** database, and
`org_type` is filled on 100% of the pool:

```
VC             16,116      LP              3,424      Endowment     47
Investor        9,935      PE              2,264      Founder       34
Family Office   9,693      Corporate       2,042      Invest. Bank   6
Angel           8,419      Pension           297      Hedge Fund     5
                           Accelerator        68
```

Fill rates inside the pool, which decide what a filter costs you:

| Field | Fill | Usable for targeting |
| --- | --- | --- |
| `org_type` | 100% | Yes, always. This is the primary axis |
| `region` | 89% | Yes |
| `organization` | 75% | Yes |
| `title` / `seniority_tier` | 70% | Yes |
| `city` | 65% | Mostly |
| `sectors_norm` | 57% | **Careful.** Filtering by sector silently drops 43% |
| `linkedin` | 34% | Enrichment target, not a filter |
| `aum` | 12% | No |
| `check_size` | 5% | No |

**The one that will bite you is sector.** `sectors_norm` is blank or "unknown"
on 43% of the pool, so a sector filter quietly discards nearly half the list
including investors who would have been a fit. `target.py` prints a warning on
every sector-filtered run instead of letting a short list look like a small
market. The `vc-ai` profile returns 290 people; the same query without the
sector filter returns over 10,000. Most of that gap is missing data, not
absent investors.

**Enrichment priority, in order:** sector on the 43% that lack it, then
LinkedIn on the 66% that lack it, then check size. Sector is what makes the
difference between one list and five.

## Data quality, checked rather than assumed

- **0 malformed email addresses** out of 52,350. Hygiene on this file is good.
- **0 duplicate emails.** The one-per-email dedupe in the tool never fires; it
  is a safety net, not a fix.
- **984 role inboxes** (`info@`, `contact@`, `office@`) attached to real
  people's names, so they pass a spreadsheet eyeball. Filtered out. That is
  1.9% of volume and worth more than it costs, because a personalised founder
  email to `info@` is how a sending domain gets burned.
- **583 unusual TLDs** (1.11%), checked by hand and almost all legitimate:
  `generalassemb.ly`, `round.glass`, `packard.place`, `brad@periodic.is`. Not a
  defect. Do not filter these.

## Use

```bash
python3 tools/target.py --audit                         # what the file supports
python3 tools/target.py --profile vc-any --limit 500 --out lists/vc-any.csv
python3 tools/target.py --org-type "VC,Angel" --sector ai --region "united states"
python3 tools/target.py --profile angel --all-seniority # below founder/CXO too
```

Ranking is founder/CXO first, then grade A over B, then `grade_score`, then
whether a LinkedIn URL exists. It happens in Python rather than SQL so the
order is inspectable.

## Profiles

| Profile | Who | Pool at founder/CXO tier |
| --- | --- | --- |
| `vc-any` | Every VC and generalist investor | 9,753 |
| `family-office` | Family offices | 6,058 |
| `pe` | Private equity | 999 |
| `angel` | Angels, smallest check, fastest yes | 654 |
| `fintech` | Fintech, financial services, banking | 504 |
| `vc-ai` | AI and software VCs | 284 (sector filter, see warning above) |
| `crypto` | Crypto-exposed | 239 |
| `lp` | LPs, pensions, endowments. Fund raises, not company raises | 181 |

Counts are after the company-name filter, so they are what you can actually
send. `--any-company` restores the junk if you want the larger, unusable number.

Pre-generated lists of 500 each are in [`lists/`](lists/).

## What still needs a human

**Which five companies are raising.** `~/Downloads/One-Pagers/` holds
one-pagers for Zeutara/Goldies Good Vibes, Ivy, Kallu Brand, MortgageFi, Qube
Finance, RagMetrics, TRN Global and Vertocol, which is eight, and the three
touched most recently are Kallu, Qube and TRN. Naming the actual five turns the
generic profiles above into five real lists, and it is one sentence from Sagar
or Kaushik.

Once they are named, each one gets its own profile entry here rather than a
re-derived query, so the list can be regenerated when the data is enriched.

Built with Chewbacca

All glory to God! ✝️❤️
