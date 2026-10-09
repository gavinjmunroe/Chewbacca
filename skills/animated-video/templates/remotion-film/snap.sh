#!/bin/bash
# Render stills of the film at the given seconds and a contact sheet.
# usage: ./snap.sh <outdir> <sec> [sec...]   -> <outdir>/t<sec>.png + <outdir>/sheet.png
# Renders two stills at a time so several agents can share the machine.
set -e; cd "$(dirname "$0")"; out=$1; shift; mkdir -p "$out"
npx tsc -p .
b=$(mktemp -d)/bundle; npx remotion bundle src/index.ts --out-dir "$b" --log=error >/dev/null
printf '%s\n' "$@" | xargs -P 2 -I{} sh -c 'npx remotion still "$0" Film "$1/t{}.png" --frame=$(python3 -c "print(round({}*30))") --log=error >/dev/null' "$b" "$out"
python3 sheet.py "$out/sheet.png" $(for s in "$@"; do echo "$out/t$s.png"; done)
rm -rf "$(dirname "$b")"
echo "$out/sheet.png"
