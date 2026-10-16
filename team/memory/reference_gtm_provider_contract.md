---
name: reference_gtm_provider_contract
description: "The creator GTM tools (brand_buyer, follow_buyers, spend_now) call data vendors through one provider contract in tools/creator_gtm/provider.py; Clay is the live adapter, treg a not-wired stub, picked per client file"
metadata:
  type: reference
---

The creator GTM provider contract lives in `tools/creator_gtm/provider.py` (2026-10-16). Five
data steps: `people_search`, `find_email`, `verify_email`, `person_posts`, `company_signals`.
Pick, Jev ranking, retry, status, attribution and spend scoring never touch a vendor directly.

- The client file picks the adapter: `"provider": "clay"` (default) or
  `{"name": "clay", "cents_per_credit": N}`. `"treg"` is a stub: every paid step raises
  `NotWired` before any spend. `company_signals` is the free public job-board read, shared by
  all adapters.
- Clay's adapter wraps the same `chewbacca clay` calls as before, so the write gate still
  applies. Its per-call credits are read off the workspace balance around each cell run, so a
  parallel tab spending in those seconds lands in the number too.
- Cents stay `null` until a client file states `cents_per_credit`. No Clay plan rate was on file
  when this was built.
- The canonical brand/contact record is the client's `"records"` file (Sabo:
  `~/.chewbacca/gtm/clients/sabo.records.json`). The chain writes it first, then the Clay table
  as a view from it.
- `tests/test_gtm_provider.py` runs the brand buyer chain end to end on a fake provider with
  `clay()` replaced by a tripwire.

Why: Caleb, 2026-10-16, "removing clay from the equation is def the play after this phase".
Gavin's ruling holds: stay on Clay until Sabo pays. Wiring treg means mapping
`tools/treg_client.py` onto the contract. Related: [[reference_treg_tool_registry]],
[[reference_clay_people_search_finds_buyers]].
