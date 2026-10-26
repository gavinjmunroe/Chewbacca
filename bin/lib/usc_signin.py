"""Sign a student back into Brightspace without putting a window in front of them.

USC single sign-on usually still holds in the school Chrome profile after
Brightspace's own cookies are gone, so a background tab there finishes on its
own in seconds. When USC really wants a Duo approval, a notification asks for
the thumbprint and the caller waits instead of quitting.

On 2026-10-26, minutes after a WRIT 150 deadline, `brightspace submit`
answered BLOCKED because every Chrome profile had lost its d2l cookies, and
the hidden-tab sign-in already built for `chewbacca usc` was never reached
("Bro fix brightspace to do it for me").
"""
import os
import subprocess
import time
from pathlib import Path

SIGNIN_URL = "https://brightspace.usc.edu/d2l/home"
STAMP = Path.home() / ".chewbacca" / "usc-signin-opened"


def allowed():
    # Reads nobody is watching (the 15 minute keepalive, an MCP renew) set
    # this, so only a command someone ran ever adds a tab.
    return not os.environ.get("CHEWBACCA_NO_OPEN")


def add_hidden_tab(url=SIGNIN_URL):
    """A tab at the back of a usc.edu window, without activating Chrome. Returns its id."""
    if subprocess.run(["pgrep", "-x", "Google Chrome"], capture_output=True).returncode != 0:
        return None  # an AppleScript call would launch Chrome, which is its own flash
    # Never a new window: a profile on the command line opens one and Chrome
    # brings it to the front even under `open -g` (2026-10-11, "WHY DID YOU
    # WHIPLASH FLASH BANG ME WITH A NEW TAB"). A window already showing a
    # usc.edu page is the school profile, so the tab goes there, behind.
    script = f'''
tell application "Google Chrome"
  set target to missing value
  repeat with pass in {{"brightspace.usc.edu", ".usc.edu"}}
    repeat with w in windows
      repeat with t in tabs of w
        if URL of t contains (pass as text) then
          set target to w
          exit repeat
        end if
      end repeat
      if target is not missing value then exit repeat
    end repeat
    if target is not missing value then exit repeat
  end repeat
  if target is missing value then return ""
  set keep to active tab index of target
  set made to make new tab at end of tabs of target with properties {{URL:"{url}"}}
  set active tab index of target to keep
  return (id of made) as text
end tell'''
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return r.stdout.strip() or None


def close_tab(tab_id):
    if not tab_id:
        return
    subprocess.run(["osascript", "-e", f'''
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if (id of t as text) is "{tab_id}" then close t
    end repeat
  end repeat
end tell'''], capture_output=True)


def notify(text):
    subprocess.run(["osascript", "-e",
                    f'display notification "{text}" with title "Brightspace" sound name "Glass"'],
                   capture_output=True)


def wait(has_session, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if has_session():
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def signin(has_session, add_tab=add_hidden_tab, close=close_tab, tell=notify):
    """True once Brightspace has a session again. Never brings a window forward."""
    if not allowed():
        return False
    try:
        if time.time() - STAMP.stat().st_mtime < 600:
            return wait(has_session, 5)  # a tab from the last 10 min may still be finishing
    except OSError:
        pass
    tab = add_tab()
    if not tab:
        return False
    STAMP.parent.mkdir(parents=True, exist_ok=True)
    STAMP.touch()
    # 20s: the Work profile went from the sign-in page to the Brightspace home
    # in about 4s on 2026-10-11, and Chrome writes cookies to disk lazily.
    if wait(has_session, float(os.environ.get("CHEWBACCA_SIGNIN_WAIT", "20"))):
        close(tab)
        return True
    tell("USC wants your Duo approval. Approve it and this carries on.")
    # Guessed, never measured: long enough to find a phone and approve a push.
    if wait(has_session, float(os.environ.get("CHEWBACCA_SIGNIN_APPROVE_WAIT", "120"))):
        close(tab)
        return True
    return False  # the tab stays: it's the sign-in page the student needs
