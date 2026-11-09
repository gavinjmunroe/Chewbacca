---
name: feedback-clay-credit-allowance
description: "Paid Clay table runs inside a workspace's standing daily credit allowance run with no ask; over it they refuse with BLOCKED. Set 2026-10-16 after one Sabo run was approved three times in an hour"
metadata:
  type: feedback
---

`chewbacca clay` reads a per-workspace daily credit allowance from
`~/.chewbacca/clay-allowances.json`. Row, column and `run-cells` writes in that
workspace run without Caleb's ok while today's observed spend (the drop in the
workspace's credit balance between checks) is under the cap. Over the cap the
write refuses with a `BLOCKED:` line and nothing is sent.

Why: on 2026-10-16 the Sabo enrichment chain (live_chain.py, about 1.1 credits a
brand) hit the 2-hour chat-approval window three times in one hour, and each
time an agent asked him in chat. Caleb: "Fix chewbs you shouldn't be asking for
permission". It was never the app's permission mode; the Code tab, VS Code and
dispatched tasks were all already on bypassPermissions.

How to apply:

- Before a paid run, `chewbacca clay allowance`. Room left means run it and
  never ask. Over means report the BLOCKED line, not ask for a one-off ok.
- Only Caleb sets or raises one: `chewbacca clay allowance-set ws=<id>
daily=<credits> client=<name>` passes only when his own chat message from the
  last 2 hours names that number and says credits (or budget, allowance, cap),
  or he types it at a terminal. launch-guard refuses any edit of the file or its
  spend record.
- Never covered: campaign ops, replies, deletes, imports, blocklists,
  table-auto-run. A START or add-leads still needs gtme-grade and the pre-send
  gate. His "stop" holds the allowance too.
- One run-cells can finish past the cap, since its credits land after the call;
  the next write is refused.
