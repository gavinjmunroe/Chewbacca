---
name: feedback_client_channels_are_togari
description: Agents never post in a client's Slack conversations as Caleb; Togari's bot is the only automated voice there
metadata:
  type: feedback
---

Nothing automated goes into a client channel or client DM from Caleb's Slack
account. Togari posts there as its own bot: reply cards, "He wrote / We sent"
lines, deck sends.

**Why:** Caleb, 2026-10-12: "Why tf are there automated messages from my acc in
the slack?????????? Everything should be togari!!!!!!!!!!" Local agents had
posted 13 messages into #zeutara-cold-replies from his account on 10/11 and
10/12 (reply summaries, deck notes, a to-do for Jonah, one line three times a
second apart), via slackcli and the Slack MCP, both of which act as him. They
were following the Zeutara ruling that every handled reply posts in the
channel, which was meant to be Togari's job.

**How to apply:** client-post-guard.sh refuses slackcli sends and Slack MCP
sends or schedules into any conversation listed in clients.json
client_slack.conversations (tests/client_post_guard.sh). A draft for Caleb to
send himself is allowed. Work that needs a post goes through Togari.

Related: [[feedback_client_agents_propose_never_act]], [[feedback_automation_runs_on_server]].
