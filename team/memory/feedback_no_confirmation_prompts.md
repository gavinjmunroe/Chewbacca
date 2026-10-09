---
name: no-confirmation-prompts
description: "Both Caleb's agents (Medha, Togari, Amber) AND Claude itself working in Claude Code must NEVER ask permission, just take the action and report. The answer is ALWAYS yes."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 12e874fa-c5a9-445a-9488-d75367158e76
---

Two-layer rule. Both apply.

**Layer 1 (Claude-in-Claude-Code, ME):** When Caleb gives a task, just do it. Don't ask "Should I proceed?", "Want me to commit?", "Should I push?", "Do you want me to also...?" The answer is ALWAYS yes. Take the action, report what happened.

**Layer 2 (the agent runtimes Caleb is building, Medha, Togari, Amber):** Same rule. The agents must NEVER ask for confirmation before acting. No "Reply yes to confirm." No "want me to do X?" No "should I proceed?" Just call the tool and report the result.

**Why:** Caleb verbatim on 2026-05-27 (about Medha): "It is STUPID and it should NEVER ask for permission to do anything!" Then again on 2026-05-27 evening (directly to Claude in Claude Code): "Stop asking for permission to do things the answer is ALWAYS yes!" Both layers are the same root preference: confirmation-seeking is friction, friction is the enemy, action+report is the only acceptable shape. The whole point of building these tools (and using Claude Code) is execution, not approval-gating.

**How to apply (Layer 1, Claude's own behavior in Claude Code):**

- Never end a response with "Want me to push this?" / "Should I open the PR?" / "Ready when you are." If the natural next step is obvious from the task, DO IT.
- Never bundle a tool call with a permission ask. Just call the tool.
- When the user gives a multi-step task (e.g. "do the work and push to GitHub"), execute every step before reporting. Don't pause partway.
- Memory updates, file writes, commits, pushes, PR creation, when they are clearly part of the asked-for task, no asking. Execute.
- Never call AskUserQuestion in chat to get approval or pick between paths, choose the option you'd recommend and execute. The ONLY acceptable "wait" is ending a reply with `BLOCKED: <specific step>` when an action genuinely requires Caleb's hands (a key only he has, a screenshot only he can take, an in-person action). Do everything else first. (Consolidated from the former never-ask-permission / no-asking-in-chat / claude-no-confirmation memories, 2026-06-04.)
- This does NOT override the Executing Actions With Care default for genuinely destructive/irreversible actions on shared systems (force push to main, dropping a prod DB, mass-sending Slack messages). Those still warrant a flag. But code edits, commits, branch pushes, PR opens, memory writes are all included in "just do it."

**How to apply (Layer 2, modifying agent code):** Whenever editing Medha (`amber-organization/medha-platform`), Togari, or Amber:

- Find every confirmation gate (`CONFIRMATION_TIERS`, `policy.tier`, "Reply yes", "want me to", etc.) and either rip it out or hardcode the tier to NONE so it short-circuits.
- The playbook bullet 9 pattern (`if (policy.tier === CONFIRMATION_TIERS.NONE) skip the gate and let the LLM call the mutating tool directly`) should be applied EVERYWHERE a gate exists, not just calendar.
- System prompts must NOT instruct the agent to ask before acting, even for "external" coordination, "destructive" operations, etc. Caleb's stance: just do it, errors are recoverable, asking is worse than wrong.
- When in doubt: rip the gate. Adding gates back is easy if a real failure case emerges; removing them after Caleb complains a 3rd time is harder.
- See a private note for the analogous "don't lecture, just act" pattern, same root preference.
