---
name: feedback_services_run_from_the_kit
description: A daemon service whose argv names the shared checkout runs whatever that checkout holds; brain-index ran a stale brain.py, so landed index code never ran until it was pointed at kit/current (10/13)
metadata:
  type: feedback
---

On 2026-10-13 the second embedding model for brain landed on main (3c8cc034,
9bbda37a) and the kit runtime picked it up within minutes, but the live index
never got its second vectors. The brain-index service had been adopted from
an old LaunchAgent whose argv was `~/code/chewbacca/apps/brain-retrieval/src/brain.py`,
the shared checkout, which sat at ba3dd03a. So asks ran new code (through
`~/.local/bin/brain`, which points at the kit) against an index the old code
kept rewriting.

**Why:** the shared checkout moves only when someone pulls it, and other tabs
leave it behind on purpose. A service that runs from it runs a version nobody
chose.

**How to apply:** a service's argv points at `~/.chewbacca/kit/current/...`,
never a checkout. When code lands that a service runs, read
`~/.chewbacca/daemon/services/<name>.json` and confirm the path before saying
it is live. Fixed for brain-index with `chewbacca-daemon register brain-index
--every 600 --nice 10 -- /opt/homebrew/bin/python3 ~/.chewbacca/kit/current/apps/brain-retrieval/src/brain.py index --quiet`.
Related: [[feedback_long_lived_code_goes_stale]], [[feedback_built_but_never_fires]].
