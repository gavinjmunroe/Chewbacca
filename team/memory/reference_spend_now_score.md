---
name: reference-spend-now-score
description: "spend_now ranks a creator-GTM client's brands by dated, Jev-confirmed creator-spend evidence; kit code tools/creator_gtm/spend_now.py, config in the client file, 0 Clay credits"
metadata:
  type: reference
---

`tools/creator_gtm/spend_now.py` (landed 6bd465d6, 2026-10-16) scores which brands are
spending on creators now. It was built for Sabo, who on the 10/16 call wanted to taper to
brands that "actually have money" and said budgets reset around Jan 1.

- Usage: `python3 tools/creator_gtm/spend_now.py <client.json> columns|collect|add --file x.jsonl|check|score|write [--live]`. Dry run by default.
- Everything client-specific is the `spend_now` block in `~/.chewbacca/gtm/clients/<client>.json`:
  signals (kind, weight, label, Jev question), window, budget_reset, column names, brands, ATS slugs.
  Evidence lives in `<client>.spend-evidence.jsonl` next to it, one dated line per item.
- An item scores only with a date, an http URL and Jev's yes. Jev answers yes/no per item; the
  score is arithmetic (newest yes per kind, full weight to 90 days, half to 180, half again
  before the budget reset), so the same evidence always gives the same number.
- Writes are plain columns and cells: 0 Clay credits (balance 3038.8 before and after on Sabo).
- Free dated hiring data: public ATS feeds answer with no login. Greenhouse
  `boards-api.greenhouse.io/v1/boards/<slug>/jobs` (first_published), Ashby
  `api.ashbyhq.com/posting-api/job-board/<slug>` (publishedAt), Workable
  `apply.workable.com/api/v1/widget/accounts/<slug>` (published_on). All checked live 10/16.
  Lever's shape is from docs only. LinkedIn's guest job search returned HTTP 429 the same day.
- Title words are recall, Jev is precision: Celsius had 13 creator-word posts in 180 days and
  all 13 were paid field or campus ambassadors, a NASCAR deal or a community role. Jev said no
  to every one, which is why the hiring question names own-staff ambassadors as no.
- Run-club season sponsors (Diplo's Run Club: Altra, Barry's, Bilt, WHOOP, Kane, Crewfare,
  Beach Juice) date from the season's events in the window, not the June announcement.
- Not done: no schedule (weekly `collect` then `write --live` belongs on Railway, needs Jev
  reachable there), and outreach scores 0 until a client's creators' inbound pitches are readable.
