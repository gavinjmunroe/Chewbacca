---
name: reference_target_account_match
description: tools/target_accounts.py decides in code whether an employer is on a client's target account list (domain, then parent domain, then exact normalized name) and whether two people overlapped at a company; a model's match is only a hint (2026-10-16)
metadata:
  type: reference
---

`tools/target_accounts.py` is the deterministic target-list matcher for any client. Use it whenever a list of accounts meets a list of employers: warm-intro paths, Sabo brand lists against a creator's past sponsors, or a Zeutara lead list against an investor's portfolio.

- `match <sheet.csv> < employers.jsonl` prints one verdict per line with `basis`: `domain`, `parent_domain` (the sheet cell pointed inside a bigger company, like cognizant.com/us/en/trizetto) or `name`.
- Names are compared after dropping case, punctuation, legal suffixes and any parenthetical. Words like "health" and "hospital" are kept on purpose, so Baptist Health and Baptist Health South Florida never match, and a bare abbreviation like "UHS" never matches either.
- `overlap <bridge_start> <bridge_end> <joined_year>` answers whether a bridge and a buyer overlapped there: yes, possible (same year), no, or unknown when a year is missing. It never guesses a year.
- A model saying two companies match is kept as a hint and labelled that way. On a real run a model missed Brown & Toland under its parent Altais, and called Tenet Healthcare a different company from Tenet until the domain came back.
- The 13 tests in `tests/test_target_accounts.py` cover each of those cases.
