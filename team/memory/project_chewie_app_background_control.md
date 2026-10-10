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

Added 2026-10-10 morning (a1c68f98, 5ab0378f): `ask` (voice "press X in App" or "in App, do X" via `bin/lib/app_route.py` in hud-listen; brackets the control on the glass with a Press it card, presses only on that tap, pinned with `--expect` to the role, label and path it showed), `paste`, `where`, `clip`, `drag`, `press --check`. More quirks paid for:
- A hidden window has no first responder, so Edit > Paste is disabled and a cmd+V posted to the pid never lands. `paste` writes AXSelectedText after placing the caret, which works hidden and leaves the clipboard alone. Borrowing the clipboard once overwrote Caleb's copied text.
- Mouse events posted to a pid are ignored by AppKit text views in the background, so `drag` mostly needs the real cursor; use `set` for sliders.
- Under load 11, Calculator's walk returned only its 3 title-bar buttons; `see` now walks until two walks agree on the count.
- TextEdit answers cannotComplete while applying a large AXValue and the value lands anyway; read-back is the check.
- Kyber can't be screenshotted, see [[reference_kyber_invisible_to_screenshots]].

Previously queued (done 2026-10-10): Kyber voice drives apps this way, with Gavin's Mark marker from the clay-build HUD on the control before each press; then drag and clipboard.
