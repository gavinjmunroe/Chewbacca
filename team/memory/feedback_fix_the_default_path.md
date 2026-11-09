---
name: feedback_fix_the_default_path
description: Every fix changes how the kit tries to be good (a tool, default or first step that makes the right move the easy one), not only what it refuses; chewbacca resolve is the worked example
metadata:
  type: feedback
---

Caleb, 2026-10-11, after an agent asked him for a zip code one lookup away and then for his own address, which sat in his own contact card: "Fix chewbs down to the root core of why it wasn't smart enough. What should happen EVERY time we try to fix smth, not just avoid the bad, reengineer the way in which it tries to be good."

**Why:** asking him was the cheapest move the agent had, so a flag that caught the ask only moved the failure. The fix that changed behavior made the right move cheaper: `chewbacca resolve` answers a fact from Contacts, the people store, the brain's fact stores, the Census geocoder and Maps in about a second, and the reply-lessons ask flag runs it on the question so the next reply already has the answer.

**How to apply:** for every correction, land the catch (a test or a hook) and the default path that produces the good move on its own. bin/durable-check's message and `.claude/rules/review-discipline.md` ("Where a lesson goes") now ask for both. Related: [[feedback_enforce_dont_document]].
