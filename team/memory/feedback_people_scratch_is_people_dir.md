---
name: feedback_people_scratch_is_people_dir
description: The people CLI's scratch store is PEOPLE_DIR, not PEOPLE_DB; a guessed variable wrote a test person into the real people.db
metadata:
  type: feedback
---

`bin/people` reads its store from `PEOPLE_DIR` (the folder holding people.db), and an unknown variable is silently ignored. On 2026-10-10 a check run with `PEOPLE_DB=$(mktemp -d)/p.db` added "Zed Test" with a phone number to the real ~/.chewbacca/people/people.db; it was found and purged (0 messages) minutes later.

**Why:** the real store is everyone Caleb knows, and sends resolve against it.

**How to apply:** before any `people add/update/send` outside a test runner, read the test's own header for the variable (tests/people_send.sh: `PEOPLE_DIR`), set it, then confirm the write landed in the temp folder (`ls $PEOPLE_DIR/people.db`) before trusting the run. Related: [[feedback_never_live_test_a_send]], [[feedback_test_fixtures_synthetic_secrets]].
