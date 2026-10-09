---
name: search-brain-live-data-override
description: "medha-platform's search-brain context_only suppression must NOT fire for live-data queries (calendar, email, contacts, reminders, partnerships, events, dates). The override lives in agent.js right before the context_only branch and matches a wide regex."
metadata:
  node_type: memory
  type: feedback
  originSessionId: fde318b6-7115-4e5f-9a44-e39961dba494
---

medha-platform's `search-brain` (Newton/agent/lib/search.js `planSearch`) can return `action: "context_only"` for any query it considers a "repeat." When that hint is injected into the agent's system prompt, Claude regurgitates the cached prior answer instead of calling the relevant tool. **For live-data queries this produces stale answers** (e.g. "what's on my calendar May 28" returning "still clear" because the same question was asked yesterday before a fix shipped, and the cached "still clear" reply is what Claude leans on).

**Why:** The cache logic in search-brain only knows about the conversation. It doesn't know that calendars / inboxes / contact graphs / Pinecone state CHANGE between asks. Treating those as "same question = same answer" is wrong by definition.

**How to apply:** Before injecting any "context-only" hint in agent.js, check whether the user's message matches the live-data intent regex (calendar, schedule, events, meetings, appointments, today/tomorrow/tonight, weekdays/month names, email/inbox/gmail, contacts, "who do I know," partnerships, investors, reminders, tasks, etc.). If it matches, inject a `LIVE-DATA OVERRIDE` system-prompt note that explicitly tells Claude to call the tool fresh instead of using cached context.

This override shipped in medha-platform@1a92759 (2026-05-28) after Caleb's "still clear" calendar bug. If a similar "cached-stale-answer" bug surfaces for any new tool, broaden the regex.

Related: [[reference_medha_id_storage]] (Pinecone is the live source of truth for contact/journal data, same rule applies there).
