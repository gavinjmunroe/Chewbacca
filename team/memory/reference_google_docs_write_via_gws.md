---
name: reference_google_docs_write_via_gws
description: How Chewbacca edits a Google Doc in place (tabs, indices, verify), so nobody falls back to clipboard pastes or keystrokes into Chrome
metadata:
  type: reference
---

Editing a Google Doc is `gws docs documents batchUpdate`, never clipboard pastes or keystrokes into Chrome. On 2026-10-11 a team paper went in this way after 20 minutes lost to a 403 and keystrokes that landed in VS Code instead of the doc.

1. Read with `gws docs documents get --params '{"documentId":"<id>","includeTabsContent":true}'`. Docs with tabs keep text under `tabs[].documentTab.body.content`, and every location needs that tab's `tabId`.
2. Pick indices from the paragraphs' `startIndex` and `endIndex`. Insert before a paragraph's closing newline so new paragraphs inherit its style.
3. Send every request in one batch, highest index first, or each edit shifts the next one's indices. `replaceAllText` with `tabsCriteria` handles typos.
4. Read the doc back and check that each new string is there. A 200 response is not evidence.

A 403 "insufficient authentication scopes" means the sign-in lacks write access. `chewbacca email add <the gws auth status user>` re-consents. Since 2026-10-11 it asks for full account access (mail, Drive, Docs, Sheets, Slides, Calendar, Contacts, Tasks).

Related: [[feedback_google_signin_calendar_write]], [[feedback_never_read_only]].
