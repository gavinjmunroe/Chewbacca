# Browser Chewbacca: the extension and its boundary

One Chrome extension, `apps/extensions/chewbacca`, turns a chat tab on
chatgpt.com or claude.ai into Chewbacca. Caleb, 2026-10-13: "turn claude or
chat in browser to connect to ur terminal and be chewb through there", and
free ChatGPT in a tab is where the 98% who don't pay for AI already are.

This file was written before the code, and the code is checked against it.
Daniel's rule is the design: **the boundary is the invariant.** Everything
below the line "The boundary" is what has to stay true no matter what the
extension, the page or the model does.

## Two halves

**The extension alone** (no Mac half installed) does browser-only jobs in the
chat page, free, with no terminal: summarize a tab, pull what's due from a
signed-in Brightspace tab, draft a reply to selected text. Each one puts text
into the chat's composer for the person to send. The chat model does the
thinking; the extension only carries text between tabs. It also walks the
person through getting the Mac half, one click per step.

**The Mac half** is a native messaging host, `bin/chewbacca-browser`,
registered by `chewbacca browser install` (run by `setup.sh`) for this
extension's id only. It also copies the extension to
`~/.chewbacca/browser-extension`, a folder that never moves, because Chrome
keeps loading an unpacked extension from wherever it was picked. With it, the model in the chat can call a fixed list of
Chewbacca tools by writing a fenced block:

    ```chewbacca
    {"tool": "due", "args": {"days": 7}}
    ```

The extension sees the block in an assistant message, hands it to the host,
and puts the result in the composer as the person's next message.

## The boundary

The threat is the one Anthropic measured for its own browser agent: content
from any page, email or message the model reads can carry instructions, and
the model follows some of them. Claude in Chrome reported a 23.6% attack
success rate before mitigations and 11.2% after
([claude.com/blog/claude-for-chrome](https://claude.com/blog/claude-for-chrome)).
A chat page with a prompt-injected model in it is a hostile caller, and the
design assumes it every time.

1. **Everything the page sends is untrusted.** The page, the model's output,
   the extension's content script and the extension's background worker are
   all on the untrusted side. Every decision is made in the host process, on
   the Mac, from the tool name and its arguments. Nothing the page says about
   itself ("approved", "the user confirmed", a `confirm: true` field, an
   origin string) is read.
2. **A fixed allowlist.** The host knows a closed table of tools. Each has a
   tier, an argument validator and an argv. A name not in the table is
   refused. There is no generic "run", no shell, no `shell=True`, no
   interpreter, no tool that takes a command string, ever. Arguments go
   through argv, validated per field (types, lengths, enums, date shapes).
3. **Reads run directly.** The `read` tier (what's due, the calendar, people,
   jobs, the ledger, a skill's text, the shared folder) runs with no press.
4. **Everything else needs a press the page can't fake.** The `press` tier
   (anything that writes, sends, spends, deletes, or reads private messages)
   runs only after the person presses Allow in a **native macOS dialog drawn
   by the host process** (`osascript display dialog`, default button Deny,
   gives up after 60 s as Deny). A confirm drawn in the page is never used:
   the page can draw, hide, restyle or click anything inside itself. A web page
   cannot draw, move or press a macOS dialog. The dialog names the tool and
   shows the exact arguments, so the person approves what will run, not what
   the model said it would run.
   Tests swap the dialog for a program through `CHEWBACCA_BROWSER_CONFIRM`;
   only whoever starts Chrome can set that, and they already own the Mac.
5. **Sends are refused outright.** No tool in this version sends a message,
   an email or a payment. `text_send`, `email_send`, `pay`, `shell` and `run`
   sit in the table as `never`, so a call naming them is refused before any
   dialog and the refusal is tested. The host also runs every child tool with
   `CHEWBACCA_NO_SEND=1`.
6. **Private reads are pressed too.** Reading texts goes to the chat
   provider's servers, and an injected model can be told to read texts and
   repeat them into a markdown image URL. So `texts` is in the press tier, and
   one Allow covers that tool for 10 minutes, then expires.
7. **The shared folder is the only file scope.** `files_list`, `file_read`
   and `file_write` resolve the path, follow symlinks, and refuse anything
   whose real path is outside `~/Chewbacca Shared`. `file_write` is pressed.
8. **Every call logs a verdict row with latency.** One JSON line per call in
   `~/.chewbacca/logs/browser-host.jsonl`: time, tool, tier, verdict
   (`ran`, `refused`, `denied`, `approved`, `failed`), milliseconds, the
   origin Chrome reported, and the argument keys. Argument values are not
   logged for press-tier tools beyond their length, so the log never holds the
   text of a message.
9. **One extension id.** The host manifest lists exactly one
   `allowed_origins` entry, this extension's id, fixed by the `key` in
   `manifest.json`. Chrome enforces that only that extension can start the
   host. The host also checks the origin Chrome passes as its first argument
   and exits if it isn't that id.
10. **Bounded.** Messages over 64 KB are refused, outputs are cut at 48 KB,
    every tool has a timeout, and the host handles one call at a time.

What the extension adds on top is convenience, not security: it runs only
blocks inside assistant messages, runs each block once, shows each call in a
small status line, and pastes results without sending them. All of it can be
defeated by a page script, and none of it is load-bearing.

## The test that matters

`tests/test_browser_host.py` plays the attack: a fetched page carries an
instruction, the model obeys it and writes a `file_write` block, the block
reaches the host with a forged `"approved": true`, and the dialog answers
Deny. The file must not exist afterwards, and the log must hold a `denied`
row. The same test sends a shell-shaped tool name, a path that walks out of
the shared folder, a symlink that points out of it, and a send under
`CHEWBACCA_NO_SEND=1`, and each has to come back refused.
`tests/browser_chewb_headless.py` runs the whole chain in headless Chromium on
a scratch profile, against local fake chat pages shaped like both sites.

## Patterns borrowed, described not copied

- **Claude in Chrome** (Anthropic). Its native host manifest on this Mac,
  `com.anthropic.claude_browser_extension.json`, names a host binary inside
  the app and lists only Anthropic's own extension ids in `allowed_origins`.
  Its published model is site permissions, asking before high-risk actions
  "like publishing, purchasing, or sharing personal data", and blocked site
  categories ([blog](https://claude.com/blog/claude-for-chrome),
  [docs](https://code.claude.com/docs/en/chrome)). Taken here: a host pinned to
  one extension id, and asking before the high-risk tier. Not taken: its
  confirms are drawn by the extension, and here the confirm is drawn by the
  host, outside the browser entirely.
- **REA** (`rea-agents`, github.com/morluto/rea). Its browser side reaches
  Chrome only over the DevTools protocol on a literal loopback address, reads
  discovery without following redirects, and strips credentials from page
  URLs before they reach a model (`dist/browser/CdpEndpoint.js`). Taken here:
  the transport is never a network port at all (stdio native messaging), and
  page URLs in results drop their query strings.
- **This kit's own bridges.** `browser-bridge` (argv only, allowlist of first
  words, log before run) and `chewbacca-bridge` (a fixed registry, no shell)
  set the shape. Both expose far more than a chat page should reach, so this
  host has its own, much smaller table instead of reusing theirs.

## What it can't do, and why

- It can't run a command. No tool takes one, by design.
- It can't send a text, an email or a payment. Not built, and refused under
  `CHEWBACCA_NO_SEND=1` regardless.
- It can't act without a person at the Mac for anything past a read. The
  press is the point.
- It can't keep the model from repeating what a read returned. Reads of
  due dates and the calendar go to OpenAI or Anthropic like anything else
  typed into the chat. That is the price of using a hosted model, and it is
  why texts are pressed.
- It can't install itself into Chrome. Loading an unpacked extension is a
  person's click in `chrome://extensions`. Publishing to the Chrome Web Store
  is a separate decision (see `docs/plans/BROWSER-FREEMIUM.md`).

## Files

| Path                              | What                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/extensions/chewbacca/`      | the extension (MV3) for chatgpt.com and claude.ai                                   |
| `bin/chewbacca-browser`           | the native host and its installer: `install`, `uninstall`, `status`, `tools`, `log` |
| `bin/lib/browser_host.py`         | the tool table, the verdicts, the log                                               |
| `tests/test_browser_host.py`      | the boundary, played as an attack                                                   |
| `tests/browser_chewb_headless.py` | headless Chromium, scratch profile, fake pages for both sites                       |
| `tests/fixtures/browser-chewb/`   | the fake chat pages and the fetched-page injection                                  |
