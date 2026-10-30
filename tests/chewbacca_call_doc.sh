#!/bin/bash
# chewbacca call-doc: a call script becomes a Doc you can read mid-call.
# 2026-10-29: a Meridian doc written with a <style> block imported into Google
# Docs as one cramped black block; the inline-styled rebuild is the standard.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
ok() { echo "ok    $1"; }
no() { echo "FAIL  $1"; fail=1; }
cat > "$T/pitch.txt" <<'S'
# Meridian lock in
> Due **TONIGHT**
## Step 1. Set up
! Phone sideways.
### 1. Who (5 sec)
"I'm Caleb <b>."
- plain line
! Paste: https://docs.google.com/spreadsheets/d/X1/edit
x Checked 2.3B against Pew -> matches
x Their price vs ours -> retainer too high, pitched a test
x Warmup lead time -> 3 to 4 weeks, said so
~ Sources: Pew 2025
S
python3 "$ROOT/bin/chewbacca-call-doc" "$T/pitch.txt" --html-only >/dev/null 2>&1 && ok "html-only exits 0" || no "html-only failed"
H="$T/pitch.html"
grep -q 'class=' "$H" && no "a class attribute (Docs drops it)" || ok "no class attributes"
grep -q '<style' "$H" && no "a style block (Docs drops it)" || ok "no style block"
grep -q '<h1 style=.*>Meridian lock in</h1>' "$H" && ok "title is the h1" || no "title missing"
grep -q '<h2 style=.*>Step 1. Set up</h2>' "$H" && ok "step is an h2" || no "step not an h2"
grep -q '<h3 style=.*color:#666666.*>1. Who (5 sec)</h3>' "$H" && ok "beat is a gray h3" || no "beat not a gray h3"
grep -q 'color:#1a56db;font-weight:bold.*>Phone sideways.</p>' "$H" && ok "action is bold blue" || no "action not bold blue"
grep -q 'margin-bottom:10pt.*>&quot;I.m Caleb &lt;b&gt;.&quot;</p>\|margin-bottom:10pt.*>"I.m Caleb &lt;b&gt;."</p>' "$H" && ok "say line spaced and escaped" || no "say line wrong: $(grep Caleb "$H")"
grep -q '<b>TONIGHT</b>' "$H" && ok "**bold** renders" || no "**bold** raw"
grep -q '>plain line</p>' "$H" && ok "dash line is plain, no dash" || no "dash line wrong"
grep -q '<a href="https://docs.google.com/spreadsheets/d/X1/edit">' "$H" && ok "a URL is a clickable link (Travis sheet, 2026-10-29)" || no "URL not linked"
# Publish path, against a fake gws that logs calls and writes a 2-page PDF.
cat > "$T/gws" <<'G'
#!/bin/bash
echo "$*" >> "$LOG"
# Real gws refuses an --upload path that resolves outside its cwd, which broke
# a scratchpad script on 2026-10-29. Mirror that: a bare name in cwd only.
prev=""; for a in "$@"; do
  if [ "$prev" = "--upload" ]; then
    case "$a" in */*) echo "error[validation]: --upload '$a' resolves to outside cwd" >&2; exit 1 ;; esac
    [ -f "$a" ] || { echo "error: no $a in $(pwd)" >&2; exit 1; }
  fi; prev="$a"
done
case "$*" in
  *"files create"*) echo '{"id":"DOC123"}' ;;
  *"files export"*) printf '%%PDF-1.4 /Type /Pages /Type /Page x /Type /Page' > doc.pdf; echo '{}' ;;
  *) echo '{}' ;;
esac
G
chmod +x "$T/gws"
out=$(LOG="$T/log" CHEWBACCA_GWS="$T/gws" python3 "$ROOT/bin/chewbacca-call-doc" "$T/pitch.txt" --share --json 2>&1)
echo "$out" | grep -q '"url": "https://docs.google.com/document/d/DOC123/edit"' && ok "prints the Doc link" || no "no link: $out"
echo "$out" | grep -q '"pages": 2' && ok "counts pages, not the Pages node" || no "page count wrong: $out"
grep -q 'documents batchUpdate.*marginLeft.*43.2' "$T/log" && ok "sets 0.6in margins" || no "margins not set"
grep -q 'permissions create.*"anyone".*"writer"' "$T/log" && ok "--share makes it editable by link" || no "share missing"
grep -q 'text/html' "$T/log" && ok "uploads as HTML" || no "not uploaded as HTML"
grep -q '<h2 style=.*>What we tried to break</h2>' "$H" && ok "breaks get their own section" || no "no break section"
[ "$(grep -n 'What we tried to break' "$H" | cut -d: -f1)" -lt "$(grep -n 'Sources: Pew' "$H" | cut -d: -f1)" ] && ok "break section sits above the sources" || no "break section below sources"
grep -q '>Their price vs ours -&gt; retainer too high, pitched a test</p>' "$H" && ok "a break line renders escaped" || no "break line wrong"
# 2026-10-30 (OPTRA): a script nobody tried to break is refused.
grep -v '^x ' "$T/pitch.txt" > "$T/unbroken.txt"
python3 "$ROOT/bin/chewbacca-call-doc" "$T/unbroken.txt" --html-only >/dev/null 2>"$T/err"; rc=$?
[ "$rc" = 2 ] && ok "no break lines exits 2" || no "unbroken script exited $rc"
grep -q 'needs 3' "$T/err" && ok "refusal names the bar" || no "refusal unclear: $(cat "$T/err")"
[ -f "$T/unbroken.html" ] && no "refused script still wrote html" || ok "refused script writes nothing"
grep -v 'Warmup' "$T/pitch.txt" > "$T/two.txt"
[ "$(grep -c '^x ' "$T/two.txt")" = 2 ] || no "fixture should hold 2 breaks"
python3 "$ROOT/bin/chewbacca-call-doc" "$T/two.txt" --html-only >/dev/null 2>&1; rc=$?
[ "$rc" = 2 ] && ok "2 breaks is not enough" || no "2 breaks exited $rc"
python3 "$ROOT/bin/chewbacca-call-doc" "$T/unbroken.txt" --html-only --no-breaks "internal standup" >/dev/null 2>&1 && ok "--no-breaks with a reason passes" || no "--no-breaks refused"
python3 "$ROOT/bin/chewbacca-call-doc" "$T/nope.txt" --html-only >/dev/null 2>&1 && no "a missing script exited 0" || ok "a missing script exits 1"
# The kit guard points a classed HTML upload at call-doc and lets inline HTML through.
G="$ROOT/.claude/hooks/use-the-kit-guard.sh"
g() { jq -n --arg c "$1" '{tool_input:{command:$c}}' | HOOKD_INNER=1 bash "$G" >/dev/null 2>&1; echo $?; }
printf '<html><style>.do{color:blue}</style><p class="do">x</p></html>' > "$T/classed doc.html"
[ "$(g "gws drive files create --upload \"$T/classed doc.html\" --upload-content-type text/html")" = 2 ] && ok "a classed HTML upload is pointed at call-doc" || no "classed HTML upload not refused"
[ "$(g "gws drive files update --upload $H --upload-content-type text/html")" = 0 ] && ok "an inline-styled upload passes" || no "inline upload refused"
[ "$(g "gws drive files create --upload $T/notes.md --upload-content-type text/markdown")" = 0 ] && ok "a markdown upload passes" || no "markdown upload refused"
exit $fail
