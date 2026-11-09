---
name: feedback_signed_in_but_403_is_chrome
description: A 403 from a cookie-reading tool while Caleb has signed-in tabs means Chrome stopped flushing its Cookies file; never tell him to sign in
metadata:
  type: feedback
---

On 2026-10-10 Caleb asked for his BISC 101 and ACAD 324 slides. brightspace and brightspace-sync both got 403 and the session told him to sign in. He had 5 signed-in Brightspace tabs: "Wtf I hv 5 signed in tabs? Fix chewb". His Chrome had been up 5 days, timed out on every AppleEvent, and hadn't written Profile 1/Cookies in 19 hours, so the live session existed only in memory.

**Why:** Every Chewbacca tool that borrows a browser session (brightspace, brightspace-sync, chewbacca api login) reads the on-disk cookie file. A wedged Chrome serves pages fine and leaves that file stale.

**How to apply:** Before saying "sign in", check `stat` on the profile's Cookies file. If Chrome is running and the file is over an hour old, the fix is Cmd+Q and reopen (tabs restore). `bin/brightspace` now says this itself (stale_cookie_message). Same session's other lessons: "pull my slides" is `brightspace-sync files <course> --out ~/coursework/slides --apply` with no disk hunt (coursework skill), and agent tabs open with `open -g` so his typing never lands in a page an agent drives (do-it-yourself rule, bin/chrome-js). Related: [[feedback_new_tools_never_reached_path]], [[feedback_take_me_there]].
