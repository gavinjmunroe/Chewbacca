# LockDown Browser won't start a quiz

Seen 2026-10-19 on a Brightspace quiz: "LockDown Browser is not installed" while
it was installed in /Applications and had just launched. Caleb: "Lockdown
browser isn't working bruh it's tweaking".

That banner only means Brightspace in Chrome couldn't detect the app. Check the
machine before believing it:

1. `pgrep -fl "LockDown Browser"` and the process start time. A process that
   started when he clicked means the rldb:// launch worked.
2. Screenshot. On 10/19 the window sat on a blank "New Tab" with the stop (X)
   button showing, a hung load.
3. Fix that worked: quit it (`pkill -f "LockDown Browser"`), move
   `~/Library/Application Support/Respondus LockDown Browser/cefcache` aside
   (rename, never delete), then he clicks "Try launching again".
4. `lsregister -dump | grep rldb` confirms the URL scheme is registered if the
   app never starts at all.

Never touch exam controls or try to get around the browser's checks. This is
only about getting it to open.
