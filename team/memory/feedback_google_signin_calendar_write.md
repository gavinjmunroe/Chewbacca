---
name: feedback_google_signin_calendar_write
description: Chewbacca's Google sign-in now asks for calendar write; never improvise `gws auth login`, and clear token_cache.json after any re-login
metadata:
  type: feedback
---

Chewbacca's Google sign-in (`chewbacca email add`) requests read-write calendar,
so adding events works on the first try. On 2026-10-09 the token only had
calendar.readonly, every event add returned 403, and an improvised
`gws auth login` with no `login_hint` let the browser pick a work account that
isn't a tester on the OAuth app: "Access blocked: has not completed the Google
verification process". After the right account signed in, gws still served the
old token from `token_cache.json` until it was moved aside.

**Why:** three failures stacked in one ask ("get my calendar right"), each one
visible to the user.

**How to apply:** for a missing Google scope, re-run `chewbacca email add <the
account in gws auth status "user">`, which pins the account and clears the cache.
Never hand-roll the login URL. Guarded by tests/chewbacca_email_scopes.sh.
Related: [[feedback_never_hand_him_a_command]].
