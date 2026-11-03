---
name: feedback_dough_new_market_titles
description: Dough's site audit only knows the buyer titles of markets it has run; check ORG_TITLES before any new market
metadata:
  type: feedback
---

Dough's site audit (firm-foundation ops/audit/audit_site.py) picks buyers by title from
ORG_TITLES (org mode) or BUYER_TITLES (churches). It only knows titles from markets it has
already run: churches, nonprofits, companies with a CEO, CTO or COO.

On 2026-11-02 the AuraPath Michigan PIP law firm test (145 firms, for Travis Johnson) started
running before anyone checked, and law firm buyers (managing partner, founding partner, firm
administrator) matched nothing. Every firm would have come back with no buyer. The fix was
commit e4adc25 on branch fix/audit-law-titles: a "law" title group, exclusions for associates,
paralegals, of counsel and law clerks, attorney and lawyer pages as staff pages, and 6 tests.
Caleb, same night: "my caereer and reputation are on the line and I have a client to serve".

How to apply: before `chewbacca gtme accounts` runs for a new market, write two lines of
that market's real staff page into a find_contacts test with titles="org". If the buyer
doesn't come back, add the titles first. Run with GTME_SITE_AUDIT_DIR pointing at a clean
worktree when the firm-foundation checkout is dirty or behind.
