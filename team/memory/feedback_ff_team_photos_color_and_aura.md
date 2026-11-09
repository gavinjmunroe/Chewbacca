---
name: feedback_ff_team_photos_color_and_aura
description: FF /team photos are in colour, never black and white; a founder leads with his professional headshot; logos are big with a halo
metadata:
  type: feedback
---

On the Firm Foundation /team page (2026-10-29), Caleb on a single pass of the advisor grid:

- "NO B&W BRO ITS NOT A FUNERAL". Every headshot is in colour. Joel Newton's and Jim Munroe's files were grayscale at the source (Praxis, CityLights and Killswitch all publish B&W), so a public copy is not enough: check the pixels (`max-min` channel spread near 0 means grayscale) and find a colour one, or ask him to copy one. `chewbacca photo check <dir>` does the pixel check and `chewbacca photo paste <out.jpg>` saves what he copied. A pasted chat image can't be read from disk, but his clipboard can (`osascript` `the clipboard as «class PNGf»`), and the clipboard's HTML names the source page.
- "BRING BACK GAV IN A SUIT BRUH THAT WS PROFESSIONAL". A founder card leads with the suit headshot (`gavin-munroe.jpg`); casual shots go in the hover fan.
- "BIGGER LOGOS MORE AURA". Org marks under each advisor are 56px with an ice halo, not 40px chips.

**Why:** the page is for church staff deciding whether to trust two young founders; grey photos read as a memorial and casual shots read as unserious.

**How to apply:** before shipping any FF people card, check each photo is colour and the lead photo is the professional one. Adding a card that leaves a row with one card gets a layout change (Andrew's lead card went full width), never a stretched photo: a 2 by 3 span blew his face up to 900px.

Related: [[project_ff_team_page_2026_10_28]], [[feedback_ff_site_is_for_church_staff]].
