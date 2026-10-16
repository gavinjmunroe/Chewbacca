# Brand buyer

You give it a brand and get back the person who pays outside creators there, with a verified email and a one-sentence reason, written into the client's Clay table. Nobody has to touch Clay. It was built for Sabo, a fitness creator manager, on 2026-10-16, and it works for any client whose table has the 7 columns in `client.example.json`.

## A new client in four steps

1. Copy `client.example.json` to `~/.chewbacca/gtm/clients/<slug>.json` (one file per client, shared with the other client tools), then pass `--client <slug>`. Fill in the workspace, table, views, creator and column names. Columns are matched by name, so you don't need field ids.
2. `python3 tools/brand_buyer.py --client <folder>/client.json --setup` prints what it would change. Add `--live` to apply it. Setup puts the people search on the settings that worked (identifiers_only, buyer title keywords, limit 5) and adds Person, Title, Why this person, Status and Contact. It shows those columns in the client view and hides the ones listed under `hide`.
3. `python3 tools/brand_buyer.py --client <folder>/client.json "Gymshark" gymshark.com` is a dry run. Add `--live` to spend credits, about 1.1 a brand and up to 1.6 with a fallback or retry. Paid runs go through `chewbacca clay` and its credit allowance.
4. Show the client the Contact column, filtered to Status = Ready.

## What one run does

- It adds the brand's row, or reuses it from `rows.json`, so a brand gets one row.
- Clay's people search runs on the brand domain. If it finds 0 people, `gtme next-move` reads the brand's own site, proposes the companies it names as owner or links to, and reruns the search on the one Jev rates best. There is no parents file to fill in.
- Jev scores each candidate from 0 to 2 on title and stated remit. It stops under 0.5, and anyone the brand pays (ambassadors, athletes, creators) scores lowest.
- Findymail finds the email and ZeroBounce checks it. If the email is invalid, missing or at another company, the runner-up gets one try.
- It writes Person, Title, Why, Status (Ready or Needs work: reason) and Contact. Every run is logged with its credits in `runs.jsonl`.

## Providers and the record file

The data steps (people search, find email, verify, person posts, company signals) go through the provider the client file names: `"provider": "clay"` today, `"treg"` as a stub that raises "not wired". The contract is in `tools/creator_gtm/provider.py`. Each pick is written first to the client's record file (`"records"`, relative to the client file) and then to the Clay table as a view, so a provider swap keeps every pick. Every paid call is logged with its credits and, when `provider.cents_per_credit` is set, its cents.

Lessons and evidence: team memory `reference_clay_people_search_finds_buyers` and `reference_gtm_provider_contract`.

Built with Chewbacca
