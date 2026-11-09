# LockDown Browser won't start a quiz

Seen 2026-10-19 on a Brightspace quiz: "LockDown Browser is not installed" while
it was installed in /Applications and had just launched. Caleb: "Lockdown
browser isn't working bruh it's tweaking".

That banner only means Brightspace in Chrome couldn't detect the app. Check the
machine before believing it:

1. `pgrep -fl "LockDown Browser"` and the process start time. A process that
   started when he clicked means the rldb:// launch worked.
2. Screenshot. On 10/19 the window sat on a blank "New Tab" with the stop (X)
   button showing, a hung load.
3. Fix that worked: quit it (`pkill -f "LockDown Browser"`), move
   `~/Library/Application Support/Respondus LockDown Browser/cefcache` aside
   (rename, never delete), then he clicks "Try launching again".
4. `lsregister -dump | grep rldb` confirms the URL scheme is registered if the
   app never starts at all.

Never touch exam controls or try to get around the browser's checks. This is
only about getting it to open.

## Blocklisted apps froze the Mac (2026-10-19)

LockDown listed ~70 processes (Claude, Slack, Spotify, Loom, Ollama,
llama-server, node_repl) and "Close Applications and Continue" froze the Mac
at load 7 with an iOS simulator up. It needed a hard restart. Caleb: "It didn't
work bro it froze and then I had to restart my computer".

- Before a LockDown quiz, he opens /Applications/Quiz Mode.app
  (`tools/lockdown_ard/quiz-mode.sh`, `--dry-run` lists targets). It quits those
  apps politely, shuts simulators, then opens nothing. He launches from Brightspace.
- Never click "Close Applications" for him: it kills Claude. Name it as his click.
- "Stuck" on a blank tab may be this dialog hidden behind the window. Screenshot
  before calling it a hang.
- Remote Management is paused and restored by the watcher in
  docs/reference/LOCKDOWN.md. Its helper needs the Full Disk Access toggle ON,
  being listed with the switch off did nothing.
