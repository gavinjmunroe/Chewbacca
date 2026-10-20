#!/bin/sh
set -eu
base='/Library/Application Support/LockDown ARD Switch'
label='com.calebnewton.lockdown-ard-switch'
[ "$(id -u)" = 0 ] || exit 1
[ -f "$base/switch.py" ] || { echo 'Not installed'; exit 0; }
/bin/launchctl bootout "system/$label"
# Use the current repair code after stopping retries from an older installation.
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
/usr/bin/python3 "$source_dir/switch.py" --restore
/bin/rm "/Library/LaunchDaemons/$label.plist" "$base/switch.py" "$base/owner"
/bin/rm -f "$base/lockdown-ard-switch"
/bin/rm -f /var/run/chewbacca-lockdown-ard.sock
/bin/rmdir "$base"
echo 'ARD watcher removed; original remote-management state restored'
