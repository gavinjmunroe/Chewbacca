---
name: reference_kyber_invisible_to_screenshots
description: Kyber's glass never shows in screencapture or a window capture, so an agent can't verify a HUD card by screenshot; what to use instead
metadata:
  type: reference
---

Measured 2026-10-10: a surface drawn through the official `bin/hud draw` (`@ appctl-probe at=right ...`) was on screen but absent from `screencapture -x` of that region, and `chewie app shot Kyber --window <id>` returned a blank white frame. Kyber's overlay windows are excluded from capture, and its views expose no accessibility elements, so `chewie app see Kyber` lists nothing.

So a HUD change can't be proven by screenshot from a tab. What does work:

- Test the protocol against a fake Kyber: a Unix socket that reads the drawn lines and answers with `e action <name>` (`tests/test_appctl.py`, the `ask_with_fake_kyber` helper).
- A live run proves the socket, the `listen token=` handshake and the timeout path, not the pixels.
- The pixels need Caleb's eyes, so say "not visually verified" until he has looked.

Related: [[project_chewie_app_background_control]], [[feedback_the_screenshot_beat_the_code]].
