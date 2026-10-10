---
name: project_chewie_app_background_control
description: chewie app (mac/appctl) drives any Mac app in the background through accessibility, with Jev picking controls; what it does, the AX quirks found building it, and what is still queued
metadata:
  type: project
---

`chewie app` is Chewbacca's version of Claude computer use, built 2026-10-09/10 after Caleb watched computer use turn off iCloud Photos without touching his mouse and asked for "ALL the claude computer use functionality" in chewbacca, with Jev playing a role. Source: `mac/appctl/appctl.swift` (built by `mac/bin/chewie` on first use, `swiftc -swift-version 5`), `mac/lib/app_find.py` (Jev), `mac/lib/app_batch.py`. Tests: `tests/test_appctl.py` (22 checks, tools group). Usage lives in [[skills/mac-control]].

Verbs: windows, see (indexed elements + optional window capture), press, set, focus, key (to the app's pid), menu, scroll (moves the scroll bar value, no wheel event), read, shot (by window id, works hidden/off-Space, `--region` crops), raise, find/do (exact label in code, else Jev choice), batch.

Proven live: 5+4, 7x6, 9x9 in a hidden Calculator while Caleb was in Slack; a 400-line TextEdit doc scrolled while hidden.

AX quirks paid for, each now handled in code with a comment:
- Right after a press, AXWindows and the element walk come back empty for up to ~1s; both retry before failing or saving an empty snapshot.
- A press that opens a modal returns `cannotComplete` but landed.
- A save sheet's buttons give no usable AXParent chain, so dialog membership is read walking DOWN the snapshot path.
- Calculator's only window has subrole AXDialog; a top-level window counts as a dialog only with a default or cancel button.
- Labels change with state (All Clear / Clear / Delete), so refs revalidate role+label at the path and refuse if changed.
- Digit labels collide with indices: `label:7` forces a label.

Gate: three security reviews in one night kept finding the next miss in the irreversible-word list. It now fails closed (every AX text, unlabeled buttons, commit keys, menus, and anything inside a dialog except Cancel-style exits needs `--yes`), and `do`/batch never forward consent to a Jev pick. It is a backstop over app-supplied labels, which can lie; the real boundary is that `--yes` only follows the person's yes. See [[feedback_denylist_gate_is_a_backstop]].

Queued (work-ledger, source key chewie-app-hud-2026-10-10): Kyber voice drives apps this way, with Gavin's Mark marker from the clay-build HUD on the control before each press; then drag and clipboard.
