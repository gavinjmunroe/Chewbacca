---
name: feedback_phone_is_never_lesser
description: A site Chewbacca builds must be as rich on a phone as on desktop and never flash; site-gate parity and flash enforce it
metadata:
  type: feedback
---

On a phone, a site Chewbacca builds keeps everything that makes the desktop version good: pinned scenes stay pinned (compact), the first screen keeps its drawings, and demos keep their main side. Nothing flashes or whips around under a fast thumb scroll.

**Why:** Caleb, 2026-10-10, on the Firm Foundation site on his phone: "So much of the mobile version is 10x lamer than the desktop version" and "some of the mobile animations/transitions are literal whiplash and flashbangs". The phone had one hero plate where desktop had five, the what-we-do scene had been unpinned into a stack (motion on 56% of phone screens against 88% on desktop), and the header flipped in and out under momentum scroll.

**How to apply:** run `site-gate parity <url>` and `site-gate flash <url>` before calling any site done; both are in `bin/site-gate` with an offline test. Look at the phone screenshots, not only the desktop ones. Related: [[feedback_no_unintentional_animation]], [[feedback_website_four_layers]].

Same night, a third gate: `site-gate deck <url>` fails three sections in a row with one shape, and a page where under a third of section edges carry anything across. Firm Foundation's Home failed it at 1 of 3 and passed at 2 of 3 once the Monday section got its own ground.

And a fourth: `site-gate focus <url>` fails a dense screen whose biggest text is under 1.6x the usual size, more than 40 lines at one size, or one control with more than 4 choices. It came from the scene screen with a 15-column grid and a readout at one type size, and the phone demo's 3 paths x Before/After.
