---
name: feedback_claims_match_the_mechanism
description: Never describe a hand-filled lookup or hard-coded fallback as Chewbacca reasoning on its own; say what the code actually does
metadata:
  type: feedback
---

A claim about what Chewbacca does on its own has to match the mechanism in the code. If a fallback reads a hand-filled file, say "it reads a list we filled in", never "it found a way around the blocker".

On the 2026-10-16 Sabo call we said Chewbacca "auto found a way around blockers" by looking up a brand's parent company. In fact live_chain.py read parents.json, and the Barebells row was added by hand after barebells.com returned 0. Caleb, the same day: "i think that was slop but we gotta make chewbs actually smart and intuitively think through all the possible courses of action then jev the way of how to optimize next steps... no hard coded 'do this when X happens' but obviously some clear guidelines and boundaries."

How to apply:
- Before a call, demo or client message, check every "it figures out" claim against the code path that ran. A lookup table, a hand-added row or a single if-branch is a rule, not reasoning.
- The real version is the blocker loop (tools/next_move.py, on main as 2f97a007; brand_buyer's empty search already uses it instead of parents.json): the agent generates candidate moves from the failure evidence, GTME boundaries read as data drop the unsafe ones, Jev ranks the rest, and outcomes go to the lesson ledger. Its proof is solving Barebells with parents.json deleted.
- Never add a new per-case fallback (`if 0 people: try X`) when the loop can carry it.
