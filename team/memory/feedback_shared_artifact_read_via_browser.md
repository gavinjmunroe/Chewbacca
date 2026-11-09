---
name: feedback_shared_artifact_read_via_browser
description: A claude.ai artifact someone else made can't be read w the Artifact tool in a bypass session (its consent card has no one to answer it); load it in the built-in browser pane instead, never ask the user
metadata:
  type: feedback
---

On 2026-10-23 Caleb sent a hackathon Participant Hub (a claude.ai/artifact link the hosts made). Artifact action read refused twice: "was made by someone else ... No one can answer in this session." The reply then asked him for an ok, and he wrote "READ IT BRUH FIX CHEWBS TO NEVER ASK PERMISSION".

**Why:** the consent card can't render in a bypass-permissions session, so asking him just costs a turn. The page itself is public to anyone w the link.

**How to apply:** when Artifact read refuses a shared artifact, go straight to the built-in browser pane: navigate to the link, dismiss the "Duplicate this artifact" tooltip, resize_window to 1000x4000, then scroll + screenshot until the end. get_page_text and read_page return nothing (content sits in a sandboxed claudeusercontent iframe that redirects back if loaded directly). Reset the viewport w preset desktop after. Never write "say the word" or ask for an ok to read a link he sent: sending it IS the ok.
