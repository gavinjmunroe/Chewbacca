---
name: feedback_fix_the_product_not_your_machine
description: Fixing a problem on Caleb's own machine and not in the installer means every other person still gets the bug; it happened three times in two days.
metadata:
  type: feedback
---

Three times in two days, a real defect was found and fixed on Caleb's laptop and
left in the product, so every other install still had it.

- **Serena's dashboard.** Its upstream default opens a browser tab on first run.
  His config was set to `false` on 9/17. The installer was never changed, so
  Sagar installed on 9/19, a window opened on his computer by itself, and he
  concluded the kit was dangerous. [[project_chewbacca_install_broken_2026_09_19]]
- **`design-system.md` frontmatter.** The `paths:` scoping that defers the rule
  existed only on his machine, added by hand. The repo copy had none, so every
  install paid ~1,780 tokens on every session. A routine reinstall then
  overwrote his copy and the fix was gone.
- **SHA256SUMS.txt.** Regenerated locally when needed, never wired into the
  thing that rewrites `setup.sh`, so main shipped a tree nobody could install
  from.

**Why:** his machine is where the symptom shows up and where the fix is
one line, so the fix lands there and the session ends. The product keeps the
bug, and the next person to see it is a tester or a customer.

**How to apply:** when a fix is applied to `~/`, ask immediately what in the
repo produced that state, and change that instead. Then delete the local fix and
re-run the installer to prove the product produces the fixed state on its own. A
fix that only exists in `$HOME` is a note, not a fix.

See [[feedback_verify_the_generated_block]], a private note.
