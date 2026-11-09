---
name: feedback_test_fixtures_synthetic_secrets
description: Test fixtures in Chewbacca must use fake secret values; tests/phone_mirror.sh shipped his live Todoist token to main.
metadata:
  node_type: memory
  type: feedback
  originSessionId: 042ca149-71bc-47cb-b8c9-641327d629d6
  modified: 2026-10-09T10:46:36.587Z
---

Test data that needs a secret uses a value containing "fake" (bin/secret-scan allows it), never one copied from his real settings. tests/phone_mirror.sh held his live TODOIST_API_TOKEN from commit f95def53 until 60c38339 on 2026-10-08; it is still in older history on the private repo.

**Why:** a test about leak prevention leaked the very value it guarded, and it reached main before the secret-scan push gate existed.

**How to apply:** when writing a fixture, invent the value (`TOK="fake0..."`). Never suggest rotating the token, per a private note.
