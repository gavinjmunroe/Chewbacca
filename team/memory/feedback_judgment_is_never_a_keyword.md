---
name: feedback_judgment_is_never_a_keyword
description: Keywords only pick candidates; a fit or quality judgment comes from evidence (a graph walk, the source page) judged by Jev one item at a time. A keyword patch for a keyword bug drew "WHY IS THERE BRUTE FORCE WORD KEY STUFF IN CHEWBACCA?" (10/26)
metadata:
  type: feedback
---

gtme-investors decided investor fit by sector keywords. On 2026-10-26, "consumer" put
Greylock and a fintech fund on a mushroom-protein founder's list, and the next proposal
was a `broad_thesis` keyword exception. Caleb: "WHY IS THERE BRUTE FORCE WORD KEY STUFF IN
CHEWBACCA? I THOUGHT WE HAD MADE AN INTELLIGENT SYSTEM???????", then "Plz graph engineer".

What replaced it (36b8427b, fc6d6137): keywords only choose candidates. The firm
-invested_in-> company graph (`gtme-portfolio`, every name proved on the firm's own page)
is walked, and Jev asks of each company whether it is in the pitch's market. A firm is
in only when it backed one, and the row says which. A homepage yes only earns a portfolio
read. A 489-firm graph from the Zeutara work already existed in that client's repo and no
other list had ever read it.

Measured on the way, so nobody re-learns them:

- Judging a firm from its name or homepage alone can't separate fits: a16z 0.53 and an
  ag fund 0.36 for a food founder. Generic "we back founders" pages read as a fit to anything.
- Batched Jev rows bleed into each other: one firm scored 0.88 in a batch of 20 and 0.13
  alone. Judge firms one call each; company questions per firm can share a call.
- An automatic "this word is too broad" rule doesn't work either: "consumer" for food and
  "software" for an MSP tool look the same statistically, and only one is wrong.
- The graph overruled a person: Kapor (Air Protein) and Maveron (Imperfect Foods) had been
  marked off thesis by hand.

**Why:** a keyword can say what a page mentions, never what a firm does. Each keyword patch
is a new false positive somewhere else.

**How to apply:** when a list, score or gate needs judgment, find or build the evidence
graph first (what they backed, bought, published), walk it, and let Jev judge each edge
against a one-sentence pitch. Keep keywords to candidate generation and hard hygiene (role
inboxes, .gov contacts). Related: [[feedback_fix_the_class_at_the_source]],
[[feedback_find_the_existing_thing_first]].
