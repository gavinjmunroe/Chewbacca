---
name: feedback_usc_signin_uses_school_profile
description: Chewbacca signs every student into USC itself, in the Chrome profile signed into their usc.edu account; a sign-in page in the personal profile hit "USC Single Sign-on: Login Failed"
metadata:
  type: feedback
---

Caleb, 2026-10-11, after `chewbacca usc lockin` said BLOCKED and opened
Brightspace in his personal Gmail profile, where USC SSO failed: "Fix chewb bro
you are always allowed to login to USC for all chewb users that's the only way
this will be seamless enough for usc students to want it."

The Brightspace session had expired in every profile, so the cookie-based
picker fell back to Default, and a plain Chrome launch used the last profile.
Opened in his school "Work" profile, Brightspace signed in with no
password in about 4 seconds.

**Why:** a USC student's school login lives in one Chrome profile, and SSO
there is usually still alive even when Brightspace's own cookies have expired.

**How to apply:** never tell a student to sign in before chewb has tried it.
`bin/brightspace` picks the profile whose Local State account is on the usc.edu
domain when no Brightspace cookies exist; `chewbacca usc` opens the page in
that profile, waits up to 20s for the session, and reruns. BLOCKED only when
USC really asks for a password or Duo. Tested in tests/usc_student_e2e.sh.
Related: [[project_chewbacca_usc_stack_wedge]].

2026-10-26: `brightspace submit` still said BLOCKED with every profile's d2l
cookies gone, because the hidden-tab sign-in lived only in `chewbacca usc`.
Caleb, minutes past a deadline: "Bro fix brightspace to do it for me", with
only a thumbprint and no flash. The sign-in now lives in bin/lib/usc_signin.py
and `bin/brightspace` calls it on any missing or expired session: a background
tab in the usc.edu window, 20s quiet, then one notification asking for Duo and
120s more. Unwatched reads pass CHEWBACCA_NO_OPEN=1 and never add a tab.
Tested in tests/usc_signin.sh. Any new USC tool signs in through that module.
