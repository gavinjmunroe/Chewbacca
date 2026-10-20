#!/usr/bin/env bash
# pre-push compiles an extensionless file only when its shebang names python
# or a shell. On 2026-10-19 a Dockerfile opening "FROM python:3.11-slim" was
# compiled as Python and refused the Togari land three times. Hermetic: a temp
# repo with the real hook and stub tools.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home" GIT_CONFIG_NOSYSTEM=1
mkdir -p "$HOME"
git config --global user.name t; git config --global user.email t@t
git config --global init.defaultBranch main
fail() { echo "FAIL: $*"; exit 1; }

git init -q "$T/repo"; cd "$T/repo" || exit 1
mkdir -p .githooks tools tests
cp "$ROOT/.githooks/pre-push" "$ROOT/.githooks/scrub-git-env.sh" .githooks/
for t in tools/counts.py tools/checksums.py tools/decision_evals.py; do echo 'import sys; sys.exit(0)' > "$t"; done
printf '#!/bin/sh\nexit 0\n' > tests/undefined_names.sh
echo seed > seed.txt
git add -A; git commit -qm seed; git update-ref refs/remotes/origin/main HEAD
base=$(git rev-parse HEAD)

push() {
  git add -A; git commit -qm change
  echo "refs/heads/main $(git rev-parse HEAD) refs/heads/main $base" | bash .githooks/pre-push 2>&1
}

printf 'FROM python:3.11-slim\nRUN pip install fastapi\n' > Dockerfile
out=$(push) || fail "a Dockerfile naming python was refused: $out"
case "$out" in *"compile Dockerfile"*) fail "Dockerfile was compiled as Python: $out" ;; esac

printf '#!/usr/bin/env python3\ndef broken(:\n' > script
out=$(push) && fail "a python shebang script with a syntax error passed: $out"
case "$out" in *"FAIL  compile script"*) ;; *) fail "shebang script not compiled: $out" ;; esac

echo "ok: pre-push trusts only a shebang for extensionless files"
