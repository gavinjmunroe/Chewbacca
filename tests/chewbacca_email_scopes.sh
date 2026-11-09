#!/bin/bash
# chewbacca email's Google sign-in must ask for calendar WRITE and drop gws's
# token cache after login. With calendar.readonly every event add 403'd, and
# the cached token kept the old scopes after a fresh login (2026-10-09).
# It must also ask for Docs and Gmail compose, and land them in the main gws
# config: with read-only Drive the Doc surface refused every edit (2026-10-10),
# and a per-inbox copy of the main account would hold the new scopes where
# `chewbacca google`, the Doc surface and meeting follow-ups never look.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
f="$ROOT/bin/chewbacca-email"
fail=0
scopes=$(grep -o '^SCOPES="[^"]*"' "$f")
# Full account access (Caleb, 2026-10-11: "CHEWBS SHOULD NEVER BE READ ONLY").
# Every narrower scope has already cost a 403: calendar.readonly, drive.readonly.
for need in 'mail.google.com/' 'auth/calendar' 'auth/drive' 'auth/documents' 'auth/spreadsheets' 'auth/presentations' 'auth/contacts' 'auth/tasks'; do
  printf '%s' "$scopes" | grep -q "$need[,\"]" || { echo "FAIL: sign-in scopes lack full $need"; fail=1; }
done
printf '%s' "$scopes" | grep -q 'readonly' && { echo "FAIL: a read-only scope crept back in: $scopes"; fail=1; }
# drive.file sees only files this app opened, so Drive search by name breaks.
printf '%s' "$scopes" | grep -q 'drive.file' && { echo "FAIL: drive.file would blind chewbacca google find"; fail=1; }
grep -q 'rm -f "$cfg/token_cache.json"' "$f" || { echo "FAIL: login no longer clears the stale token cache"; fail=1; }
grep -q 'chewbacca-email-add-$addr.log' "$f" || { echo "FAIL: email add shares one log across inboxes, so parallel adds open each other's consent URL"; fail=1; }
grep -q 'login_hint' "$f" || { echo "FAIL: login no longer pins the account with login_hint"; fail=1; }
grep -q 'cfg="$DEFAULT_CFG"' "$f" || { echo "FAIL: re-consent of the main account no longer targets ~/.config/gws"; fail=1; }
# The readers call plain gws, so they read ~/.config/gws. Pointing one at a
# per-inbox config would hide the scopes the main re-consent just added.
for r in bin/chewbacca-google bin/lib/docs_surface.py bin/lib/meeting_actions.py; do
  grep -q 'GOOGLE_WORKSPACE_CLI_CONFIG_DIR' "$ROOT/$r" && { echo "FAIL: $r no longer reads the main gws config"; fail=1; }
done

# Behaviour: with a fake gws whose main config is signed in as the address,
# `add` must log in against the main config, not a per-inbox copy.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home/.config/gws" "$tmp/bin" "$tmp/home/Library/Logs"
echo '{"installed":{"project_id":"p"}}' >"$tmp/home/.config/gws/client_secret.json"
echo old >"$tmp/home/.config/gws/credentials.enc"
cat >"$tmp/bin/gws" <<'EOF'
#!/bin/bash
echo "$GOOGLE_WORKSPACE_CLI_CONFIG_DIR $*" >>"$FAKE_GWS_LOG"
case "$1 $2" in
  "auth status") echo '{"user":"me@example.com"}' ;;
  "auth login") echo "https://accounts.google.com/o/oauth2/auth?x=1"; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/gws"
printf '#!/bin/bash\nexit 0\n' >"$tmp/bin/open"; chmod +x "$tmp/bin/open"
CHEWBACCA_GWS="$tmp/bin/gws" HOME="$tmp/home" CHEWBACCA_EMAIL_HOME="$tmp/home/.chewbacca/email" FAKE_GWS_LOG="$tmp/gws.log" \
  PATH="$tmp/bin:$PATH" bash "$f" add me@example.com >/dev/null 2>&1
grep -q "^$tmp/home/.config/gws auth login" "$tmp/gws.log" ||
  { echo "FAIL: main-account re-consent did not log in against the main config"; cat "$tmp/gws.log"; fail=1; }
[ -d "$tmp/home/.chewbacca/email/me@example.com" ] && { echo "FAIL: main account got a per-inbox copy"; fail=1; }
[ "$(cat "$tmp/home/.config/gws/credentials.enc")" = old ] || { echo "FAIL: failed re-consent did not restore credentials"; fail=1; }
[ -e "$tmp/home/.config/gws/credentials.enc.before-reconsent" ] && { echo "FAIL: failed re-consent left its backup behind"; fail=1; }

# Behaviour: a main config whose token was revoked reports no user and no
# profile. Adding any address must repair the main config, not make a copy.
: >"$tmp/gws.log"; rm -rf "$tmp/home/.chewbacca"
cat >"$tmp/bin/gws" <<'EOF2'
#!/bin/bash
echo "$GOOGLE_WORKSPACE_CLI_CONFIG_DIR $*" >>"$FAKE_GWS_LOG"
case "$1 $2" in
  "auth status") echo '{"auth_method":"oauth2"}' ;;
  "gmail users") exit 1 ;;
  "auth login") echo "https://accounts.google.com/o/oauth2/auth?x=1"; exit 1 ;;
esac
EOF2
CHEWBACCA_GWS="$tmp/bin/gws" HOME="$tmp/home" CHEWBACCA_EMAIL_HOME="$tmp/home/.chewbacca/email" FAKE_GWS_LOG="$tmp/gws.log" \
  PATH="$tmp/bin:$PATH" bash "$f" add other@example.com >/dev/null 2>&1
grep -q "^$tmp/home/.config/gws auth login" "$tmp/gws.log" ||
  { echo "FAIL: a dead main sign-in was not re-consented"; cat "$tmp/gws.log"; fail=1; }
[ -d "$tmp/home/.chewbacca/email/other@example.com" ] && { echo "FAIL: dead main left the add in a per-inbox copy"; fail=1; }

# Behaviour, fresh Mac (Gavin's, 2026-11-09): gws 0.22.5 can't create the OAuth
# client. With a Desktop client JSON in Downloads, add adopts it and signs the
# never-signed-in main config in. Without one, it names the console steps for the
# project gws set up and never starts a login.
fresh="$tmp/fresh"; mkdir -p "$fresh/Downloads" "$fresh/Library/Logs"
printf '#!/bin/bash\n[ "$*" = "config get-value account" ] && echo owner@example.com\nexit 0\n' >"$tmp/bin/gcloud"; chmod +x "$tmp/bin/gcloud"
cat >"$tmp/bin/gws" <<'EOF3'
#!/bin/bash
echo "$GOOGLE_WORKSPACE_CLI_CONFIG_DIR $*" >>"$FAKE_GWS_LOG"
case "$1 $2" in
  "auth setup") echo "https://console.cloud.google.com/apis/credentials/consent?project=proj-x"; exit 3 ;;
  "auth status") echo '{}' ;;
  "gmail users") exit 1 ;;
  "auth login") echo "https://accounts.google.com/o/oauth2/auth?x=1"; exit 1 ;;
esac
EOF3
: >"$tmp/gws.log"
out=$(CHEWBACCA_GWS="$tmp/bin/gws" CHEWBACCA_GCLOUD="$tmp/bin/gcloud" HOME="$fresh" CHEWBACCA_EMAIL_HOME="$fresh/.chewbacca/email" FAKE_GWS_LOG="$tmp/gws.log" \
  PATH="$tmp/bin:$PATH" bash "$f" add new@example.com 2>&1)
printf '%s' "$out" | grep -q 'Desktop app' || { echo "FAIL: a fresh Mac with no client JSON got no console steps: $out"; fail=1; }
printf '%s' "$out" | grep -q 'project=proj-x' || { echo "FAIL: the console steps don't name the project gws set up: $out"; fail=1; }
printf '%s' "$out" | grep -q 'authuser=owner@example.com' || { echo "FAIL: the console link doesn't open as the account that owns the project: $out"; fail=1; }
grep -q 'auth login' "$tmp/gws.log" && { echo "FAIL: a login started with no OAuth client"; fail=1; }
echo '{"installed":{"client_id":"1-abc.apps.googleusercontent.com","project_id":"proj-x"}}' >"$fresh/Downloads/client_secret_1-abc.apps.googleusercontent.com.json"
: >"$tmp/gws.log"
CHEWBACCA_GWS="$tmp/bin/gws" HOME="$fresh" CHEWBACCA_EMAIL_HOME="$fresh/.chewbacca/email" FAKE_GWS_LOG="$tmp/gws.log" \
  PATH="$tmp/bin:$PATH" bash "$f" add new@example.com >/dev/null 2>&1
grep -q '1-abc' "$fresh/.config/gws/client_secret.json" 2>/dev/null || { echo "FAIL: the Downloads client JSON was not adopted"; fail=1; }
grep -q 'auth setup' "$tmp/gws.log" && { echo "FAIL: setup ran again with a client JSON in Downloads"; fail=1; }
grep -q "^$fresh/.config/gws auth login" "$tmp/gws.log" || { echo "FAIL: the first add didn't sign in the main config"; cat "$tmp/gws.log"; fail=1; }

# The consent tab opens in the background, never in front of him (2026-10-22).
grep -q 'open -g "$url' "$f" || { echo "FAIL: the consent tab no longer opens in the background"; fail=1; }

# Behaviour: chewbacca google on a revoked login renews it once and retries.
# The app sits in Google's Testing status, so refresh tokens die every 7 days
# (main login Oct 11, dead Oct 18, noticed Oct 21).
g="${GOOGLE_CLI:-$ROOT/bin/chewbacca-google}"
mkdir -p "$tmp/heal/email"; echo me@example.com >"$tmp/heal/email/main"
cat >"$tmp/bin/gws2" <<'EOF2'
#!/bin/bash
if [ -f "$HEAL_MARK" ]; then echo '{"files":[]}'; exit 0; fi
echo "Authentication failed: invalid_grant: Token has been expired or revoked." >&2; exit 1
EOF2
cat >"$tmp/bin/fakechewb" <<'EOF2'
#!/bin/bash
[ "$1 $2 $3" = "email add me@example.com" ] && touch "$HEAL_MARK"
EOF2
chmod +x "$tmp/bin/gws2" "$tmp/bin/fakechewb"
out=$(CHEWBACCA_GWS="$tmp/bin/gws2" CHEWBACCA_BIN="$tmp/bin/fakechewb" CHEWBACCA_EMAIL_HOME="$tmp/heal/email" \
  HEAL_MARK="$tmp/heal/mark" python3 "$g" recent 3 2>&1); rc=$?
[ -f "$tmp/heal/mark" ] || { echo "FAIL: a revoked login did not trigger email add for the main address"; fail=1; }
[ $rc -eq 0 ] || { echo "FAIL: chewbacca google did not retry after renewing: $out"; fail=1; }
rm -f "$tmp/heal/mark"
printf '#!/bin/bash\nexit 1\n' >"$tmp/bin/fakechewb"
out=$(CHEWBACCA_GWS="$tmp/bin/gws2" CHEWBACCA_BIN="$tmp/bin/fakechewb" CHEWBACCA_EMAIL_HOME="$tmp/heal/email" \
  HEAL_MARK="$tmp/heal/mark" python3 "$g" recent 3 2>&1); rc=$?
{ [ $rc -ne 0 ] && printf '%s' "$out" | grep -q invalid_grant; } || { echo "FAIL: a failed renewal must exit with the real error"; fail=1; }

# A Workspace account with a valid token was refused every Gmail call until it
# got serviceUsageConsumer on the sign-in app's project (2026-11-02). `add`
# grants it itself, so a teammate never has to open the Cloud console.
grep -q 'grant_project_use "$cfg" "$addr"' "$f" || { echo "FAIL: email add no longer grants project use after login"; fail=1; }
grep -q 'roles/serviceusage.serviceUsageConsumer' "$f" || { echo "FAIL: the project-use grant names the wrong role"; fail=1; }
grep -qF '[ "$(status_user "$cfg")" = ' "$f" || { echo "FAIL: the project-use grant no longer checks the token belongs to the address"; fail=1; }

[ $fail -eq 0 ] && echo "ok: chewbacca email scopes"
exit $fail
