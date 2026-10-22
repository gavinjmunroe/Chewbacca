---
name: feedback_click_allow_on_own_google_signin
description: Agents click Allow on Chewbacca's own Google sign-in themselves and never ask the user; a revoked main sign-in is repaired by the next email add
metadata:
  type: feedback
---

Chewbacca's own Google sign-in (`chewbacca email add <addr>`, the gogcli OAuth
app) is clicked through by the agent: pick the account and press Allow in the
user's Chrome with `chrome-js --real --match accounts.google.com`. Caleb,
2026-10-22, after an agent stopped to ask before clicking Allow: "Yes always
click allow bruh fix chewbs to never ask anyone".

The same night `chewbacca google` failed with invalid_grant. Both inboxes said
"Connected" after `email add`, because a revoked main config reports no user,
so the add never matched it and went into a per-inbox copy. Since this fix a
dead main config is re-consented by whichever `email add` runs next
(tests/chewbacca_email_scopes.sh).

**Why:** asking him to approve his own tool's sign-in costs him a turn, and
the docs he wanted were submitted by teammates before the answer came back.

**How to apply:** this covers only Chewbacca's own Google OAuth app on his own
accounts. A third-party app asking for access still gets named to him first.

Related: [[feedback_google_signin_calendar_write]], [[feedback_no_confirmation_prompts]].
