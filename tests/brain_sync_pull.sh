#!/bin/bash
# brain-sync's push step pulls a phone session's note commits before pushing,
# and never pulls a remote commit that changes code the Mac would run.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/brain-sync.sh"
pass=0; fail=0
ok(){ printf '  \033[0;32mpass\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[0;31mfail\033[0m  %s\n' "$1"; fail=$((fail+1)); }
# The push step is a shell string inside the hook's python; run it on its own.
SN="$(printf 'lock="$0/.git/chewbacca-push.lock"\n'; sed -n '/^if \[ -d "\$lock" \]/,/^rm -rf "\$lock"/p' "$HOOK" | sed "s/''', repo\],//")"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
g(){ git -C "$1" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "${@:2}"; }
git init -q --bare -b main "$T/r.git"
git clone -q "$T/r.git" "$T/mac" 2>/dev/null; g "$T/mac" checkout -q -b main
echo a > "$T/mac/n.md"; g "$T/mac" add n.md; g "$T/mac" commit -qm seed; g "$T/mac" push -q -u origin main
git clone -q "$T/r.git" "$T/phone"
echo evil > "$T/phone/x.sh"; g "$T/phone" add x.sh; g "$T/phone" commit -qm evil; g "$T/phone" push -q
echo b > "$T/mac/m.md"; g "$T/mac" add m.md; g "$T/mac" commit -qm mac
sh -c "$SN" "$T/mac"
[ ! -e "$T/mac/x.sh" ] && ok "a remote commit adding a script is not pulled" || no "remote script landed on the Mac"
g "$T/phone" reset -q --hard HEAD~1
echo note > "$T/phone/p.md"; g "$T/phone" add p.md; g "$T/phone" commit -qm note; g "$T/phone" push -qf
sh -c "$SN" "$T/mac"
[ -e "$T/mac/p.md" ] && ok "a phone note commit is pulled" || no "phone note never reached the Mac"
[ "$(g "$T/mac" rev-list --count origin/main..HEAD)" = 0 ] && ok "the Mac commit is pushed after the rebase" || no "Mac commit still local"
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
