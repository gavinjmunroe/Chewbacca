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

Root cause of the dead main login, found 2026-10-22: the gogcli app (project
nova-gogcli-2026) is in Google's Testing status, and Google expires every
refresh token from a Testing app after 7 days. Since then `chewbacca google`
renews a revoked login itself (`chewbacca email add` for the address in
`~/.chewbacca/email/main`) and retries, and the consent tab opens with
`open -g`, behind his work. Publishing the app would end the 7-day expiry,
but the console's Publish button needs a home page and privacy policy on the
Branding page first, and driving the console in his Chrome put a tab in front
of him ("STOP FLASH BANGING ME"). Don't open the console in his visible Chrome
for this again.
