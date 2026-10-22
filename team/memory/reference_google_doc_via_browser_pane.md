---
name: reference_google_doc_via_browser_pane
description: When gws and gog Google tokens are expired, the desktop app's built-in browser pane is still signed in to Google and can make a Doc with no click from the user.
metadata:
  type: reference
---

On 2026-10-21 `gws` returned invalid_grant (token expired or revoked) and `gog` had no stored tokens, so `chewbacca google` couldn't create a Doc. The Claude in Chrome extension wasn't connected either. The built-in browser pane was already signed in to a Google account.

What worked:

1. Navigate the pane to https://docs.new.
2. In the page, focus `iframe.docs-texteventtarget-iframe` and its `[contenteditable=true]`, then dispatch a ClipboardEvent('paste') whose DataTransfer carries text/html (pandoc's HTML output).
3. Verify by fetching `/document/d/<id>/export?format=txt` from the page and counting words. The canvas can render blank until a reload, so don't trust a screenshot.
4. Rename by triple-clicking the title, typing, and pressing Return. Setting the input's value from JS did not stick.

The pane's account may not be the one the user wants (it was the personal gmail, not USC), so say which account owns the Doc.

Related: [[reference_google_docs_write_via_gws]], [[feedback_google_signin_calendar_write]].

A Doc you made can become the user's working copy. On 2026-10-21 the Doc made that afternoon had been renamed by Caleb, shared with a peer reviewer, and filled with 11 of her comments. Reopening it to push a revision, the agent pressed select-all before it noticed. Replacing the text would have deleted every comment anchor. So a revision always goes into a NEW Doc from docs.new. Before any edit, check document.title and the comment count in `export?format=txt` against what you made.
