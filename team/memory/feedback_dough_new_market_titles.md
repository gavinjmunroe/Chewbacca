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

The first rerun still found a buyer at 1 of 145 firms, because there were two more holes.
Dough's own LEADER filter in tools/gtme_accounts.py also lacked law words and kept only 3
leaders, sorted IT first, so Marko Law's IT director beat its founder (fix 9bf2cb40 on
fix/gtme-accounts-law-buyers). And small firms name the owner in a bio paragraph ("Alyssa
Vanstone is the founder of..."), which find_contacts skipped as an over-140-character line
(BIO_ROLE, on fix/audit-law-titles). Check the buyer fill count on the first 20 rows before
running all of them: a fill near zero means the reader is blind to that market.

Caleb, after: "Dough should be able to take on ANY ICP". So the accounts block's `titles` now
drive the reader (audit `buyer_titles`, branch fix/audit-law-titles) and Dough's leader filter
(6de54177 on fix/gtme-accounts-law-buyers), and a full run first reads 20 sites and refuses
when under 20% have a buyer. A new market is a config change, not a code change.

Jev is not a name check. On the 31-buyer run, 5 "buyers" were page text ("Managing
Attorney", "Firm Founder", "Recent Articles") and Jev passed them at 0.82 to 0.91. Names are
now guarded in code twice: ORG_NOT_NAME in the reader and is_person() in gtme_accounts
(29d2dcc8). Read every buyer name by hand before a list goes to a client.

The upgrade that followed (icp.must_show, maps and linkedin_jobs sources, own-site buyers,
--find-emails) hit two traps worth knowing. A new helper named org_key silently replaced an
existing org_key(row) used by dedupe, caught only because a test called it. Grep a module for
a name before adding one. And any page check that follows scraped links has to stay on the
org's own http(s) host, or a planted href reads file:// or localhost (same_site, 57a1972a).

A site Dough can't read is unknown, never a no. Sinas Dramis, a leading Michigan no-fault firm,
answered 403 and was scored "no PIP work" until icp_evidence learned to return unread (5011db02).
Before trusting a cut, sample 15 rejected rows by hand; that sample is how this one surfaced.

How to apply: before `chewbacca gtme accounts` runs for a new market, write two lines of
that market's real staff page into a find_contacts test with titles="org". If the buyer
doesn't come back, add the titles first. Run with GTME_SITE_AUDIT_DIR pointing at a clean
worktree when the firm-foundation checkout is dirty or behind.
