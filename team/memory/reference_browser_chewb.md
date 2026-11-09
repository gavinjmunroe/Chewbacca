---
name: reference_browser_chewb
description: The Chewbacca Chrome extension (apps/extensions/chewbacca) turns a chatgpt.com or claude.ai tab into Chewbacca through the native host com.chewbacca.browser; reads run, writes need a native macOS press
metadata:
  type: reference
---

`apps/extensions/chewbacca` (shipped 2026-10-13, replaced the ChatGPT-only stub in `apps/extensions/chatgpt`) is one MV3 extension for chatgpt.com and claude.ai. The contract is `docs/reference/BROWSER-CHEWB.md`; the freemium line is `docs/plans/BROWSER-FREEMIUM.md`.

- Free with nothing installed: summarize a tab, what's due from a signed-in Brightspace tab, draft a reply from the right-click menu. Results go into the chat composer and are never sent.
- The Mac half: `chewbacca browser install` registers `com.chewbacca.browser` for one extension id, `jedodajajfjoikfajbnpfmbmocicbecn`, pinned by the manifest `key`. `setup.sh` runs it. Loading the unpacked extension is a person's step in chrome://extensions.
- The boundary lives in `bin/lib/browser_host.py`, never in the extension: a closed tool table, no shell, writes and texts need a press in an osascript dialog the host draws, the shared folder is `~/Chewbacca Shared`, every call logs to `~/.chewbacca/logs/browser-host.jsonl`.
- Tests: `tests/test_browser_host.py` (the attack) and `tests/browser_chewb_headless.py` (headless Chromium, scratch profile, fake pages for both sites, the saved real chatgpt.com DOM), group `browser` in `tests/run.sh`.

Gotchas found building it: logged-out chatgpt.com on 10/13 renders its composer as `textarea[name="prompt"]`, not `#prompt-textarea`; claude.ai answers a headless fetch with a Cloudflare challenge, so its selectors are unverified live; `time.monotonic()` starts near 0 per process on macOS, so a "last time" of 0.0 reads as just now; Calendar fails from a host the shell started because TCC asks for the app that launched it, which is Chrome in real use. Related: [[reference_chewbacca_connect]].
