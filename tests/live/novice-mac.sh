#!/usr/bin/env bash
# Live: the README's one-line install on a Mac nobody has touched, timed, with every human touch logged
#
# docs/ONBOARDING.md sets the bar: a fresh Mac goes from the README to a first
# real answer with zero unexplained dialogs. tests/bare_machine.sh gets "as
# close to a factory Mac as this can get without a factory Mac". This is the
# factory Mac: a vanilla macOS VM (no Xcode tools, no Homebrew, no Claude),
# cloned fresh for every run and deleted after it.
#
# The run is driven through expect so every moment a real person would have
# to act is answered AND written down: a password prompt, a y/n question, a
# stall where the script waits on a dialog. Those are the receipt. A novice
# install is judged by its human touches and its minutes, not by its exit code
# alone.
#
# Takes 10 to 40 minutes and a 25 GB base image, so it never runs unasked:
#
#   tart clone ghcr.io/cirruslabs/macos-sequoia-vanilla:latest novice-mac   once
#   CHEWBACCA_LIVE_VM=1 chewbacca live novice-mac
#
# Knobs: NOVICE_BASE (local base VM, default novice-mac), NOVICE_ARGS (passed
# to start.sh, e.g. --fast), NOVICE_URL (the start.sh to fetch, default the
# README's), NOVICE_RECEIPT (where the receipt goes).
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

if [ -z "${CHEWBACCA_LIVE_VM:-}" ]; then
  printf "  ${YEL}SKIP${NC}  boots a macOS VM for up to 40 minutes; set CHEWBACCA_LIVE_VM=1 to run it\n"
  printf "\nSKIPPED  %s\n" "$CHECK_NAME"; exit 77
fi
need tart "brew's cirruslabs tap, or the notarized release at github.com/cirruslabs/tart/releases"
need expect "ships with macOS at /usr/bin/expect"

BASE="${NOVICE_BASE:-novice-mac}"
if ! tart list --quiet 2>/dev/null | grep -qx "$BASE"; then
  printf "  ${YEL}SKIP${NC}  no base VM named %s. Pull it once: tart clone ghcr.io/cirruslabs/macos-sequoia-vanilla:latest %s\n" "$BASE" "$BASE"
  printf "\nSKIPPED  %s\n" "$CHECK_NAME"; exit 77
fi

URL="${NOVICE_URL:-https://raw.githubusercontent.com/calebnewtonusc/Chewbacca/main/start.sh}"
ARGS="${NOVICE_ARGS:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
VM="novice-run-$STAMP"
RECEIPT="${NOVICE_RECEIPT:-$HOME/.chewbacca/receipts/novice-mac-$STAMP.md}"
mkdir -p "$(dirname "$RECEIPT")"
EVENTS="$LIVE_SCRATCH/events.log"     # epoch|kind|text, written by expect
TRANSCRIPT="$LIVE_SCRATCH/transcript.log"
KEY="$LIVE_SCRATCH/id_ed25519"

# The VM is this check's own clone. The base is never booted, so it stays
# factory-clean for the next run.
cleanup_vm() {
  tart stop "$VM" >/dev/null 2>&1
  tart delete "$VM" >/dev/null 2>&1
  rm -rf "$LIVE_SCRATCH"
}
trap cleanup_vm EXIT

tart clone "$BASE" "$VM" || { echo "  FAIL  could not clone $BASE"; exit 1; }
tart run --no-graphics "$VM" >/dev/null 2>&1 &
IP="$(tart ip "$VM" --wait 180 2>/dev/null)"
ok "the VM booted and has an address" test -n "$IP"
[ -n "$IP" ] || finish

# The vanilla images log in as admin/admin and have no guest agent, so the
# first SSH call uses the password once (through SSH_ASKPASS, no sshpass
# install) to plant a throwaway key. The password stays "admin" because that
# is what the person types at the sudo prompts below, the same as on a real Mac.
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10)
ssh-keygen -q -t ed25519 -N "" -f "$KEY"
ASK="$LIVE_SCRATCH/askpass"; printf '#!/bin/sh\necho admin\n' >"$ASK"; chmod +x "$ASK"
for _ in $(seq 1 30); do
  SSH_ASKPASS="$ASK" SSH_ASKPASS_REQUIRE=force ssh "${SSH_OPTS[@]}" "admin@$IP" \
    "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys" <"$KEY.pub" 2>/dev/null && break
  sleep 5
done
vm() { ssh "${SSH_OPTS[@]}" -i "$KEY" "admin@$IP" "$@"; }
ok "ssh into the VM" vm true

# What the novice starts with, recorded so the receipt says what "clean" meant.
VM_OS="$(vm sw_vers -productVersion 2>/dev/null)"
HAS_CLT="$(vm 'xcode-select -p >/dev/null 2>&1 && echo yes || echo no')"
HAS_BREW="$(vm 'test -x /opt/homebrew/bin/brew && echo yes || echo no')"

# Apple's developer-tools dialog has an Install button no SSH session can
# press. A person presses it; here softwareupdate does the same install from a
# second session, and the receipt records it as a human touch.
cat >"$LIVE_SCRATCH/clt.sh" <<'CLT'
touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
P="$(softwareupdate -l 2>/dev/null | grep -E '\* Label: Command Line Tools' | tail -1 | sed 's/^.*Label: //')"
[ -n "$P" ] && echo admin | sudo -S softwareupdate -i "$P" >/dev/null 2>&1
rm -f /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
CLT
scp "${SSH_OPTS[@]}" -i "$KEY" -q "$LIVE_SCRATCH/clt.sh" "admin@$IP:/tmp/clt.sh"

START=$(date +%s)
export EVENTS TRANSCRIPT KEY IP URL ARGS
# 60 s of silence counts as a stall: start.sh prints a step header, a spinner
# or a download line far more often than that on every path read on
# 2026-10-05, so silence that long means it is waiting on something.
expect -f - <<'EXP'
set timeout 60
log_user 0
log_file -a $env(TRANSCRIPT)
proc ev {kind text} {
  set f [open $::env(EVENTS) a]
  puts $f "[clock seconds]|$kind|[string map {"\n" " " "\r" ""} $text]"
  close $f
}
set ssh_opts {-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR}
spawn -noecho ssh {*}$ssh_opts -tt -i $env(KEY) admin@$env(IP) "curl -fsSL $env(URL) | bash -s -- $env(ARGS); echo NOVICE_EXIT=\$?"
set clt_started 0
set last ""
expect {
  -re {\[([0-9]+)/([0-9]+)\] ([^\r\n]+)} {
    ev step $expect_out(0,string); set last $expect_out(0,string); exp_continue
  }
  -re {(?i)password[^\r\n]*:\s*$} {
    ev human "typed the Mac password at: $last"; send "admin\r"; exp_continue
  }
  -re {\[y/N\]|\[Y/n\]|\(y/n\)|\(yes/no\)} {
    ev human "answered a yes/no question after: $last"; send "y\r"; exp_continue
  }
  -re {(?i)press (return|enter)} {
    ev human "pressed Return after: $last"; send "\r"; exp_continue
  }
  -re {NOVICE_EXIT=([0-9]+)} { ev exit $expect_out(1,string) }
  timeout {
    ev stall "silent 60 s after: $last"
    if {!$clt_started && [string match -nocase "*developer tools*" $last]} {
      set clt_started 1
      ev human "clicked Install on Apple's developer tools dialog"
      exec ssh {*}$ssh_opts -i $env(KEY) admin@$env(IP) "sh /tmp/clt.sh" &
    }
    exp_continue
  }
  eof { ev eof "" }
}
EXP
END=$(date +%s)
MINUTES=$(awk -v s="$((END - START))" 'BEGIN{printf "%.1f", s/60}')

# The exit code is whatever start.sh's own shell printed after it, never
# inferred. A session that died before printing one has no code at all.
exit_from() { awk -F'|' '$2=="exit"{print $3}' "$1" 2>/dev/null | tail -1; }
EXIT_CODE="$(exit_from "$EVENTS")"
HUMAN=$(grep -c '|human|' "$EVENTS" 2>/dev/null); HUMAN=${HUMAN:-0}
STALLS=$(grep -c '|stall|' "$EVENTS" 2>/dev/null); STALLS=${STALLS:-0}

{
  echo "# Novice install receipt, $(date '+%Y-%m-%d %H:%M')"
  echo
  echo "- Command: \`curl -fsSL $URL | bash -s -- $ARGS\`"
  echo "- Machine: fresh clone of \`$BASE\`, macOS $VM_OS, developer tools: $HAS_CLT, Homebrew: $HAS_BREW"
  echo "- Wall time: $MINUTES minutes"
  echo "- Exit code: ${EXIT_CODE:-none, the session ended without one}"
  echo "- Human touches: $HUMAN"
  echo "- Stalls of 60 s or more: $STALLS"
  echo
  echo "## Timeline"
  echo
  echo "| at (min) | kind | what |"
  echo "| --- | --- | --- |"
  awk -F'|' -v s="$START" '{printf "| %.1f | %s | %s |\n", ($1-s)/60, $2, $3}' "$EVENTS"
  echo
  echo "## Last 30 lines of output"
  echo
  echo '```'
  tr -d '\r' <"$TRANSCRIPT" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tail -30
  echo '```'
} >"$RECEIPT"

ok "start.sh finished and exited 0" test "${EXIT_CODE:-none}" = 0
printf '%s|eof|\n' "$START" >"$LIVE_SCRATCH/died.log"
mutant "a session that died without printing a code is not exit 0" \
  test "$(exit_from "$LIVE_SCRATCH/died.log")" = 0
ok "the receipt counts the human touches" grep -q "^- Human touches: " "$RECEIPT"
mutant "a receipt with no count does not pass for one" grep -q "^- Human touches: " "$LIVE_SCRATCH/died.log"
# ONBOARDING.md's bar is zero unexplained dialogs. The count is reported, not
# failed on, until the first baseline exists: a target set before anyone has
# measured is a guess.
printf "  ${DIM}info${NC}  %s min, %s human touches, %s stalls\n" "$MINUTES" "$HUMAN" "$STALLS"
printf "  ${DIM}info${NC}  receipt: %s\n" "$RECEIPT"
finish
