---
name: chewbacca recipe
description: Typed task files that run as argv, pass on exit codes, and stop for a press no file can waive
type: reference
---

`chewbacca recipe run|check|list` runs a JSON file with typed parameters. Format and limits: `docs/reference/RECIPES.md`. Runner: `tools/recipe.py`. Kit recipes go in `library/recipes/`, personal ones in `~/.chewbacca/recipes/`.

A step is read only when the runner proves it from the rendered command against its `READ_ONLY` list. Anything else takes one press for the whole run, before any step starts. To let a recipe run a new read command without a press, add it to `READ_ONLY` with its allowed flags, and add a must-stop case to `tests/recipe.sh`. While `~/.chewbacca/policy/send-hold` exists, every step not proven read only exits 4.

Hall has the runner and `site-says` (hall ea929883) but no press module. `tools/send_approval.py` and `tools/send_policy.py` are held back by the product firewall for names in their comments, so gated steps exit 3 in Hall and only reads run there.

`chewie plan` wasn't extended because it has no parameters and its `run_shell` is `bash -c`.
