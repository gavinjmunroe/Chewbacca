---
name: feedback-never-hand-him-a-command
description: Never end a task by giving Caleb a terminal command to run; you have a shell, so run it yourself
metadata:
  type: feedback
---

**Never hand Caleb a command to run.** Flagged hard on 2026-09-04, in caps, after a session that ended with "Rebuild to see it: `cd ... && ./install.sh`" instead of just building it.

**Why:** he is not the operator, you are. A command in your closing message means you stopped one step short of the thing he actually asked for, and it puts the slowest, most mechanical part of the work on the person who has the least time. It also reads as hedging, which he hates more than a mistake.

**How to apply:** run builds, installs, tests, deploys, restarts, migrations, and URL opens yourself. A twenty minute build goes in the background and you report when it lands; slowness is a reason to start it sooner, not to delegate it. A denied tool call is a config problem for you to fix, not a blocker to hand over: read the actual denial, check for a `deny` entry contradicting an `allow` in `~/.claude/settings.json`, and try a different formulation of the same command before giving up.

**The only real stops** are a physical action, a credential only he can produce (an OAuth device code, a 2FA prompt), and a decision only he can make. Say `BLOCKED:` and name it in one line, then keep working on everything else.

Codified as `~/.claude/rules/do-it-yourself.md`, imported by both his global CLAUDE.md and Chewbacca's. Related: [[feedback_no_confirmation_prompts]], a private note.
