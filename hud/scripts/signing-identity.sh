#!/usr/bin/env bash
# Make a signing identity that stays put, so macOS permissions survive a rebuild.
#
# Ad-hoc signing has one cost and this script is how you stop paying it. macOS
# does not store "Kyber may use Accessibility"; it stores a code requirement,
# and an ad-hoc signature with no team identifier gives it nothing to name
# except the binary's own hash. Every rebuild is a new hash. The row keeps
# saying allowed, the switch in System Settings keeps reading as on, and the
# app is refused: on 2026-09-21 the grant pinned
# 2efeddb7a49900f9f1d0d2a27e1ea2298b806558 at 05:13:59 and the bundle rebuilt
# at 13:40:12 as a4246cb7228c1b8662ccd2972f304ce75777334b, so every click of
# the dictation bubble (since replaced by
# Control-dictation) reopened a dialogue asking for a permission that had
# already been given.
#
# With a certificate the requirement names the certificate and the bundle
# identifier instead, and both outlive the build. The certificate is
# self-signed and local: it authorises nothing off this Mac, it is not a
# Developer ID, and it does not let the app be distributed.
#
# Run once. It needs an administrator password for one step, because trusting
# a certificate for code signing writes to the system keychain and only a
# person can authorise that.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(cd .. && pwd)"
NAME="Chewbacca Local Signing"

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; then
  echo "Identity \"$NAME\" is already in the keychain."
else
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT

  # Imported but not yet trusted: a run that stopped at the password last
  # time. Importing again would leave two certificates of the same name, and
  # codesign refuses an ambiguous identity, so the one already there is used.
  if security find-certificate -c "$NAME" >/dev/null 2>&1; then
    echo "The certificate is already in your keychain; it only needs trusting."
    security find-certificate -c "$NAME" -p > "$WORK/cert.pem"
  else
  # 1.2.840.113635.100.6.1.13 is Apple's code-signing extension. Without it
  # the certificate is a certificate and not an identity `codesign` will use.
  cat > "$WORK/cert.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = Chewbacca Local Signing
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
1.2.840.113635.100.6.1.13 = critical,DER:05:00
EOF

  echo "Making the certificate..."
  openssl req -x509 -newkey rsa:2048 -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
    -days 7300 -nodes -config "$WORK/cert.cnf" >/dev/null 2>&1
  # OpenSSL 3 (Homebrew's) writes a PKCS12 with an HMAC-SHA256 MAC that
  # macOS `security import` cannot verify: on 2026-10-03 it failed with "MAC
  # verification failed during PKCS12 import (wrong password?)", and the same
  # file built with -legacy imported. LibreSSL (/usr/bin/openssl) has no
  # -legacy flag and already writes the old format. The password only
  # protects the file between these two commands; an empty one is what
  # macOS's importer handles worst.
  LEGACY=""
  if openssl pkcs12 -help 2>&1 | grep -q -- "-legacy"; then LEGACY="-legacy"; fi
  TRANSFER="chewbacca-$$"
  openssl pkcs12 -export $LEGACY -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
    -out "$WORK/id.p12" -passout "pass:$TRANSFER" -name "$NAME" >/dev/null 2>&1

  # Only codesign is given the key. macOS may still ask once, the first time it
  # signs, whether codesign may use it; "Always Allow" ends that for good.
  echo "Putting it in your login keychain..."
  security import "$WORK/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" \
    -P "$TRANSFER" -T /usr/bin/codesign >/dev/null
  fi

  # Trust is what makes it an identity rather than a file. This is the step
  # that needs the password, and the only one. Without a terminal (Claude
  # Code's `!` prefix has none) sudo cannot ask, which is how this failed on
  # 2026-10-03, so the system password dialog asks instead.
  echo "Trusting it for code signing (this is the step that asks for your password)..."
  if [ -t 0 ]; then
    sudo security add-trusted-cert -d -r trustRoot -p codeSign \
      -k /Library/Keychains/System.keychain "$WORK/cert.pem"
  else
    osascript -e "do shell script \"security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain '$WORK/cert.pem'\" with administrator privileges"
  fi

  if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; then
    echo "The certificate did not come out valid. Nothing else has changed." >&2
    exit 1
  fi
  echo "Identity \"$NAME\" is ready."
fi

echo
echo "Rebuilding the display so it carries the new signature..."
./scripts/bundle.sh release

echo "Installing it..."
rm -rf /Applications/Kyber.app
cp -R build/Kyber.app /Applications/

# The old grant still names a hash that no longer exists anywhere. Clearing it
# is what turns a switch that lies into one honest prompt.
python3 "$REPO/bin/lib/axgrant.py" --repair || true

echo "Restarting it..."
killall Kyber 2>/dev/null || true
sleep 1
open -a /Applications/Kyber.app

echo
echo "Hold Control and the talk key in a text box and talk. macOS asks for"
echo "Accessibility once more. Switch Kyber on, and that answer now holds"
echo "through every rebuild after this one."
