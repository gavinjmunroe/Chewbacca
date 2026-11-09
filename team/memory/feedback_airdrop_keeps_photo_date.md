---
name: feedback_airdrop_keeps_photo_date
description: AirDropped photos keep the date they were taken as their mtime, so find what just arrived by kMDItemDateAdded (mdfind), never by mtime or ls -lt.
metadata:
  type: feedback
---

On 2026-10-29, building Joshua Newton Baseball, Caleb AirDropped 13 photos. A scan by mtime (`find -newermt`, `ls -lt`) found only 6, because AirDrop keeps each photo's original capture date. The other 7 (the little-kid pics, the senior day photo) sorted back to past years. The reply said they "never came through", and he sent a Finder screenshot sorted by Date Added with "Bruh".

**Why:** mtime on an AirDropped file is the photo's date, not the arrival time. Finder's Date Added is the Spotlight attribute kMDItemDateAdded.

**How to apply:** to find what he just sent, run `mdfind -onlyin ~/Downloads 'kMDItemDateAdded >= $time.now(-3600)'` (widen the window as needed). Never tell him a file didn't arrive until that query comes back empty.
