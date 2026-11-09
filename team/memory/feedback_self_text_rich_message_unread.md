---
name: feedback_self_text_rich_message_unread
description: A self-texted ChatGPT share shows as "unsupported content" in mac messages and people texts; its text is in attributedBody
metadata:
  type: feedback
---

On 2026-10-26 Caleb said "peep what I texted myself plz order all of them". His self thread is
`calebspencernewton@icloud.com`, not his phone number, and `people texts me` resolved "me" to a
roommate. The newest message read as "unsupported content" in `mac messages history` and
`people texts` showed nothing. The whole shopping list (links, prices, a delivery warning) was in
the message's attributedBody, readable only with `RAW_MESSAGES_OK=1` and `strings`.

**Why:** shared ChatGPT answers and rich links arrive as attributed text with no plain `text` field,
so both readers drop them and the agent concludes there's nothing there.

**How to apply:** "what I texted myself" means the icloud self thread. When the newest message
there is unsupported content, decode attributedBody before saying it's empty. The real fix is the
reader decoding attributedBody for these rows. Separately: the extension's Chrome is not signed into
Amazon, so an order is BLOCKED on his sign-in; check links shipping by the needed date (the ChatGPT
list had a China-shipped shirt and a dead product page) before calling a list orderable.
