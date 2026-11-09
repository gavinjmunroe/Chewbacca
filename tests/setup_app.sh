#!/usr/bin/env bash
# The double-click Chewbacca Setup app installs with no Terminal and no password.
#
# Written 2026-10-13 for the person with a Mac and a Claude subscription who has
# never opened Terminal. Before this, every door into Chewbacca was a command
# pasted into Terminal, the install line 404s while the repo is private, a
# fast install still went to Homebrew (the password prompt), and the last
# screen said "open Terminal and type claude" to someone who uses the Claude
# app. This builds the app from a scratch repo, double-clicks it headless in a
# scratch home, and checks each of those.
set -uo pipefail
ROOT="${1:?path to repo root}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

# A tiny kit with the real start.sh, installer and builder, and a stand-in
# setup.sh and bootstrap.sh that only record that they ran.
K="$T/kit"
mkdir -p "$K/tools/setup_app" "$K/bin"
cp "$ROOT/start.sh" "$K/start.sh"
cp "$ROOT/tools/setup_app/install.sh" "$K/tools/setup_app/install.sh"
cp "$ROOT/tools/build_setup_app.sh" "$K/tools/build_setup_app.sh"
printf '#!/bin/bash\necho "$@" > "$HOME/setup-args"\n' > "$K/setup.sh"
printf '#!/bin/bash\ntouch "$HOME/bootstrap-ran"\n' > "$K/bin/bootstrap.sh"
for f in uninstall.sh doctor.sh; do printf '#!/bin/bash\n' > "$K/$f"; done
echo 9.9.9 > "$K/VERSION"
chmod +x "$K"/*.sh "$K"/bin/* "$K"/tools/*.sh "$K"/tools/setup_app/*.sh
(cd "$K" && find . -type f ! -path './.git/*' ! -name SHA256SUMS.txt | sed 's|^\./||' | sort | while read -r f; do
   shasum -a 256 "$f" | sed "s|  .*|  $f|"; done > SHA256SUMS.txt)
git -C "$K" init -q && git -C "$K" add -A && \
  git -C "$K" -c user.name=t -c user.email=t@t commit -qm kit || fail "could not make the scratch kit"

out="$(bash "$K/tools/build_setup_app.sh" --out "$T/dist")" || fail "build failed: $out"
APP="$T/dist/Chewbacca Setup.app"
[ -x "$APP/Contents/MacOS/Chewbacca Setup" ] || fail "no app executable"
[ -f "$T/dist/Chewbacca Setup.zip" ] || fail "no zip to hand someone"
/usr/bin/plutil -lint "$APP/Contents/Info.plist" >/dev/null || fail "Info.plist does not parse"

# xcode-select stands in for Apple's developer tools: present or missing.
mkdir -p "$T/clt-yes" "$T/clt-no"
printf '#!/bin/sh\n[ "$1" = -p ] && echo /Library/Developer/CommandLineTools\nexit 0\n' > "$T/clt-yes/xcode-select"
printf '#!/bin/sh\nexit 2\n' > "$T/clt-no/xcode-select"
chmod +x "$T"/clt-*/xcode-select
mkdir -p "$T/apps-claude/Claude.app" "$T/apps-none"

click() {  # home, apps dir, clt dir
  mkdir -p "$1"
  env -i HOME="$1" PATH="$3:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$T" \
    CHEWBACCA_APPLICATIONS_DIR="$2" CHEWBACCA_SETUP_HEADLESS=1 CHEWBACCA_SETUP_CLT_WAIT=5 \
    CHEWBACCA_NO_SEND=1 "$APP/Contents/MacOS/Chewbacca Setup" </dev/null 2>&1
}

# 1. The Claude app is here: install, agents only, no Homebrew, handed to the app.
H="$T/home-claude"
shown="$(click "$H" "$T/apps-claude" "$T/clt-yes")"; rc=$?
[ "$rc" -eq 0 ] || fail "setup with the Claude app exited $rc: $shown $(cat "$H/Library/Logs/Chewbacca/setup.log" 2>/dev/null)"
[ -f "$H/.chewbacca/start.sh" ] || fail "the kit was not unpacked into ~/.chewbacca"
[ "$(cat "$H/setup-args" 2>/dev/null)" = "--every-agent" ] || fail "setup.sh was not run as --every-agent: $(cat "$H/setup-args" 2>/dev/null)"
[ -e "$H/bootstrap-ran" ] && fail "the agents-only install still ran bootstrap, which is where Homebrew asks for a password"
log="$(cat "$H/Library/Logs/Chewbacca/setup.log")"
echo "$log" | grep -q "files match their checksums" || fail "the payload was not checked against SHA256SUMS"
echo "$log" | grep -q "open the Claude app, click" || fail "the last screen does not send a Claude app owner to the app"
echo "$log" | grep -q "open Terminal" && fail "the last screen still says open Terminal to someone with the Claude app"
echo "$shown" | grep -q "OPEN: -a $T/apps-claude/Claude.app" || fail "did not open the Claude app at the end: $shown"
echo "$shown" | grep -q "click Code" || fail "the done dialog does not say where to click"

# 2. No assistant app: nothing installed, taken to the download page.
H="$T/home-none"
shown="$(click "$H" "$T/apps-none" "$T/clt-yes")"; rc=$?
[ "$rc" -eq 3 ] || fail "with no Claude app it exited $rc, not 3"
[ -e "$H/.chewbacca" ] && fail "installed with no assistant app to live in"
echo "$shown" | grep -q "OPEN: https://claude.com/download" || fail "did not take them to the Claude download: $shown"

# 3. Apple's tools never arrive: a plain stop, nothing half-installed.
H="$T/home-noclt"
shown="$(click "$H" "$T/apps-claude" "$T/clt-no")"; rc=$?
[ "$rc" -eq 4 ] || fail "with no developer tools it exited $rc, not 4"
[ -e "$H/.chewbacca" ] && fail "installed without Apple's developer tools"
echo "$shown" | grep -q "click Install" || fail "never said what Apple's window is before it appears"

# 4. A payload that does not match its checksums is refused and logged.
cp -R "$APP" "$T/bad.app"
mkdir -p "$T/x" && tar -xzf "$T/bad.app/Contents/Resources/chewbacca.tar.gz" -C "$T/x"
echo tampered >> "$T/x/chewbacca/doctor.sh"
tar -czf "$T/bad.app/Contents/Resources/chewbacca.tar.gz" -C "$T/x" chewbacca
H="$T/home-bad"; mkdir -p "$H"
shown="$(env -i HOME="$H" PATH="$T/clt-yes:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$T" \
  CHEWBACCA_APPLICATIONS_DIR="$T/apps-claude" CHEWBACCA_SETUP_HEADLESS=1 \
  "$T/bad.app/Contents/MacOS/Chewbacca Setup" </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 1 ] || fail "a tampered payload exited $rc, not 1"
grep -q "do not match the committed checksums" "$H/Library/Logs/Chewbacca/setup.log" || fail "the tamper was not named in the log"
[ -e "$H/setup-args" ] && fail "setup ran from a tampered payload"

echo "setup_app: 4 cases ok"
