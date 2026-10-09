---
name: feedback_onboarding_like_anarlog
description: "Caleb loved Anarlog's permission onboarding (drag the app icon into the System Settings list); Chewbacca's onboarding should copy it."
metadata:
  node_type: memory
  type: feedback
  originSessionId: b1764fac-8937-462d-a422-2ed187daef7c
  modified: 2026-10-05T21:48:58.174Z
---

**2026-10-05.** Caleb, setting up Anarlog (the open-source Granola, now Chewbacca's meeting engine): "Bro I LVOEEEE the onboarding process for that thing how it made it super clear and easy to get all the permissions setup... we should do the same!!! The drag and drop was fireeeeeeeeeee", then "Ts wonderful" with a screenshot.

What it does: for each macOS permission (Accessibility, Microphone, Screen and System Audio Recording), it opens the right System Settings pane and floats a small card over it reading "Allow Accessibility. Drag the app below into the list above", with an arrow and the app's own row (icon, name, toggle) to drag in. One permission at a time, no hunting through Settings.

**Why:** Chewbacca needs the same grants (Accessibility, Calendar, Contacts, Full Disk Access for chat.db, Screen Recording for the HUD), and today a stranger gets a list of switches to find. The bar for Chewbacca OS is "works for anyone on earth" ([[project_chewbacca_os]]), and this is the best version of that step Caleb has seen.

**How to apply:** build Chewbacca's permission step as this pattern: deep-link the exact Settings pane, float a draggable card for the right binary over it, detect the grant and advance on its own. Anarlog is MIT (github.com/fastrepl/anarlog), so its onboarding code can be taken and made native, with credit in CREDITS.md. Gavin owns onboarding (CHW-2, CHW-11): tell him. Related: a private note, [[project_chewbacca_os]].
