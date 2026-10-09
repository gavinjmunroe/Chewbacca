---
name: startup-finance
description: Startup and student-org finance with real arithmetic instead of guesses. Use for runway, burn, cash-out date, hiring scenarios, Delaware franchise tax (assumed par value vs authorized shares), 1099s and W-9s, tax deadlines, bookkeeping categories for a bank or card CSV, duplicate charges, unused SaaS seats, spend spikes, and a personal daily budget or savings-goal date. Also use when a founder pastes a bank export, asks "how long do we have", "what do we owe Delaware", or "should we hire".
---

# startup-finance

Answers money questions for a small startup or club by running a script on the real numbers, then reading the output. It never moves money, files anything or gives tax advice; it prepares figures for a human or a CPA.

Adapted from countinghouse and dime by Charles Zheng (MIT): https://github.com/goodnight000/countinghouse and https://github.com/goodnight000/dime. License text in `LICENSE`. Dime ships no license file as of 2026-10-09, so only its formulas and thresholds were re-implemented here, none of its code.

## Never

- Never estimate a number from memory. Run `scripts/finance.py` on the user's data first.
- Never state a tax rule, rate, threshold or deadline as current fact. Every figure in `data/` is the source's claim from 2026-09-27 and carries a `verify` field. Say "per the source, verify at IRS/Delaware" and surface the field.
- Never invent a balance, revenue figure, share count or gross-asset number. Ask for it, or leave `[NEED: ...]`.
- Never file, pay, cancel or transfer. Output is a proposal.
- Never assume the entity is a Delaware C-corp. Ask. A student organization (an RSO such as TTS) usually has no franchise tax or 1120; an LLC has a different calendar.

## Run it

```bash
S=skills/startup-finance/scripts/finance.py
python3 $S franchise-tax --authorized 10000000 --issued 8000000 --gross-assets 1579472
python3 $S categorize bank.csv [--learned learned.json] [--format csv]
python3 $S leaks bank.csv [--logins logins.json]
python3 $S contractors bank.csv --year 2026 --w9 "Vendor A,Vendor B"
python3 $S runway --cash 2100000 --expenses 220000 --revenue 40000 --hires 2
python3 $S calendar --within-days 120 --has c_corp,delaware,payroll,contractors
python3 $S daily-number --income 3200 --bills 1700 --spent-month 200 --spent-today 7
python3 $S girl-math --price 280 --goal-price 1099 --saved 400 --sweeps 12,10,14
```

Everything prints JSON. CSV columns (case-insensitive): `date`, `amount` (money out is negative), `description`; optional `account`, `receipt` (yes/no), `id`. Tests: `python3 -m pytest skills/startup-finance`.

## What each piece knows

**Delaware franchise tax.** The default notice uses the authorized-shares method: $250 for the first 10,000 shares plus $85 per additional 10,000 or part, so 10M authorized shares gives $85,215 with the $50 report. The assumed par value capital method is gross assets / issued shares, times authorized shares, then $400 per $1M or part, minimum $400. The same company owes $850. File with the lower. Due March 1. Gross assets come from the real balance sheet at year end, so ask for it. Details and the worked examples are in `data/franchise-tax.json`.

**Bookkeeping categories.** `data/rulebook.json` maps 44 raw bank descriptors to a vendor and one of 18 categories. First match wins; order matters (GUSTO TAX above GUSTO). A user correction is a learned rule: save it in a `learned.json` and pass `--learned`. Unmatched rows come back `Other` + `needs_review`; ask the user, do not guess.

**Leaks.** Duplicate: same vendor and exact amount on a card within 3 days. Unusual: first-ever payment of $5,000 or more, or over 4x the vendor median with 4+ charges and over $2,000. Unused SaaS: zero SSO logins in 90 days while still billed. Spike: last month 30 percent above the prior three-month average and at least $500 (that threshold is guessed, see `data/thresholds.json`). Missing receipt only counts on money out.

**1099 and W-9.** Source threshold is $600 and says lawyers count; a newer law may have raised it, so the output carries a `verify`. Collect a W-9 before the first payment; the source cites 24 percent backup withholding without one. The script lists candidates only.

**Runway.** Cash / net burn, where net burn = expenses - revenue - interest. Use the last three months averaged, not one month. A hire costs salary x 1.25 / 12 a month (25 percent load for taxes and benefits). The source tells a founder to start fundraise prep with 9 months left, and warns under 12. "Default alive" means revenue covers expenses.

**Tax calendar.** `data/tax-calendar.json`: 941 and DE 9 quarterly (Apr 30, Jul 31, Oct 31, Jan 31), estimated tax (Apr 15, Jun 15, Sep 15, Dec 15), 1099-NEC, W-2 and 940 (Jan 31), Delaware (Mar 1), Form 1120 and R&D credit (Apr 15). The script rolls weekends, not holidays. The California SOI date depends on the incorporation month.

**Personal budget (from dime).** Today's number = floor((income - bills - invest - spend so far - sweeps) / days left including today) - spent today. The leftover sweeps to a goal at midnight and leaves the pool, so under-spending never inflates tomorrow, and overspending shrinks tomorrow on its own. Girl math: pace = average sweep over 7 days (else a quarter of today's number, never under $1); skip date = ceil(remaining / pace); a purchase delays the goal by price / pace, said in hours when under a day. Dime's principles worth keeping: every number is computed and the model only words it; nothing moves without explicit approval; show progress to others, never balances; a 24-hour wait on a big impulse buy; money for a goal under 2 years out belongs in cash, over 2 years an index fund (education, not advice). Its detector thresholds (a bill up by $5 and 10 percent, a subscription idle 30 days, a trial ending within 7 days, idle checking above 1.5 months of bills) are in `data/thresholds.json`.

## Answering

Lead with the answer in one sentence, then the numbers behind it. Report spend as positive dollars. Name the next action when something needs one: missing receipt, duplicate to dispute, a deadline inside 30 days, a contractor without a W-9. For a what-if, rerun `runway` with the change and compare to the baseline. Hand anything involving filing to a CPA.

## For this user's orgs

Amber, TTS and BMA are different entities with different obligations; ask which one and what its legal form is before using the calendar. Ask for the bank export before answering a categorization or leak question. Read the CSV they hand over and write nothing back.
