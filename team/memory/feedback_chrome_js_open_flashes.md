---
name: feedback_chrome_js_open_flashes
description: chrome-js --real --open still flashes Chrome over Caleb's screen; reuse an open tab or ask before opening one
metadata:
  type: feedback
---

`chrome-js --real --open <url>` hands the URL to Chrome's own binary, which
raises Chrome in front of whatever Caleb is using before the script gives focus
back. On 2026-10-13 that put a white TikTok Studio page over his screen and he
wrote "DONT FLASH BANG ME EVER WHAT DID I SAY?". An AppleScript `make new tab`
in the back window was tried as the quiet path and hung, because AppleScript
can't see the real Chrome on this Mac (the clone trap in chrome-js's header).

How to apply: drive a tab that's already open with `chrome-js --real --match`,
which never raises Chrome. If no tab is open, say so and let him open it.

Also learned the same night: TikTok Studio's schedule time picker ignores
synthetic clicks and scroll (only the date picker accepts them), and the page
CSP blocks injected scripts, so the time has to be set by a real click.
Upload works by pushing the file in base64 chunks with `--match` and handing a
DataTransfer File to the `input[type=file]`; fetching from localhost is blocked.

2026-10-22: `open -g -a "Google Chrome" <url>` flashed him too ("WHY DID YOU FLASH BANG ME") while uploading ACAD 185 group PDFs. -g does NOT keep Chrome back. Group dropbox uploads also fail over the API (1.75 404, 1.88+ "No scopes defined" with cookie auth), so a group submit has no silent path yet.
