# Follow past buyers

Every brand manager who has already paid a client's creators is a warm relationship. When one changes jobs, the new brand is a warm lead, and it comes from the client's own deal history, which no data vendor sells. Built for Sabo on 2026-10-16, on top of [brand buyer](../brand-buyer/README.md).

## Set it up for a client

1. Copy `buyers.example.json` next to the client's brand-buyer `client.json` and fill in one entry per buyer: name, LinkedIn URL, the brands and domains they paid from, a one-line history with its source, and their current employer with its source.
2. Add `"buyers": "buyers.json"` to the client file so the lane can find the seeds next to it.
3. Run `python3 tools/creator_gtm/follow_buyers.py --client <folder>/client.json` for a dry run that spends nothing, and add `--live` to spend credits, about 1.7 a moved buyer (people search, two Findymail lookups at most, ZeroBounce).

A buyer still at a brand they paid from is skipped at no cost. A buyer who moved gets a row for the new brand with Status `Warm: past buyer moved`, a Why line naming them and the history, and the rest of the team from the people search. Their email only counts when it's at the new brand. An address at the brand they left gets `needs work: off-domain`, with any verified teammate named as the way in.

## New moves arrive from Clay, never from a loop on someone's Mac

The recurring check is a Clay JobChange signal watching the buyers' LinkedIn URLs, created Paused with `clay signals create --type JobChange`, read back, then resumed. It's billed per record checked, so the cost is one charge per buyer per run. Its events land as rows in Clay. `--events events.json` (name, linkedin, employer, domain, title, since, source) folds an exported batch into the seeds and runs the lane once.

Built with Chewbacca
