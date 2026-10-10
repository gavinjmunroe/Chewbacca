#!/bin/bash
# UserPromptSubmit: when the prompt names a client, put that client's standing
# rulings into context before any answer: the "rulings" on its entry in
# chewbacca gtme's clients.json (anyone's install), and DECISIONS.json in a
# client repo under ~/code/work if there is one.
#
# On 2026-10-09 a week-1 update for Jonah told him we'd narrow every list.
# Maggie had ruled on 10/5 that Jonah wants volume and Sagar on 10/4 to send
# strongest fits first; both rulings lived in notes no session read before
# advising. A skill line saying "read the rulings" is advice; this puts them in
# front of the model on the prompt that needs them. Silent when no client is
# named, so ordinary prompts pay one small file scan and nothing else.
set -uo pipefail
ROOT="${CHEWBACCA_CLIENT_REPOS:-$HOME/code/work}"
GTME="${GTME_HOME:-$HOME/.chewbacca/gtm}"
PROMPT="$(cat 2>/dev/null | python3 -I -c 'import json,sys
try: print(json.load(sys.stdin).get("prompt",""))
except Exception: pass' 2>/dev/null)"
[ -n "$PROMPT" ] || exit 0
PROMPT="$PROMPT" ROOT="$ROOT" GTME="$GTME" python3 -I - <<'PY'
import glob, json, os, re
prompt = os.environ["PROMPT"].lower()
out = []
for path in sorted(glob.glob(os.path.join(os.environ["ROOT"], "*", "DECISIONS.json"))):
    try:
        d = json.load(open(path))
    except Exception:
        continue
    names = [n.lower() for n in d.get("aliases", [])]
    if not names or not any(re.search(r"\b" + re.escape(n) + r"\b", prompt) for n in names):
        continue
    rules = [r for r in d.get("rulings", []) if r.get("status") == "active"]
    if not rules:
        continue
    lines = [f"- {r['rule']} ({r['who']}, {r['date']})" for r in rules]
    out.append(f"Standing rulings for {d.get('client', os.path.basename(os.path.dirname(path)))}, from {path}. "
               "Check any recommendation or client-facing text against these; a plan that contradicts one names it and who owns changing it:\n"
               + "\n".join(lines))
# chewbacca gtme clients: the name, the principal and every offer are the
# aliases, so "send Jonah the update" or "how's Qube doing" both load them.
seen = {o.split(" for ", 1)[1].split(",", 1)[0] for o in out if " for " in o}
try:
    clients = json.load(open(os.path.join(os.environ["GTME"], "clients.json"))).get("clients", [])
except Exception:
    clients = []
for c in clients:
    name = c.get("name") or ""
    rules = [r for r in (c.get("rulings") or []) if (r.get("status") or "active") == "active"]
    if not name or not rules or name in seen:
        continue
    names = [name, c.get("principal") or ""]
    for o in c.get("offers") or []:
        names += [o.get("name") or ""] + list(o.get("aliases") or [])
    names = [n.lower() for n in names if n and len(n) >= 3]
    names += [n.split()[0] for n in names if " " in n and len(n.split()[0]) >= 4]
    if not any(re.search(r"\b" + re.escape(n) + r"\b", prompt) for n in names):
        continue
    lines = [f"- {r.get('rule')} ({r.get('who', '?')}, {r.get('date', '?')})" for r in rules]
    out.append(f"Standing rulings for {name}, from chewbacca gtme. Check any recommendation or client-facing text against these; a plan that contradicts one names it and who owns changing it:\n" + "\n".join(lines))
if out:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
                                             "additionalContext": "\n\n".join(out)}}))
PY
exit 0
