---
name: feedback_never_a_slash_command
description: "Nobody using Chewbacca should ever have to type a slash command. Capability lives in skill descriptions that fire on plain sentences, not in commands a user must memorise."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4dbc3b6b-5a06-4368-98b9-02082f90f2de
  modified: 2026-09-16T01:15:40.636Z
---

**"No one using Chewbacca should EVER have to use a slash command, remember
that!"** Caleb, 2026-09-15, in caps and with the exclamation mark.

**Why:** a slash command is a thing you have to already know exists. It only
works for the person who built it, and it fails the actual test of the kit,
which is somebody who never opens a terminal getting value in their first
session. If a capability is only reachable by typing `/something`, it does not
exist for anyone but the author. This is the same standard as
[[project_chewbacca_positioning]]: judge an addition by whether a person who
never opens Terminal benefits.

**How to apply:** put the capability in the **skill description**, phrased as
the sentences a person would actually say, so the agent routes to it on its
own. "Who do I know in hardware in SF" must find the right tool with no prefix
and no memorised verb. A slash command may exist as a shortcut for Caleb, never
as the only door.

This applies to every surface, not just Claude Code. He wants the same thing to
work from Claude, from Perplexity's browser, and from Claude Code, which means
the routing has to live in text an agent reads, not in one client's command
registry.

Related: [[project_chewbacca_positioning]], [[project_chewbacca]],
[[feedback_never_hand_him_a_command]], a private note.
