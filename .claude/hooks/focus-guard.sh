#!/bin/bash
# hookd skips this guard for a Bash call that names none of these words,
# each one its first check requires. Proven by tools/hookd_replay.py.
# gate: open osascript
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# PreToolUse on Bash: refuse an agent command that would pull an app or a
# browser tab to the front of Caleb's screen.
#
# 2026-10-10 the rule went into do-it-yourself.md as prose ("open -g, never a
# bare open or open -na"). 2026-10-11 at 1:38am, mid-session, he wrote "Bro I
# thought we had fixed chewbs so when it opens smth it does it in the
# background instead of waking up the entire city with a flashbang tab opening
# and taking over???", then "Fix chewb". Prose did not hold, so this refuses.
#
# Refused: `open` with a URL, a file or `-a App` and no `-g`; `osascript ...
# activate` on a browser. Allowed: anything with `-g`, `open -R` (reveal in
# Finder never takes focus away from an editor), and a command carrying
# `foreground:` for the one case a person asked to see the thing now. A
# settings pane he has to click goes through `open "x-apple.systempreferences:..."`
# and is allowed: that is the do-it-yourself "take me there" rule.
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ -n "$INPUT" ] || exit 0

CMD="$(printf '%s' "$INPUT" | python3 -I -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit
ti = d.get("tool_input") or {}
if isinstance(ti, dict) and d.get("tool_name") == "Bash":
    print(str(ti.get("command") or "").replace("\n", " "))
' 2>/dev/null)"
[ -n "$CMD" ] || exit 0

VERDICT="$(printf '%s' "$CMD" | python3 -I -c '
import re, shlex, sys
cmd = sys.stdin.read()
if "foreground:" in cmd:
    raise SystemExit
# The same open from inside a script: subprocess.run(["open","-na",...]) in a
# python heredoc flashed Chrome at Caleb on 2026-10-11 10:15pm ("STOP FLASH
# BANFING ME"), because the shell split below only sees the word "python3".
Q = "[\"\x27]"
for m in re.finditer(r"[\[(,]\s*" + Q + r"open" + Q + r"\s*,([^\])]*)", cmd):
    rest = m.group(1)
    background = re.search(Q + r"-[A-Za-z]*g[A-Za-z]*" + Q, rest)
    browser_n = re.search(Q + r"-[A-Za-z]*n[A-Za-z]*" + Q, rest) and re.search(r"chrome|safari|arc|brave|firefox|edge|comet", rest, re.I)
    if browser_n or not background:
        print("open from a script without -g: " + m.group(0).strip()[:120])
        raise SystemExit
# Split on shell operators so "cd x && open http://..." is seen.
for seg in re.split(r"&&|\|\||;|\||\$\(|`", cmd):
    try:
        words = shlex.split(seg, posix=True)
    except ValueError:
        words = seg.split()
    while words and ("=" in words[0] and not words[0].startswith("-")):
        words = words[1:]          # VAR=x open ...
    if not words:
        continue
    head = words[0].rsplit("/", 1)[-1]
    args = words[1:]
    if head == "open":
        flags = "".join(a[1:] for a in args if a.startswith("-") and not a.startswith("--"))
        # -n hands a browser a new window, and Chrome fronts a new window even
        # under -g: two flashes on 2026-10-11 came from exactly
        # `open -g -na "Google Chrome" --args --profile-directory=...`.
        if "n" in flags and re.search(r"chrome|safari|arc|brave|firefox|edge|comet", seg, re.I):
            print("open -n starts a browser window, which always comes to the front: " + seg.strip()[:120])
            raise SystemExit
        if "g" in flags or "R" in flags:
            continue
        targets = [a for a in args if not a.startswith("-")]
        if any(t.startswith("x-apple.systempreferences:") for t in targets):
            continue
        if targets or "a" in flags:
            print("open without -g: " + seg.strip()[:120])
            raise SystemExit
    if head == "osascript" and re.search(r"(chrome|safari|arc|comet|brave|firefox)[^\"]*\"?\s*(to\s+)?activate|activate[^\n]{0,40}(chrome|safari)", seg, re.I):
        print("osascript activates a browser: " + seg.strip()[:120])
        raise SystemExit
' 2>/dev/null)"
[ -n "$VERDICT" ] || exit 0

cat >&2 <<EOF
focus-guard: this would pull a window to the front of Caleb's screen ($VERDICT).
Agents open things in the background: \`open -g URL\`, \`open -g -a App\`, or
\`chrome-js --open URL\` (it restores whatever was in front). If he asked to see
it right now, put \`foreground:\` in a comment on the command and run it again.
EOF
exit 2
