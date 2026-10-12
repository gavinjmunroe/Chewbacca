# Context budget: what every session pays before the first word

Measured 2026-10-11 at 21:00 with `context-budget --session f3c147a8`, a Claude
Code session opened from `~` in VS Code.

## The number

- First turn: 131,426 tokens (exact, from the transcript's usage).
- System prompt and tool schemas, the host's share: about 33,400 (residual).
- Attributed to files, hooks, skills and MCP instructions: about 98,000.

The biggest sources:

- 10,221 `~/.claude/CLAUDE.md`
- 8,800 the skill list
- 8,706 `~/.chewbacca/team-memory-index.md`
- 6,420 `~/second-brain/memory/MEMORY.md`
- 4,853 `rules/agent-neutral.md`
- 4,638 `core/people.md`
- 4,528 `rules/writing.md`
- 3,624 `core/now.md`
- 3,472 `core/voice.md`
- 2,860 a plugin's inject-claude-md hook
- 2,431 the tabs hook
- 3,531 Higgsfield and Figma MCP instructions plus Higgsfield tool schemas

## The rule this enforces

A prose rule that matters becomes a check, and the check teaches at the moment
of the mistake. Prose that no check backs and that the model already does by
default costs tokens in every session for nothing. Each rule below was looked
up in `.claude/hooks`, `.githooks` and `bin/` (scratchpad `rule_map.py`, then
read by hand). A mention is not enforcement; the column says what refuses.

Enforced by a check today:

- No em dashes: slop-guard and prose-guard on replies and files,
  thinking-dash-guard on thinking.
- Banned words and slop shapes: prose-check, slop-check.
- Chat register, no headers or bold scaffolding: slop-guard `--chat`.
- Essay into a shared doc goes through `slop-check --essay`: essay-gate.
- Pray first: prayer-guard reads every visible block.
- Never hand Caleb a command: handoff-guard.
- Scope words are the spec: scope-guard.
- Stage by name, see what is staged: `.githooks/pre-commit`.
- Long or heavy work goes through the job queue: load-guard, machine-budget.
- Never Vercel: vercel-guard.
- Destroying uncommitted work: destructive-guard.
- Untrusted content: untrusted-screen warns on fetched pages and messages.

Prose only, no check (candidates, not deleted):

- `git.md`: never add Co-Authored-By. No hook reads commit messages for it.
- `git.md`: branch naming fix/feat/chore. Nothing checks it, and `chewbacca
land` lands commits on main, so the branch name rarely survives.
- `security.md`: parameterized SQL. No check. Belongs in a lint for the
  projects that have SQL, not in every session.
- `typescript.md` (1,288 tokens, every session): `tsc --noEmit` and no `as
any`. Only pr-guard mentions tsc. It is stack guidance and belongs in the
  `stack-rules` skill, which loads on TypeScript work.
- `naming.md` (1,064 tokens): no check, generic conventions the model follows
  without being told. Delete or move to `stack-rules`.
- `review-discipline.md`: every fix carries a regression test. No check. The
  closest is `chewbacca land`'s tests running; a "fix:" commit with no test
  file could be refused there.
- `context-discipline.md`: never record intent as fact, `[NEED:]` for
  unverified specifics. No check.
- `CLAUDE.md`: never publish an Artifact. No check. A PreToolUse hook on the
  Artifact tool would make it one line of code.
- `CLAUDE.md`: the debugging protocol (302 tokens). Generic, no check.
- `CLAUDE.md`: "NO Times New Roman" and the other UI prohibitions. The
  design-system rule already loads on UI files; these duplicate it in every
  shell session.

## The design: context from the graph, per task, with a cap

1. Core identity stays: `core/identity.md`, `core/voice.md`, the prayer rule.
   About 6,000 tokens. Everything else is fetched for the task.
2. The two memory indexes (15,126 tokens) stop loading whole. brain-recall
   already runs on every prompt and returns the top matches by meaning; it
   becomes the only way a memory enters context, capped at five notes.
3. A rule that has a check drops to one line naming the check. The check's
   refusal carries the full text when it fires.
4. Stack rules (TypeScript, naming, design, deploy) load from `stack-rules`
   when the files touched call for them.
5. A hard cap: `context-budget --max` fails when a first turn passes the cap,
   and doctor runs it on the newest session. Start the cap at today's number
   and lower it as each step lands.

Expected: about 15,000 from the indexes, 2,300 from typescript and naming,
and roughly 3,000 from enforced-rule prose, so about 20,000 of 98,000 the kit
controls. The skill list (8,800) and MCP instructions (3,500) are the host's
and the person's plugin choices; measuring them is in scope, removing them is
Caleb's call.

## What would prove this wrong

- A later session where a rule that was cut to one line gets broken and its
  check did not fire. Then the check is incomplete and the prose goes back
  until it is fixed.
- brain-recall missing a memory a task needed. Its sealed eval
  (`reference_brain_rerank_bench`) is the gate: the indexes stop loading only
  if recall holds on that set.
