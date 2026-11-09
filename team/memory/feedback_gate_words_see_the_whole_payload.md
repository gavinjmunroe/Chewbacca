---
name: feedback_gate_words_see_the_whole_payload
description: A hookd gate word is matched against the whole hook payload, so it must not hide in a host key, and anything non-ASCII runs the guard; both cost a review on 10/12
metadata:
  type: feedback
---

hookd skips a gated guard only when none of its `# gate:` words appear in the
raw hook payload. On 2026-10-12 two gate designs that passed the replay were
wrong in ways the replay could not see:

- zsh-guard declared `path`. Every payload the host sends carries
  `"transcript_path"`, so the guard ran on every call and the gate saved
  nothing. The replay built payloads with only command and cwd, so it never
  showed. It now builds them with every key the host sends, and
  tests/test_hookd.py runs every gated guard on a plain call with all of them.
- A review found `X=OSASCR` + U+0130 + `PT; ${(L)X}` and the same shape for
  whisper got past two gated guards that lowercase with tr: macOS `tr` and
  zsh's `(L)` fold U+0130 to `i`, so the shell ran a word the text never
  held. hookd now runs the guard on any non-ASCII byte and on any escaped
  printable character.

Also learned that night: the Write and Edit tools turn a backslash, `u` and
four hex digits into the character itself, so test strings meant to hold a
JSON escape silently became the raw character, and a commit message lost one.
Write escape-bearing code through a Bash heredoc and grep the file for the
escape afterwards.

**Why:** a gate that runs too often is slow, and a gate that skips a word the
shell can still spell is a bypass. The replay only proves what its payloads
contain.
**How to apply:** pick gate words that never occur in host keys, keep the
non-ASCII rule, and when adding a guard, check the realistic-payload test and
the side-by-side against main before landing. Related:
[[feedback_guard_precise_path_never_judges_less]].
