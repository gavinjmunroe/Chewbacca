---
description: Capture a quick idea, adds to Todoist + saves to memory if significant
allowed-tools: Bash(curl:*), Bash(date:*), Read, Write, Edit
argument-hint: "<idea or note>"
---

# Scratchpad

> Todoist's REST v2 answers 410 Gone since 2026; these calls use API v1, where list endpoints return `{"results": [...], "next_cursor": ...}`, so read `.results`.

Capture $ARGUMENTS as a quick idea. Fast, no friction.

## Step 1: Categorize

Determine if this is:

- A **project idea** → Todoist task in Sprint 5, label "Idea"
- An **action item** → Todoist task in appropriate sprint
- A **note/insight** → Save to memory only
- A **reminder** → Todoist with due date

## Step 2: Add to Todoist

```bash
curl -sf -X POST "https://api.todoist.com/api/v1/tasks" \
  -H "Authorization: Bearer $TODOIST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "[IDEA] {content}", "priority": 1}'
```

## Step 3: For significant ideas

If the idea relates to an existing project or is a meaningful strategic insight, also note it in:

- The relevant project memory file if one exists
- Or create a quick note in CURRENT_CONTEXT

## Step 4: Confirm

One line: "Captured: {idea} → {where it went}"
