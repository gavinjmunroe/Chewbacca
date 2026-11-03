---
name: feedback_jev_import_by_path
description: Dough must load Jev with gtme_jev.kit_jev(), never a bare `import jev`; tools/jev.py shares the name and has no ask()
metadata:
  type: feedback
---

The kit has two files named jev.py. bin/lib/jev.py is the client with ask(). tools/jev.py is
something else and has no ask(). On 2026-11-02, after a night of merges, tools sat first on
sys.path during a `gtme accounts` run, so `import jev` loaded the wrong file. jev_check caught
the AttributeError and marked every buyer "Jev not scored, held". The why-now about-check
crashed outright. It showed up on a Baptize rebuild, and the AuraPath PIP rerun was about to hit it.

How to apply: in any gtme tool, get Jev with `gtme_jev.kit_jev()`, which loads bin/lib/jev.py
by path (main a757708b; tests/test_gtme_jev.py KitJev). When a run comes back with many
"Jev not scored, held" rows, suspect the import before the data.
