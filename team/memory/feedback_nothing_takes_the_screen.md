---
name: feedback_nothing_takes_the_screen
description: Agents never pull a window or tab to the front; focus-guard refuses a bare open or a browser activate (Caleb at 1:38am 10/11, "flashbang tab")
metadata:
  type: feedback
---

No agent command brings an app, a browser window or a tab to the front of Caleb's screen. Everything opens in the background (`open -g`, `chrome-js --open`, headless browsers for screenshots).

**Why:** on 2026-10-11 at 1:38am, a day after the rule went into do-it-yourself.md as prose, Caleb wrote "Bro I thought we had fixed chewbs so when it opens smth it does it in the background instead of waking up the entire city with a flashbang tab opening and taking over???" and then "Fix chewb". Five code paths still opened in the foreground: bin/brightspace, bin/chewbacca-usc, gtme's signup page, the people dashboard, and chrome-js `--activate`, which the ChatGPT and Perplexity tab tools use.

**How to apply:** `.claude/hooks/focus-guard.sh` (PreToolUse on Bash, Chewbacca 9d94ab8e, tests/focus_guard.sh) refuses `open` without `-g` and any osascript that activates a browser. A settings pane he has to click is allowed, per [[feedback_take_me_there]]. If he asked to see something right now, put `foreground:` in a comment on the command. New code that opens anything uses `open -g` from the start. Related: [[feedback_other_tab_means_background_agent]].

**2026-10-11, the -g loophole.** `open -g -na "Google Chrome" --args --profile-directory=...`
passed the guard because it carried -g, and it still flashed a new window over
his work twice in one evening ("WHY DID YOU WHIPLASH FLASH BANG ME WITH A NEW TAB
POPPING UP AND CONTROLLING MY SCREEN"). Chrome fronts any NEW window it is
handed, -g or not. focus-guard now refuses `open -n` on a browser, and the USC
sign-in adds a background tab to a window he already has open via AppleScript,
restores that window's tab, and closes its own once signed in. Measured: the
frontmost app was Code before and after.

**2026-10-11, later the same night: the bridge itself.** Every `chewie web` call
started its own Chrome, a windowed copy of the profile, and that window took the
screen; the inbox read drove it on every run ("ANOTHER CLAY FLASHBANG"). No
command a guard could match was involved. The launch now runs `--headless=new`
unless CHEWIE_WEB_VISIBLE=1 (322cb8ae, tests/web_headless.sh), a windowed bridge
Chrome left running is replaced, and the inbox read uses the API with the
browser behind `--browser` (86587a58). See [[feedback_fix_the_class_at_the_source]].
