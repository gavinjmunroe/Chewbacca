---
name: feedback_hooks_run_on_stock_python
description: Installed hooks run on macOS's stock /usr/bin/python3 (3.9); write 3.9-safe types with typing.Optional, and never add `from __future__ import annotations` to a file with a @dataclass that something loads by path
metadata:
  type: feedback
---

On 2026-10-09 a stranger's fresh install fired every registered hook, and two errored on every prompt and session start. jev.py, agent_board.py, route.py and skill_route_shadow.py used `str | None` at module level, which Python 3.9 evaluates and rejects. tools/agent_runtime.py raised when `tomllib` (3.11+) was missing, which failed the whole SessionStart connect for anyone with Codex installed.

The first fix added `from __future__ import annotations`. That broke route.py a different way: it has a `@dataclass`, and tests/test_route.py loads it with `spec_from_file_location` without registering it in `sys.modules`. Under postponed annotations, dataclasses looks the module up, finds None and crashes. The full suite caught it the next morning (fixed in ffef7c24 with `typing.Optional`).

**Why:** this Mac runs Homebrew's 3.14, so nothing fails locally. Only a fresh home with PATH=/usr/bin:/bin shows what a stranger gets.

**How to apply:**
- In anything a hook imports, write `Optional[str]`, not `str | None`. `list[str]` is fine on 3.9.
- A missing optional module (tomllib, a third-party package) means skip the feature and change nothing. Never raise out of a hook.
- `from __future__ import annotations` is fine in a file with no dataclass, or one only ever imported normally.
- tests/stock_python_imports.sh imports every hook module on /usr/bin/python3, so run it after touching bin/lib or tools.

Related: [[feedback_fix_the_product_not_your_machine]], [[project_chewbacca_welcome_onboarding]].
