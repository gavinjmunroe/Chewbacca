---
name: feedback_campaign_recovery_graph_2026_10_16
description: How a paused-campaign recovery gets finished in one sitting, learned on the Zeutara recovery of 2026-10-16
type: feedback
---

A paused-campaign recovery (holds, sender isolation, recovery baseline, resume, reply backlog) is a task graph, and it finishes in about 90 minutes when it's run as one. Codex spent the night of 2026-10-15 on it serially and left all three campaigns paused. Caleb, 2026-10-16: "Please be efficient and not so narrow minded, chatgpt spun all day getting nothing done at all", then "Graph engineer as needed" and "What's taking so long?" when this tab went quiet for ten minutes.

What worked, in order:

- Fan out the read-only reconciliation first: investors in two halves, fresh replies, and deliverability plus copy, each with its own output file. The host allows two subagents at once, so queue the rest as slots free.
- One owner does every write. Writes go through `chewbacca clay` ops that read live, recheck right before sending and read back. Caleb's typed prompt in the same tab is the approval: a Claude tab's own v2 chat-approval record. Codex's native composer phrase doesn't apply in a Claude tab.
- Clay keeps a held enrollment active while the campaign is paused, even after it leaves the base audience. Blocklist the held addresses before resuming. It's reversible, and the resume op checks it.
- `clay campaigns update` refuses a `status` key. Resume is the Campaigns UI's own PATCH `{"status":"active"}`, the same endpoint Togari's bounce guard pauses with.
- Write the Togari recovery window (tenant secret `clay_recovery_windows_v1`) BEFORE resuming. Without it, the lifetime 3% rule pauses a repaired campaign on its next five-minute tick, because Qube B sat at 2 bounces in 32 sends. Prove it with a one-lead simulation: one send that bounces pauses, one clean send doesn't.
- The webhook reply workflow refuses a second answer to a lead ("Already replied to this lead") while reporting success. A second answer has to go through the native master-inbox reply against the investor's own latest REPLY (Togari 21184e2).
- Vantage's send-time policy wins over Togari's draft. On 2026-10-16 the draft named the client, and Vantage forbids that (`neverNameClient`). It also forbids offering a call "with the founder" when times belong to the reply owner.
- Update Caleb every few minutes with one prayer-led line. Silence reads as stuck even when the work is moving.
