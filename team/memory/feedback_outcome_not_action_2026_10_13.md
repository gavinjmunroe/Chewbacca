---
name: feedback-outcome-not-action-2026-10-13
description: The Zeutara dead-deck night: six root causes of lapsed judgment, each with its evidence and the change that answers it
metadata:
  type: feedback
---

On 2026-10-13 Ryan Korn (Zeutara) reported four investors got dead deck links, and that Togari wasn't scheduling meetings or following up. Caleb: "U kept lieng to me there hs to be smth wrong with our engineering process." What went wrong, found while fixing it the same night:

1. **The action got checked, never the outcome.** Slack-hosted deck links were tested once on 10/11 and 404d by 10/12. Togari marked a reply "done" when it posted a Slack card, so four investors who wanted calls sat at "done" for a week. The Clay feeder delivered 36 of 91 repliers, a gap a 10/9 note had already flagged, and nobody counted it. Done has to be measured against the source of truth: Clay's inbox, and what the investor actually got.
2. **It built from guesses that live data broke.** An out-of-office regex dropped Clive Fleissig ("may be interested"). "call" matched inside "periodically". A 2xx-only link check marked every DocSend deck dead, since DocSend gives bots a 403. It assumed one Togari instance and two queued the same replies. It didn't know Togari deletes handled negatives, so the poller re-queued Teresa. Every unit test passed, because each test encoded the same guess. Run the logic on the live inbox and read the misses before writing tests.
3. **Fixes went where the bug was first seen, not on the shared path.** Ryan asked for Vantage "before it answers anyone". It went on autopilot only, and the cards and the assistant sent unchecked until a second pass. List every caller first, then fix the function they all call (sendReplyEmail).
4. **Saved lessons lost to louder defaults.** Mail.app was used despite feedback_never_mail_app, because CLAUDE.md's MAC TOOLS table still listed it. The dashboard ran on launchd despite the server rule. Now enforced: mail-app-guard, and the CLAUDE.md fix (2c048591, 43492c09).
5. **The client's own system went unstudied.** Vantage already showed the pipeline better than the dashboard that got built. The token search stopped at one pass, and a deeper read found the "Vantage webhook" app-account in Jonah's workspace (its credentials are hidden by Clay).
6. **Claims ran ahead of evidence.** "Vantage is live" was said while it was off without a token, "0% dependent" about a Mac-hosted build, and Caleb was told he'd been wrong about the address when he meant "we'll add it".

Landed that night in togari: an inbox poller that reads every reply from Clay (21139b5) with a lease (28ff02c) and a handed-over record (0c7a436); Vantage on the shared send path (fc8eee8). Still to build: a daily outcome reconciliation (every Clay replier: answered, booked or passed, alert past 24h) and a claim gate. Full write-up: ~/Downloads/Chewbacca root causes 10-13.md.
