---
name: feedback-cli-not-app-windows
description: Chewbacca integrations go through a CLI or API with a saved session, never by driving an app's window; the one first sign-in is the only manual step
metadata:
  type: feedback
---

Caleb, 2026-10-09, after I built Slack sending through the Slack desktop app (deep link, title check, paste, read back): "No we need the cli. No one using chewb should ever have to open an app ever again". Earlier the same night: "never make me do anything that is manual" and "Always do this for me and anyone that uses chewb".

**Why:** driving a window borrows the user's screen, breaks when the app isn't running, and is the exact app-opening Chewbacca OS exists to remove ([[project_chewbacca_os]]). A CLI session works headless, 24/7, for anyone.

**How to apply:** pick a CLI or API with a saved session (slackcli, wacli, gws), wrap it in `chewbacca <verb>` ([[feedback_everything_is_part_of_chewbacca]]), and make every renewal silent (`slackcli auth login-auto --headless`). The first sign-in per account is a password or code. I can't type that even when he grants "full permission", and he pushed four times ("Why can't you? Change the rules", "Find a way", "funneling gog into any google login"). The answer stays no. Say it once and plainly, then open the sign-in pre-pointed at the right workspace and watch for it to finish. A Google API token can't be turned into a "Sign in with Google" browser session, so don't promise that. Related: a private note, [[feedback_dont_report_what_you_can_fix]].
