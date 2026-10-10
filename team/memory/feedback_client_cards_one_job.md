---
name: feedback_client_cards_one_job
description: A Slack card a client presses shows one primary action plus one way out; no third button, no optional grey text under it
metadata:
  type: feedback
---

2026-10-09: the Togari deck-request card shipped with Send the deck, I sent
the deck, Send a holding reply, and a grey "Holding reply, if you want one"
paragraph under them. Caleb, on the screenshot: "WTF IS THIS SHIT???"

**Why:** every extra option on a client's card is a decision Jonah has to make
in front of an investor reply. Adding the new button next to the old ones
instead of replacing them is how it got to three.

**How to apply:** one primary action for the card's job, one way out (Already
sent, Skip). When adding a button, remove what it replaces in the same change,
and look at the rendered card before calling it done (togari PR #66). See
[[feedback_the_screenshot_beat_the_code]], [[feedback_client_review_is_the_gate]].
