---
name: feedback_fix_the_core_not_a_guard
description: "When chewb breaks, rework the design that made the failure possible; a guard or cleanup alone only avoids it"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 1616f3ef-4fd1-4c0f-91c3-dbab0478cf71
  modified: 2026-10-09T21:16:20.022Z
---

When Chewbacca breaks, fix the core: change the design so the right thing happens by default. A guard that refuses the bad thing, or a cleanup that runs after it, doesn't count as the fix on its own.

On 2026-10-10 the Mac lagged until Caleb force-quit Claude. Every tab had started its own long jobs (a Clay crawler, a Nalana render, transcription, overlapping texts syncs) with no shared budget and no owner that outlived the tab. The first fixes were all guards and cleanup: orphan-reap, a sync lock, Nalana added to load-guard. He asked: "You didn't just avoid the problem but you reworked the core? That's how chewb should fix itself, not j avoiding bad but making it always good."

The core fix was `chewbacca jobs`, one machine queue owned by launchd. It runs one heavy job at a time, admits work only when the Mac has room, pauses it (SIGSTOP) when he's using the Mac, resumes it after, and keeps it alive when the tab closes. load-guard now points refused work at the queue instead of only refusing it (chewbacca 8418d3ec, ca6c1b89).

**Why:** a guard only covers the cases someone thought of, and a design change covers the next case too.

**How to apply:** after any fix, ask whether the failure is now impossible or only caught. If it's only caught, find the missing owner, budget or default and build that. Name the bare `jobs` gotcha too: `jobs` is a zsh builtin, so the queue is `chewbacca jobs`. Related: [[feedback_enforce_dont_document]], [[feedback_one_job_not_six]], [[feedback_his_scope_words_are_the_spec]].

2026-10-09 restart: the queue only covered shell jobs. Each tab also fanned out 6+ background subagents (HUD apps had 6, Sites had 3), so `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=2` is now in ~/.claude/settings.json env, and restart prompts tell tabs to resume one subagent at a time and send heavy work through `chewbacca jobs submit`.

Same night, the restart spike was MCP servers: every tab boots its own copy of each one, 252 processes at load 106. Removed time, fetch, git, github, sequential-thinking, filesystem, macos-automator, supabase, medha (user scope; backup ~/.claude.json.bak-mcp-20261009) and disabled the serena, pinecone, bigquery plugins. setup.sh no longer re-adds git/filesystem (chewbacca c007bfa0). Before adding any local MCP server, ask whether a CLI or built-in tool already covers it, bc its cost multiplies by tab count.
