---
name: feedback_pipefail_grep_q_false_fail
description: Under set -o pipefail, `cmd | grep -q X` fails whenever cmd exits non-zero, even when X is there; capture to a file, then grep
metadata:
  type: feedback
---

On 2026-10-28 usc-os tests/sync.sh printed FAIL twice for checks that were right. `tools/sync` status exits 1 when files are out of step, and the test did `S | grep -q "changed in Chewbacca"` under `set -uo pipefail`, so the pipeline took the status's exit 1 even though grep matched.

**Why:** every Chewbacca test starts with `set -uo pipefail`, and many CLIs here exit non-zero on purpose to say "not clean" or BLOCKED (exit 3). A false FAIL makes a correct tool look broken and wastes a debugging round.

**How to apply:** in a pipefail test, when the command's exit code means something, write its output to a file and grep the file: `S > "$T/st"; grep -q X "$T/st"`. Check the exit code on its own line if it matters.
