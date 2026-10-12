#!/bin/bash
# Timing, logging, a watchdog and an output cap. See lib.sh.
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init client-ask-guard.sh 5
# PreToolUse on Bash: a Slack post that tags a client waits for a fresh, clean
# `chewbacca gtme done --client <name>` (under 30 minutes, nothing the client
# sent left unread).
#
# 2026-10-11: a to-do post tagged Jonah for three decks and his form answers he
# had DM'd the day before; nobody had read the DM. The checklist that should
# have caught it named texts and the channel, not the DM. Running the check is
# now the step before the ask, so reading what the client sent comes first by
# default instead of by memory.

set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -qE 'slackcli[[:space:]]+messages[[:space:]]+send' || exit 0
CMD="$cmd" python3 - <<'PY'
import json, os, re, shlex, sys, time
cmd = os.environ["CMD"]
cfg_path = os.path.expanduser(os.environ.get("CHEWBACCA_GTM_CLIENTS", "~/.chewbacca/gtm/clients.json"))
state = os.path.expanduser(os.environ.get("CHEWBACCA_STATE_DIR", "~/.chewbacca/state"))
try:
    clients = json.load(open(cfg_path)).get("clients", [])
except (OSError, ValueError):
    sys.exit(0)
try:
    argv = shlex.split(cmd)
except ValueError:
    argv = cmd.split()
def flag(name):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else ""
text = flag("--message")
f = flag("--message-file")
if f and f != "-":
    try:
        text += open(os.path.expanduser(f)).read()
    except OSError:
        pass
for c in clients:
    cs = c.get("client_slack") or {}
    user = cs.get("user")
    if not user or f"<@{user}>" not in text:
        continue
    slug = "".join(ch if ch.isalnum() else "-" for ch in c["name"].lower())
    try:
        r = json.load(open(os.path.join(state, "gtme-done", slug + ".json")))
    except (OSError, ValueError):
        r = None
    fresh = r and time.time() - r.get("at", 0) < 1800
    if not fresh or r.get("client_unanswered") or r.get("not_run"):
        why = "has not run in the last 30 minutes" if not fresh else "found something from them still unanswered, or could not read a source"
        print(f"client-ask-guard: this post tags {c.get('principal') or c['name']}. `chewbacca gtme done --client \"{c['name']}\"` "
              f"{why}. Run it and answer what they sent first; on 2026-10-11 a post asked Jonah for decks he had DM'd the day before.",
              file=sys.stderr)
        sys.exit(2)
sys.exit(0)
PY
