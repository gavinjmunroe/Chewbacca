---
name: feedback_offboarding_backup_order
description: When an account is being deleted, connect and pull the account that dies first (the Google/email account) before anything slower; the BMA Google acc was deleted 25 min in while Clay and GitHub were still being set up
metadata:
  type: feedback
---

On 2026-10-26 Caleb asked to back up everything from his BMA account before BMA
deleted it: Gmail, Clay workspaces, BMA/Amber/Togari repos. The session mirrored
GitHub first, then spent 20 minutes on the Clay reader's 20,000-char cap. It
started the Google sign-in (`chewbacca email add`) only at minute 25, and Google
showed "Account deleted" before he could click Allow. His words: "Dang u went
too slow bro". GitHub and Clay survived because their logins are separate from
the Google account. Gmail and Drive didn't.

**Why:** the identity account (Google Workspace, Microsoft) is what the admin
deletes first, and every OAuth sign-in into it needs his click, so it carries
the longest wait. Repos and tools with their own sessions usually outlive it.

**How to apply:** for any "they're deleting my X account, save everything":

1. In the FIRST tool message, start the sign-in for the account being deleted
   (`chewbacca email add <address>` in a terminal tab) and tell him to click
   Allow now. Ask how long he has in the same message.
2. While he clicks, start the exports that need no click (git mirrors, sessions
   that already work).
3. Once the token lands, pull the email account first (`tools/google_export.py`
   pattern in ~/Documents/bma-amber-backup-2026-10-26/tools), then the rest.
4. If it's already gone, a Workspace admin can restore a deleted user for about
   20 days. Draft the ask to the admin and don't press "Next" on Google's
   restore screen.

Related: [[feedback_never_hand_him_a_command]], [[project_amber_caleb_terms_2026_09]].
