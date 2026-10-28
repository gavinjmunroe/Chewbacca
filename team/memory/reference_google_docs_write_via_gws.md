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
Never mix a text-changing request (replaceAllText, insertText) into a batch of index-based deletes or styles computed from one read. On 2026-10-26 one replaceAllText near the top of Colin's guides doc ran before 32 deletes and shifted them, so they ate single letters out of 21 lines. Text changes go in their own batch, then re-read for indices.

4. Read the doc back, diff the plain text before and after, and check that each new string is there. A 200 response is not evidence.

Checked 2026-10-13: Docs writes work. gws carries the documents scope, and a revision-pinned `chewbacca google replace` on a scratch Doc wrote, read back and refused a stale revision, in 1.8 s. The safe write path is that command: Drive's `capabilities.canEdit` first (`chewbacca google access <id>`), then one batchUpdate with `writeControl.requiredRevisionId`. Nothing needs the web app's own requests.

Before a write, ask Drive, not Docs, whether this account may edit. Google checks the revision before the permission, so a probe can't tell, and revisionId is no signal: a comment-only Doc carried one and a view-only Doc didn't. A 403 "The caller does not have permission" is the owner's call (ask them for edit access), not a sign-in problem.

A 403 "insufficient authentication scopes" means the sign-in lacks write access. `chewbacca email add <the gws auth status user>` re-consents. Since 2026-10-11 it asks for full account access (mail, Drive, Docs, Sheets, Slides, Calendar, Contacts, Tasks).

Related: [[feedback_google_signin_calendar_write]], [[feedback_never_read_only]].

`createParagraphBullets` deletes the leading tabs it reads as nesting, so every index after a nested run moves back one per tab. On 2026-10-28 three nested bullets in the OPTRA call section shifted the next two bullet runs by 3, and the "6. Close" heading and the Firebox H1 below them turned into bullets. Put nested bullet runs last in the batch (or bottom to top), or re-read between runs.
