---
name: feedback_gogcli_test_users_for_new_accounts
description: gogcli is published as of 2026-11-02, so new accounts just sign in past the unverified warning. While it was in Testing, before any `chewbacca email add` for an account not signed in before, check it's a test user on the gogcli OAuth app (project 1067120400776), or Google answers "Access blocked"
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

**Update, 2026-11-02 ~3pm: the app is published ("In production").** The
Branding page needed a privacy policy before Publish would enable, so
https://firmfoundation.tech/privacy went live (firm-foundation 937599f) and the
Branding page now lists firmfoundation.tech as homepage, privacy link and
authorized domain. Caleb clicked Publish himself, since the agent's permission
layer refuses that click. Any Google account can now sign in by clicking past
the unverified app warning, and refresh tokens no longer die after 7 days. The
test-user step below only matters if the app is ever set back to Testing.
Starting several `chewbacca email add` runs at once is safe since 5e55dac8
(one sign-in log per address).

**How to apply (only while in Testing):** when a new account (a new Workspace inbox, a teammate) needs
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

**Update 2026-11-02 night:** the app (project nova-gogcli-2026, owned by
calebsnewton@gmail.com) is now In production, so test users no longer matter;
the unverified-app warning shows, then Advanced and continue. The next wall
was a 403 "Caller does not have required permission to use project
nova-gogcli-2026": a Workspace inbox needs roles/serviceusage.serviceUsageConsumer
on the project. caleb@, gavin@ and team@firmfoundation.tech were granted it,
and since a648bc9e and dbe1370c `chewbacca email add` grants it itself through
gcloud, only to the account the token belongs to. Chrome's default Google
account is not calebsnewton@gmail.com, so open the console with
authuser=calebsnewton@gmail.com.
