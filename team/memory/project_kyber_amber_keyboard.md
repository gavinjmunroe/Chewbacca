---
name: project_kyber_amber_keyboard
description: "Kyber names two live things: the Amber iMessage app with group cards (amber-circles, same thing) and the desktop HUD. The iOS keyboard built 2026-10-03 was the wrong product."
metadata:
  type: project
---

**What Kyber means (Caleb, 2026-10-07):** "Amber circles and kyber are the same thing", and "Kyber is also the name of the HUD". So Kyber = the Amber iMessage app with group cards ([[project_amber_circles_group_cards]]) AND the desktop HUD ([[project_chewbacca_os]]). Never write amber-circles and Kyber as two products, and never call the HUD "Chewbacca's desktop layer" in anything going to the Amber team. The keyboard below is history.

**Kyber the keyboard (history)** was Amber as an iOS custom keyboard, built 2026-10-03 on Caleb's ask: "take the entire amber ecosystem and throw it into kyber". It is the keyboard/group-intelligence line (line 4) in a private note, and the in-chat direction the ACAD 185 prof pushed in a private note. Not the same thing as Gavin's desktop assistant, which also gets called Kyber.

Lives in `amberintelligence/amber-ios`, `apps/mobile/targets/kyber/` (README there is the spec). Four tabs: Ask (the app's `/v1/chat` stream + Remind), People (favorites, circles, share card, intro ranked by circle-graph bridges, follow-up reminder, my link), Plans (agenda today/tomorrow, free windows as one sentence), Split (local bill split to the cent).

Auth: session keys are mirrored into the shared keychain group `<TEAM>.com.joinrytual.amber.shared` by `lib/secureStorage.ts`; both app and keyboard refresh and write back, because refresh tokens are single-use and a replay revokes every session.

**Why opt-in:** Karthik pulled extension targets from TestFlight on 2026-08-17 (`e4a4c7a`). Default build is unchanged; `eas build --profile kyber` turns it on. Whether Kyber goes into the real TestFlight build is Karthik's and Sagar's call.

**Verified:** Kyber target compiles for the simulator, 24 core checks pass in `npm test`, every tab rendered and inspected. **Not verified:** a run on a real phone with Full Access on.

**2026-10-04:** Amber build 114 (with the keyboard) archived, signed and uploaded to App Store Connect from this Mac via `apps/mobile/scripts/kyber-testflight.sh` (no EAS login). The ASC API key had been 403ing on an unsigned agreement until Caleb signed it. Caleb then said the keyboard was the wrong product: see [[feedback_find_the_existing_thing_first]].

**Repo (2026-10-30):** the Amber team said Kyber is Caleb's to keep. `calebnewtonusc/amber-circles` was renamed `calebnewtonusc/kyber`, Sagar's write access and Shirley's pending invite were removed, and `kyber-landing` (now `landing/`) and `kyber-a9-deck` (now `a9-deck/`) were moved in with history via git subtree. Both old repos are archived with a MOVED.md. The kyber-landing Railway service deploys from `calebnewtonusc/kyber`, root `landing`, watch `landing/**` (first deploy SUCCESS, fcd8d74). chip-in-setup clones `kyber` into `~/chip-in/kyber`. The HUD side of Kyber stays in Chewbacca.
