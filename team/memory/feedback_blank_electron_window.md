---
name: feedback_blank_electron_window
description: A blank or frozen desktop app window (Granola, Slack) is an Electron app with no renderer process left; app-revive restarts it every minute, and a screenshot can't tell frozen from live
metadata:
  type: feedback
---

On 2026-10-26 Caleb sent a screenshot of an empty Granola window: "Granola is tweakin". Granola had
been up almost three days, its main process was alive, and it had no `--type=renderer` child left.
Quit was ignored, so it needed a SIGKILL and a relaunch. Then he said "fix chewbs so stuff like this
never happens again".

Checking for the same thing everywhere turned up Slack, dead since the same minute. Its window
still showed a normal-looking channel. WindowServer keeps the last frame up, so a dead app can look
live in a screenshot. To check, look for a renderer under the app's main pid in `ps`, not at the
pixels.

`bin/app-revive` (a chewbacca-daemon service, every 60 s, registered in setup.sh) restarts an
Electron app that has a window but no renderer, once it's been seen that way on two runs in a row.
It leaves the app alone while one of its audio processes is busy, because restarting mid-meeting
would cut off the recording. It reopens with `open -g`. Test: `tests/app_revive.sh`. Its first live
run crashed on stock python 3.9 (ENAMETOOLONG, a Claude sandbox wrapper confused the bundle parse).
The test runs on /usr/bin/python3 now for that reason.

Related: [[feedback_hooks_run_on_stock_python]], [[feedback_services_run_from_the_kit]].
