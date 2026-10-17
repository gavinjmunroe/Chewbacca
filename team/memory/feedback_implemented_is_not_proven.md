---
name: feedback-implemented-is-not-proven
description: "A backlog row marked implemented with fixture checks pending hid 10 real failures in the installer's instruction merge (2026-10-16, backlog 250)"
metadata:
  type: feedback
---

Backlog 250, "Installer merges existing instructions", sat at implemented with "fresh fixture checks pending". The first fixture run on 2026-10-16 failed 10 of 12: CRLF turned into LF, a rerun rewrote the file, a missing END marker printed "updated" and installed nothing, a symlinked CLAUDE.md became a regular file, and a read-only file was silently replaced. Fixed in c31fd6b0.

**Why:** the old checks grepped for one line of user text, and grep passes when the bytes around it changed. Python's read_text() translates CRLF on read, and os.replace() overwrites a read-only file in a writable directory, so neither failure shows unless a test compares bytes.

**How to apply:** treat "implemented" with pending checks as unproven and run the acceptance fixture before building on it. When a writer touches a file someone wrote by hand, test byte equality outside the managed region, a no-op rerun (mtime unchanged), CRLF, a symlink and a read-only mode. The pattern is tests/test_instruction_merge.py.
