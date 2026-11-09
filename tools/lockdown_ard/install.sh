#!/bin/sh
set -eu
base='/Library/Application Support/LockDown ARD Switch'
label='com.calebnewton.lockdown-ard-switch'
plist="/Library/LaunchDaemons/$label.plist"
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo 'Administrator approval required' >&2; exit 1; }
# Refuse installation until the existing setup is independently restorable.
/usr/bin/python3 "$source_dir/switch.py" --check
[ ! -e "$plist" ] || { echo 'Watcher is already installed' >&2; exit 1; }
[ ! -L "$base" ] || { echo 'Refusing a symbolic link at install destination' >&2; exit 1; }
/usr/bin/install -d -o root -g wheel -m 755 "$base"
[ ! -L "$base/switch.py" ] || exit 1
[ ! -L "$base/owner" ] || exit 1
/usr/bin/stat -f '%u' /dev/console > "$base/owner"
/bin/chmod 644 "$base/owner"
/usr/sbin/chown root:wheel "$base/owner"
/usr/bin/install -o root -g wheel -m 644 "$source_dir/switch.py" "$base/switch.py"
[ ! -L "$base/lockdown-ard-switch" ] || exit 1
# Compiled at a fixed path so the Full Disk Access grant survives reinstalls.
/usr/bin/cc -O2 -o "$base/lockdown-ard-switch" "$source_dir/launcher.c"
/usr/sbin/chown root:wheel "$base/lockdown-ard-switch"
/bin/chmod 700 "$base/lockdown-ard-switch"
/usr/bin/install -o root -g wheel -m 644 "$source_dir/$label.plist" "$plist"
/usr/bin/plutil -lint "$plist"
/bin/launchctl bootstrap system "$plist"
echo 'Automatic ARD switch installed'
