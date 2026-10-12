---
name: feedback_big_json_edit_reflows
description: An Edit-tool change to library/clay-api/clay.json gets reformatted by a PostToolUse formatter into a 6,500-line diff; patch big JSON specs with a script
metadata:
  type: feedback
---

A three-line Edit to `library/clay-api/clay.json` on 2026-10-12 came back as a
6,537-line diff: a PostToolUse formatter reflowed the whole file after the edit.

**Why:** nobody can review a change buried in a reflow, and it collides with
every other tab touching the spec.

**How to apply:** for clay.json, registry.json and other large generated JSON,
change values with a short Python `str.replace` (count the hits) and check
`git diff --stat` before staging. If the stat is huge, `git checkout -- <file>`
and redo it by script.

Related: [[feedback_verify_the_generated_block]].
