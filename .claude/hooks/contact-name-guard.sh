#!/bin/bash
# hookd skips this guard for a Bash call that never touches contacts.
# gate: contacts
[ -z "${HOOKD_INNER:-}" ] && [ -x "$HOME/.local/bin/hookd" ] && exec "$HOME/.local/bin/hookd" gate "$0" "$@"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh" 2>/dev/null || true
type hook_init >/dev/null 2>&1 && hook_init contact-name-guard.sh 5
# PreToolUse: a contact saved with a company keeps the real last name, then the
# company, in the name: "Noah Kruse Firebox". Caleb, 2026-11-05, set this as the
# standard. Until now it was only a line in skills/people/SKILL.md, and nothing
# refused a wrong save.
#
# It reads only `mac contacts add|edit` with both --name and --org. Without --org
# there's no company to check, so a family member saves fine. It can't tell a real
# last name from a fake one, only that a word sits between first name and company.
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r 'select(.tool_name == "Bash") | .tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
GUARD_CMD="$cmd" python3 -I - <<'PY'
import os, shlex, sys

try:
    lex = shlex.shlex(os.environ["GUARD_CMD"], posix=True, punctuation_chars=";&|")
    lex.whitespace_split = True
    tokens = list(lex)
except ValueError:
    raise SystemExit(0)  # unparsable shell isn't this guard's call

commands, cur = [], []
for t in tokens:
    if t and set(t) <= set(";&|"):
        commands.append(cur)
        cur = []
    else:
        cur.append(t)
commands.append(cur)


def value(args, flag):
    for i, a in enumerate(args):
        if a == flag and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(flag + "="):
            return a.split("=", 1)[1]
    return None


for args in commands:
    if len(args) < 3 or os.path.basename(args[0]) != "mac" or args[1] != "contacts" or args[2] not in ("add", "edit"):
        continue
    name, org = value(args, "--name"), value(args, "--org")
    if not name or not org:
        continue
    words, company = name.split(), org.split()
    ends = [w.lower() for w in words[-len(company):]] == [w.lower() for w in company]
    if not ends or len(words) - len(company) < 2:
        print(f'contact-name-guard: "{name}" with org "{org}" breaks the contact standard. The name is '
              'first name, real last name, then the company, like "Noah Kruse Firebox". '
              "Look up the real last name before saving.", file=sys.stderr)
        raise SystemExit(2)
PY
