---
name: reference-read-x-articles-via-chrome
description: "How to read login-walled X/Twitter posts and long-form Articles using Caleb's logged-in Chrome via AppleScript."
metadata:
  node_type: memory
  type: reference
  originSessionId: d52a688f-abb0-48b0-abea-393a6d61a839
  modified: 2026-07-30T21:10:12.220Z
---

X links Caleb pastes are often long-form **Articles** (`x.com/i/article/<id>`), whose body needs a logged-in session. Everything anonymous fails: direct fetch 402, `api.fxtwitter.com` / `api.vxtwitter.com` return only the bare `t.co` link with empty text, and `r.jina.ai` 403s on x.com.

What works: drive Caleb's already-logged-in Chrome via AppleScript JS execution (verified enabled on his machine).

```bash
osascript -e 'tell application "Google Chrome"
  tell front window to make new tab with properties {URL:"https://x.com/i/article/<id>"}
end tell'
# poll document.body.innerText.length until > 1500 (SPA needs ~10-30s), then:
osascript -e 'tell application "Google Chrome" to execute front window'"'"'s active tab javascript "document.body.innerText"'
osascript -e 'tell application "Google Chrome" to close active tab of front window'
```

To resolve a status URL to its article id first: `curl -s https://api.vxtwitter.com/i/status/<tweet_id>` and read the `text` field.

**Why:** Caleb pastes X links expecting them read, and the polite "it's behind a login" answer is not acceptable to him. He responded to it with "Bro figure it out read them all."

**How to apply:** Go straight to the Chrome route for any `x.com` link; skip the mirror APIs except to resolve the article id. Note the shell is zsh, so `for u in $urls` does not word-split. Use `while read`. Related: a private note
