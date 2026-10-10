#!/bin/bash
# skill-refs-check must refuse each planted class of dead reference, stay quiet
# on the shapes that only look like one, and pass on the repo's own skills.
# A checker that has never refused anything proves nothing.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL="$ROOT/bin/skill-refs-check"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }

skill() { mkdir -p "$TMP/$1/skills/$2"; cat > "$TMP/$1/skills/$2/SKILL.md"; }

# The repo itself is clean.
if python3 "$TOOL" >"$TMP/repo.out" 2>&1; then ok "every repo skill passes"
else no "every repo skill passes"; sed 's/^/          /' "$TMP/repo.out" | head -8; fi

# One fixture per failure class.
skill bad dead-path <<'EOF'
---
name: dead-path
description: plants a path that is not there
---
Read `references/missing.md` and `bin/no-such-tool` first.
EOF
skill bad dead-command <<'EOF'
---
name: dead-command
description: plants a command that is not installed
---
```bash
no-such-command --flag
```
Then run `ghost-tool list --json`, and `chewbacca frobnicate` after.
EOF
skill bad wrong-name <<'EOF'
---
name: something-else
description: name does not match the folder
---
x
EOF
skill bad no-description <<'EOF'
---
name: no-description
---
x
EOF
skill bad broken-yaml <<'EOF'
---
name: broken-yaml
description: a thing that is not code: it breaks
---
x
EOF

python3 "$TOOL" "$TMP/bad/skills" >"$TMP/bad.out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "planted findings exit 1" || no "planted findings exit 1 (got $rc)"
for needle in \
  "dead-path/SKILL.md:5: path: references/missing.md does not exist" \
  "dead-path/SKILL.md:5: path: bin/no-such-tool does not exist" \
  "dead-command/SKILL.md:6: command: no-such-command is not in bin/" \
  "dead-command/SKILL.md:8: command: ghost-tool is not in bin/" \
  "dead-command/SKILL.md:8: command: chewbacca frobnicate is not a verb" \
  "wrong-name/SKILL.md:1: frontmatter: name 'something-else' does not match directory 'wrong-name'" \
  "no-description/SKILL.md:1: frontmatter: missing required key 'description'" \
  "broken-yaml/SKILL.md:1: frontmatter: description: unquoted value contains"; do
  grep -qF -- "$needle" "$TMP/bad.out" && ok "flags: ${needle#*: }" || no "flags: $needle"
done

# Shapes that look like dead references and are not.
mkdir -p "$TMP/good/skills/clean/references"
touch "$TMP/good/skills/clean/references/real.md"
skill good clean <<'EOF'
---
name: clean
description: "every reference here resolves: on purpose"
---
Read `references/real.md`, then `bin/chewbacca`, `docs/` and `~/anything/at/all`.
Run `people-x` never; `owed --json` and `press <i> --yes` are subcommands.
Other repos are named by repo: `zeutara-gtme/scripts/clay_run.py`.
Run `chewbacca doctor`, `chewbacca welcome` and `chewbacca connect`.

```bash
claude-tab status          idle | busy | absent
sqlite3 db.sqlite \
  "select a
   from access where b"
cat <<'PY'
not-a-command here
PY
ASA="$(chewbacca where)/asa/bin/asa"
"$ASA" modules
FOO=1 git status && ls | sort -u
```

```text
whatever-this-is is prose
```
EOF
# people-x is hyphenated prose in backticks with one word, so not a command.
if python3 "$TOOL" "$TMP/good/skills" >"$TMP/good.out" 2>&1; then ok "lookalikes pass clean"
else no "lookalikes pass clean"; sed 's/^/          /' "$TMP/good.out" | head -8; fi

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
