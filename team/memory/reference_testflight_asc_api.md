---
name: reference_testflight_asc_api
description: TestFlight testers, groups and beta review straight from the App Store Connect API with amber-circles tools/asc.py; key location, ids, and the silent duplicate-build drop.
metadata:
  type: reference
---

`~/code/amber/amber-circles/tools/asc.py` signs App Store Connect API calls (ES256 JWT) with the key at `~/.appstoreconnect/private_keys/AuthKey_BUU5Z6J9GL.p8`, issuer `<issuerId in amber-ios eas.json>`, team 4DMVHH99R2. Recipes live in that repo's HANDOFF.md. Same key works for every app on the team: Amber!! (amber-ios, 6774023666), Amber Keyboard (amber-circles, 6765705839), tizzy ai, Silo!.

Facts learned 2026-10-09 while shipping a private note:
- Inviting = `POST /v1/betaTesters` with the Apple ID email and the external group. Internal groups 422 on adding builds because they get all of them.
- After a group's first approved build, later beta reviews came back APPROVED within minutes (61 and 63).
- Re-uploading an existing build number prints "Upload succeeded" and Apple drops it silently (62). Always bump, then list builds to confirm.
- "Is the public link live?" = load the join page and read it: "Join the X beta" means open; a full or closed beta says so on the page.
- `claude-sonnet-5-5` rejects `tool_choice` of type tool/any ("not supported for this model"); ask for the tool in the system prompt instead.
