---
name: reference_gtme_next_move
description: "gtme next-move (tools/next_move.py): the blocker loop that replaced parents.json. Moves come from failure evidence, boundaries are data in references/next-move.json, Jev ranks, attempts land in the lesson ledger (2026-10-16)."
metadata:
  type: reference
---

gtme next-move is the loop a blocked GTM step goes through, built 2026-10-16 after the Sabo call credited Chewbacca with reasoning its way to Barebells' parent when the parent came from a hand-filled parents.json.

- Generate: every operator runs on every blocker and proposes only what the evidence supports (related company from the brand's own footer, links and email domains; next person; persona swap; loosen a filter; retry; a source read; ask the client). The agent adds its own moves in `extra`.
- Bound: `skills/gtm-engineering/references/next-move.json` lists each boundary with its source, and `client_rulings` maps a client's DECISIONS.json ruling to the touches it forbids. Dropped moves print with the rule. `run` rechecks right before an executor, and the tests prove a launch Jev scores 0.99 never runs.
- Rank: Jev's progress probability, divided by credits plus downstream credits plus time. Jev is evidence, never permission.
- Learn: paid attempts add to a `next-move:<kind>` lesson's `move_stats` in team/gtme-lessons.
- `tools/brand_buyer.py` calls it on every empty people search. parents.example.json and the `parents` client key are gone.
- Replays of 5 recorded blockers (live Jev): loop 5/5 cleared, old chain 2/5, one Codex call 3/5. Cleared per credit is close: loop 1.28 (1.14 on one run of four), old chain 1.18. With Jev off the loop drops to 2/5. Not held out after one cost fix, so grade it on the next real blockers.
- This loop is what makes `feedback_claims_match_the_mechanism` true for the parent-company claim: say "it read the brand's footer and Jev ranked the moves", never "it figured out the parent" without the receipt from `plan`.
- Break-it pass, 2026-10-16: agent moves are classed from their action text (NFKC-folded keywords, then Jev, which can only raise a class), never their own label. Malformed blockers and CLI input drop or refuse cleanly. Cost: Zeutara's ask for a waiver reads as a send, so replays are now 4/5 cleared at 0.91 to 1.03 per credit, under the old chain's 1.18.
- Attack round 2: agent moves fail closed. A read or ask has to match a known-safe shape, the move runs only when Jev confirms it (otherwise it's held as an ask), Jev never lowers a class, and agent kinds sit under agent: so they can't reach a built-in executor.
