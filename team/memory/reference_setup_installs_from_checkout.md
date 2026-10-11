---
name: reference_setup_installs_from_checkout
description: setup.sh hands off to the ~/code/chewbacca checkout, so a checkout behind main installs old hooks; source_sync catches it up first, and chewbacca update needs a second setup run
metadata:
  type: reference
---

`chewbacca setup` and `chewbacca update` run setup.sh, and setup.sh re-execs from the checkout named in the kit runtime sidecar (`~/code/chewbacca`), not from the fresh snapshot. On 2026-10-11 that checkout sat 62 commits behind main, so essay-gate was copied into ~/.claude/hooks but never registered, and a hand-added settings entry got wiped by the next update.

Since 00c6c071 and 602d172d, setup first runs `tools/source_sync.py <checkout> <snapshot sha>`. It clears dirty or untracked files only when they are copies of what already landed (a whole-file match with any version on HEAD..main, or an edit whose every added line is on main and every cut line is gone from it), then fast-forwards. Real local work stops it and it prints "behind main".

Still open: `chewbacca update` runs setup.sh from the OLD snapshot's path (ROOT is fixed before the runtime swaps), so the new setup only runs on the next `cd ~/.chewbacca/kit/current && bash setup.sh`. After landing a hook, verify with `grep -c <hook> ~/.claude/settings.json`, never by the land message.

Related: [[feedback_built_but_never_fires]], [[project_kit_runtime]], [[feedback_live_hooks_are_copies]].
