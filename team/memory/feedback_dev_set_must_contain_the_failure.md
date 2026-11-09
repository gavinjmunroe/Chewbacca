---
name: feedback_dev_set_must_contain_the_failure
description: Before tuning a ranker, check the dev set actually contains the failure; brain recall's dev had zero lone-hub misses, so a dev 80% fell to 43% sealed (2026-10-10)
metadata:
  type: feedback
---

Brain recall tuning on 2026-10-10 chased "long domains/ files win unrelated queries".
Four ideas were swept on the 25-question dev set; the best scored 80% dev and 43.1%
sealed, 12 points WORSE than shipped. The dev set contained zero misses of that kind,
so nothing tuned on it could see the failure. A new blind 46-question dev2 aimed at it
(432b5f04) found lone files caused 1 miss of 46: the real sealed gap is zero-word-overlap
phrasing, a lexical-retrieval limit.

**Why:** n=25 means one query is 4 points; most dev "wins" at that size are noise, and a
dev set without the failure measures nothing about the fix.

**How to apply:**
- Before tuning, count dev misses caused by the failure you're fixing. Zero means build
  a dev set that contains it first (blind: pick targets, then write questions).
- Report a Wilson interval and a paired test vs baseline; don't ship a gain inside noise.
- Run the sealed set once per idea family, never per knob. See [[feedback_seal_the_test_set]].
