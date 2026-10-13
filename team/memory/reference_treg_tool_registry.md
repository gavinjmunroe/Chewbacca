---
name: reference_treg_tool_registry
description: "treg.to (superdesigndev/treg) is a pay-per-call gateway to ~3,900 data endpoints from 111 providers; Chewbacca uses it, optionally, to find and verify emails on the own-inbox gtme path"
metadata:
  type: reference
---

treg (treg.to, github.com/superdesigndev/treg) is Superdesign's "OpenRouter for agent tools": one
`X-Treg-Token` reaches about 3,900 catalogued endpoints from 111 providers (Apollo, Hunter,
Tomba, PDL, LeadMagic, Prospeo and more), metered per call from a prepaid balance at the
provider's list price with no markup. A team's own provider key always wins and is never
metered. Routed ids (`treg.people.email.find`, `treg.people.email.verify`,
`treg.people.search`, `treg.companies.enrich`) try providers cheapest first and name the one
that served in `X-Treg-Served-By`. Researched 2026-10-13 after Caleb's "HOLY FUCK"; the full
report with every source is `~/.chewbacca/overnight/treg-report.md`.

What Chewbacca uses, all in `tools/treg_client.py`, all optional and detected by a token in the
Keychain (`treg-token`) or `TREG_TOKEN`:

- `chewbacca gtme find --paid`: the routed finder with a same-call verify, capped at 5 cents a
  lookup, kept only when the verdict is `valid` (since 2026-10-13).
- `chewbacca gtme verify`: the routed verifier on every site-printed email before it leaves a
  primary Gmail, capped at 1.5 cents a check. Invalid is suppressed, anything else not valid is
  held. Both price ONE call first and need an approved `--spend` for the rest.
- Every call carries `X-Treg-Meta: customer=<slug>` and `X-Treg-Route-Max-Cost`, and treg's own
  charge (`X-Treg-Cost-Micro`) lands in the client's `spend.jsonl`.

Numbers to quote, with whose they are (all treg's own, none measured by us yet):

- Routed find lists from $0.0048 a hit, misses free on per-success providers. Routed verify and
  routed people search list as free first, then up to $0.0138 and $3 a row.
- The "27 people, 20 verified emails, $0.58" receipt counts only find plus verify. The same
  2026-09-23 run cost $2.33 in all, $0.12 per deliverable lead (treg.to/pricing).
- On 60 people from title searches, the finder returned 60 addresses and 32 verified
  deliverable, 53% (treg.to/gtm-engineering ch. 8, 2026-10-07), so a found email still needs its check.
- Their bench of 292 people at 88 companies: $0.0056 per correct email via treg vs $0.0395 via
  Clay, exact-match 90.4% vs 89.7%. Vendor-run, every company had a public team page.

Limits: the hosted service has no uptime or support commitment (terms section 08), section 07
bans using it to "send spam or bulk unsolicited email", and HN commenters doubt the providers'
terms allow resale. Calling the hosted API inside our product, tagged per customer, is allowed
without an agreement (terms section 11, LICENSE). Self-hosting the code as a service for others
is not. Zeutara stays Clay-native (Sagar's backbone, Jonah's credits): treg is for users with no
Clay seat. Related: [[reference_chewbacca_gtm_arsenal]], [[project_amber_roles_2026_10_11]],
[[feedback_build_for_everyone]].
