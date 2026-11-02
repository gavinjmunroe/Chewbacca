---
name: feedback_gogcli_test_users_for_new_accounts
description: Before any `chewbacca email add` for an account not signed in before, check it's a test user on the gogcli OAuth app (project 1067120400776), or Google answers "Access blocked"
metadata:
  type: feedback
---

Chewbacca's Google sign-in (`chewbacca email add`, the gogcli OAuth app) runs
from Caleb's own Cloud project, number 1067120400776, client id
1067120400776-u5jfjef9gf7niapc..., and that app is in Testing. Only accounts on
its test user list can sign in. On 2026-11-02 team@firmfoundation.tech went to
sign in for FF outbound and got "Access blocked: gogcli has not completed the
Google verification process ... Error 403: access_denied". Caleb: "Bruh".
caleb@ and gavin@firmfoundation.tech hit the same wall, since none of the new
Workspace accounts had been added.

**Why:** the sign-in is the last step before a send, so a block there stalls
outbound on a credential step that should have been cleared days earlier.

**How to apply:** when a new account (a new Workspace inbox, a teammate) needs
`chewbacca email add`, first open
https://console.cloud.google.com/auth/audience?project=1067120400776 for Caleb,
have every new address added as a test user, then run the sign-in. Publishing
the app to production also works, but then every sign-in shows the unverified
app warning.

Also from the same FF outbound check: CAN-SPAM needs a postal address on cold
sales email even when the sender's own personal mail carries none (Caleb's dad,
2026-11-02: "I don't put an address and don't see why you need to"). A PO box
works. Never fill it with the family home.

Related: [[feedback_google_signin_calendar_write]], [[project_firm_foundation_outbound]].
