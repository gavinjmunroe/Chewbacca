---
name: reference_hud_card_ask
description: Screen ask= on a HUD card turns a double-click into a typed chat request; the verse card uses it (2026-10-16)
metadata:
  type: reference
---

`ask="<request>"` on a Kyber Screen is a card that talks. A double-click
anywhere on the card sends the request into the HUD chat through
`dispatch(text, typed: true)`, the same path as Return in the chat, and opens
the chat. It never goes up the socket as an `e` line, so a one-shot sender
that already exited (bin/hud-verse, run every 15 min by the daemon) still
gets a working card. Single click, rows and the X are untouched.

Asked by Caleb 2026-10-16: "If I double click on them I want it to go into
chat w the hud and chewbs where I can talk abt the verse". Landed dc39302b.
hud-verse sends `ask="Let's talk abt <ref>: <verse>"`.

**How to apply:** for any card that should open a conversation abt itself,
send `ask=` instead of writing a listener. Source: AskOnDoubleClick in
hud/Sources/KyberKit/SurfaceView.swift, tests in AskTests.swift. It only
reaches his glass after bundle.sh release + install.sh, and relaunching Kyber
is fine anytime ([[feedback_caleb_standing_answers_hud_2026_10_10]]).
