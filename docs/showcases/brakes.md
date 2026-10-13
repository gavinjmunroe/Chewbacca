# Brakes on the two worst commands

A runtime install promises not to change your agent's permission settings, so
it adds a hook instead: `brake-guard` reads each shell command Claude Code is
about to run and refuses two that have no undo.

```sh
printf '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"},"cwd":"/tmp"}' | bash .claude/hooks/brake-guard.sh; echo "exit $?"
```

Output, 2026-10-13:

```text
brake-guard: refusing `rm -rf ~`. It deletes your home folder or the whole disk, and there is no undo.
exit 2
```

| Command | Exit | Meaning |
| --- | --- | --- |
| `rm -rf ~` | 2 | refused, the agent sees why |
| `git push --force origin main` | 2 | refused: "A force push to main rewrites history everyone else has pulled" |
| `ls -la` | 0 | allowed, nothing printed |

Replayed on 800 real agent tool calls from the author's machine: it acted on
none of the 741 it skips and refused none of the 43 ordinary commands it read.
It is a backstop for accidents, not a sandbox: a determined spelling can get
past a word list, and each one found goes into `tests/test_brake_guard.py`.

Setup registers it for Claude Code. Cursor and Gemini CLI run Claude Code's
hooks through a bridge, which this page did not re-check. VS Code has no hook
point for it.
