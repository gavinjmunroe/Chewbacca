---
name: project-hud-voice-key-chain
description: "The globe key doing nothing is almost never Accessibility, and rebuilding the HUD to fix it is what actually breaks Accessibility"
metadata:
  node_type: memory
  type: project
---

Push to talk on Bob HUD failed for hours on 2026-09-20 into 2026-09-21 and
every theory was wrong until the log was read.

**It was not Accessibility.** That grant was working the whole time. Every one
of Caleb's presses was already in the log:

```
log show --predicate 'subsystem == "bob.hud"' --last 30m --style compact
voice.key down=true mode=off
```

The key arrives; `mode=off` drops it at the guard in `globe(down:)`. The
listening mode lives in the UserDefaults key `hud.listening`, restored at launch
by `restoreListening()`, and it had never been written because nobody had picked
"Hold the globe key to talk" from the menu bar. Fix:
`defaults write dev.bobthebuilder.hud hud.listening -string "pushToTalk"`, then
restart. `voice.warm done code=1110` is healthy, 1110 is "no speech detected"
and the warm-up feeds the recogniser silence on purpose.

**Read the bob.hud log before forming any theory about the voice key.** Gavin
added that logging after a night when two presses left no trace and there was no
way to tell a key that stopped working from a key that stopped arriving. It
answers this in thirty seconds.

**The trap underneath it:** `hud doctor` compared the installed `CFBundleVersion`
against the repo's total commit count, and that number moves on any commit at
all, so a spec document in `docs/` made it demand a HUD rebuild. Obeying that
costs the voice key, because `bundle.sh` writes a new bundle, the signature
changes, and macOS drops the Accessibility grant. Fixed in `be0e8a3` by counting
at the newest commit under `hud/`.

> [!correction] ~~Expect to re-grant Accessibility after any real HUD rebuild;
> that part is macOS, not a bug.~~ **Wrong, corrected 2026-09-21.** It was not
> macOS. The bundle was ad-hoc signed, and an ad-hoc signature gives the
> Accessibility requirement nothing to name but the binary's own hash, so every
> rebuild was a new hash. Signing with a certificate pins the requirement to the
> certificate and the bundle id instead, and the grant survives. A usable
> certificate was in the keychain the whole time. See
> [[project_hud_adhoc_signing_and_warm]].

See [[project_hud_backlog]] for the rest of the display's work and
[[project_chewbacca]] for how it is reached from a session.
