---
name: feedback_never_read_only
description: Chewbacca tools read AND write; a read-only tool is a half-built tool to Caleb. Make writes safe with a snapshot and an undo, never by refusing them
metadata:
  type: feedback
---

Chewbacca tools that touch a store both read and write it. On 2026-10-10 the first `mac-db` shipped read-only on purpose, and Caleb said "Wait NOTHING on chewb should ever be read only that is stupid".

**Why:** he builds Chewbacca to act for him. A tool that can see a thing but can't change it sends him back to the app by hand.

**How to apply:** ship the write path in the first version. Make it safe with an automatic snapshot plus a `restore`, writes routed through the app when the store syncs to iCloud, and CHEWBACCA_NO_SEND for sends. Don't make it safe by refusing writes. `mac-db` is the reference shape. Related: [[project_mac_db]], [[feedback_enforce_dont_document]].
