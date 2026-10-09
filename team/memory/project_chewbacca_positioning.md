---
name: project-chewbacca-positioning
description: "Chewbacca's audience thesis: OpenClaw for normal people with a Claude subscription, not for engineers who self-host"
metadata:
  type: project
---

**Caleb's positioning for Chewbacca, stated 2026-09-04: "Chewbacca should be OpenClaw for normal
people with a Claude subscription. OpenClaw is only used by tech bros."**

**Why:** the difference a person actually feels between the two is the first ask, not the
architecture. OpenClaw wants model credentials you bring yourself plus a gateway daemon you keep
alive. Chewbacca wants a Claude subscription. No provider choice, no pasted key, no per-token bill.
The README's comparison used to argue daemons and credential brokering, which only lands with people
who already self-host, so it was arguing against OpenClaw on the terms of the people it already
suits. Rewritten 2026-09-04.

**How to apply:** judge additions by whether someone who has never opened Terminal could benefit.
The capabilities already pass that test (calendar, texts, transcripts, reading the screen). The
packaging does not: `git clone`, a GitHub sign-in, Homebrew, node, uv, and a README whose badges
count slash commands. When writing anything user-facing, the plumbing words (hooks, subagents, MCP
servers, shellcheck) are invisible to this audience and should stay in the docs, not the pitch.

**The crux is RESOLVED as of 2026-09-04.** The question was: Claude Code is a terminal tool, and
most people with a Claude subscription use the desktop app instead, so how does Chewbacca reach
them? Caleb's answer is that it doesn't, and it was never supposed to. **Chewy is the Mac-focused
infrastructure layer. Amber is the phone layer.** Chewy deliberately mirrors Amber's capabilities on
the Mac, and its job in the funnel is to hand its users to Amber when Amber ships. So do not build a
text or iMessage surface for Chewbacca: that surface is Amber, and building it twice competes with
Sagar's product.

**How to apply:** when a Chewbacca gap turns out to be "you have to open a terminal," that is not a
bug to fix, it is the boundary. Fix reachability gaps inside the Mac (menu bar, launchd, Shortcuts,
the desktop app). Send phone-shaped and conversational-surface gaps to Amber. When comparing
Chewbacca to consumer assistants like Tomo, the honest frame is that Chewy wins on capability and
on owning your own data, and loses on reachability on purpose.

**RESOLVED 2026-09-11.** The open question was whether the funnel-to-Amber relationship could be
stated publicly, since Chewbacca is public and Amber is Sagar's company. Caleb ruled: **"Chewbacca
is the open source local version of amber for personal use."** That framing is public and he used it
in his LavaLab application. **The distinction that still holds:** saying Chewbacca is the open-source
local version of Amber is fine; saying it exists as Amber's top-of-funnel growth play is strategy and
stays private. Do not re-raise this.

Related: [[project_chewbacca]], a private note
