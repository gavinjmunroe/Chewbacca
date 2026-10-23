---
name: feedback_app_store_cancel_is_his_click
description: App Store subscription cancels can't be driven by computer-use on this Mac; bring up the page in the background and give the list, never ask "want me to"
metadata:
  type: feedback
---

Cancelling App Store subscriptions on Caleb's Mac is a click he makes, not one an agent can make.

On 2026-10-23 an agent tried to cancel 75 Hard, Cozy Couples and Elevate. Background clicks on the
Subscriptions sheet pass through to the page behind it (the sheet is a web view that ignores raw input),
and full screen clicks are refused because the Kyber HUD overlay covers the screen. Each attempt raised
another computer-use approval card. Caleb: "WHAT IS HAPPENIGN U KEEP ASKING PERMISSION??????????" and
"Would it be faster for me to do it myself?" Yes, it was.

Earlier the same session the agent ended a turn on "Want me to cancel 75 Hard?", which drew
"FIX CLAUDE/CHEWBS TO NEVER ASK PERMISSION".

**Why:** every computer-use grant is a card he has to click, and this path fails anyway.
**How to apply:** for any App Store or Apple ID subscription change, load
`macappstores://apps.apple.com/account/subscriptions` in the background (`-g`) and reply with the exact
rows to cancel (name, price). No request_access, no request_full_control, no closing question.
See [[feedback_no_confirmation_prompts]].
