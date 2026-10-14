# MD diet

Chewbacca is mostly markdown nobody opens. This plan turns it into a smaller
kit where every remaining file is loaded by something, and every rule that
matters is a check that fails instead of a paragraph that gets skipped. Delete
this file when phase 6 lands.

## Baseline, measured 2026-10-14

`python3 tools/md_usage.py` (30 days of Claude Code transcripts, 7,073 sessions):

- 1,261 tracked `.md` files, 152,356 lines, against 2,227 non-md files
- 223 used at least once (read, Skill-invoked or slash-invoked), 1,038 never
- Skills: 28 of 71 invoked. graph-engineering's 145 calls are mostly the
  skill-gate hook forcing it, so treat that count as noise
- Slash commands: 1 of 57 used (`/ship`, 8 times)
- `team/memory`: 46 of 311 read. `team/tasks`: 2 of 206 read
- `apps/ux-engine`: 0 of 206 read, but its `systems/*/DESIGN.md` are corpus
  data parsed by `tools/index_md.py`, so they count as data, not docs
- `docs/plans`: 4 of 40 read. `docs/guide` 0/13, `docs/mac` 0/15
- `skills/diagram`: 0 of 59 (vendored upstream references)

Undercount caveat: reads through `cat` with a relative path and always-on
`@import` loads don't show as reads. Rules imported by `CLAUDE.md` are used
every session even at 0 reads.

## Rule for every file

A markdown file stays only if one of these is true:

1. A loader reads it: skill discovery, a slash command someone ran, an
   `@import`, or code that parses it (`index_md.py`, `backlog`, team board).
2. It's the README, CHANGELOG, CREDITS, LICENSE or AGENTS/CLAUDE entrypoint.
3. It was read by an agent or a person in the last 60 days.

Everything else goes to the `archive/pre-md-diet` tag and is `git rm`ed.
Git history keeps it, so nothing is lost and nothing needs a debate per file.

## Phases

Each phase lands on its own branch via `chewbacca land`, with the md_usage
number before and after in the commit message.

### 1. Tag and cut the obvious dead weight (target: -400 files)

- Tag `archive/pre-md-diet` on main before anything moves
- `.claude/commands`: delete the 56 unused; keep `ship`. Anything a skill
  already covers is a duplicate anyway
- `docs/plans`: keep the 4 read ones plus this file, drop 36
- `docs/superpowers`, `docs/handoffs`, `library/prompts`, `library/research`,
  `.github/ISSUE_TEMPLATE`, `plynn/docs` orphans: drop
- `team/tasks`: 206 md files are a database pretending to be docs. Move them
  into the team board store (one JSONL, `team` skill reads it), delete the md
- Acceptance: `bash tests/run.sh` green, `linkcheck.py` no new dead links

### 2. Skills: 71 down to about 30 (target: -150 files)

- Merge the 10 `mac-*` skills into one `mac` skill with a routing table
- Merge `video-edit`, `animated-video`, `creative-video`, `video-script`,
  `manim` into one `video` skill
- Vendored skills with 0 calls (`diagram` 59 files, `openspec`, `ponytail`,
  `rsi`, `reflect`, `screen-time`): drop, keep the UPSTREAM link in CREDITS
- The other 0-call skills: keep only if their description wins a routing test
  in `tests/` (held-out prompt routes to it). No test, no skill
- Acceptance: router eval precision does not drop (`hybrid_route_eval.py`)

### 3. Rules become checks (target: always-on context -50%)

The 15 files in `.claude/rules` (1,251 lines) load into every session. Most
paragraphs are an incident plus "never do X". For each paragraph:

- Mechanical rule (em dashes, `git add -A`, bare `git commit`, emojis in
  commits, `open` without `-g`, command in a final message): already a hook,
  or becomes one plus a test. Then cut the paragraph to one line naming the hook
- Judgment rule: stays, but as one sentence, with the incident moved into the
  test or hook comment where the constant lives
- Stack rules (`typescript`, `naming`, `design-system`, `spatial`) stop being
  always-on and load by path, like `stack-rules` already does
- Acceptance: `context_cost.py` shows the session-start token count before and
  after; every deleted paragraph maps to a named hook or test

### 4. team/memory: 311 down to what retrieval returns (target: -200 files)

- Run `memory_compact.py` against the 265 never-read notes
- Notes that say the same fact merge into one; notes about finished work
  (shipped, dead, dated events) collapse into one line in CHANGELOG
- Acceptance: `recall_gate.py` gold set recall unchanged

### 5. Data that's stored as md moves to data

- `apps/ux-engine/systems/*/DESIGN.md` and `library/api-sites`: keep, but move
  under `data/` so `md_usage` and humans stop counting them as docs
- `BACKLOG.md` (212 lines of tables): generate it from a JSON store the
  `backlog` CLI writes, so it stops being hand-edited prose

### 6. Gate so it doesn't grow back

- `tests/md_orphans.sh`: fails CI when a new `.md` is added with zero inbound
  refs and no loader. Escape hatch is adding it to an allowlist in the same PR
- `doctor.sh` prints the md_usage total weekly; warn when used/total drops
  under 50%
- Acceptance: the end-state target below holds for two straight weeks

## End state

- Under 400 md files, over 50% used in any 30 day window
- Always-on instructions under half of today's size
- Every "never do X" in a rule file points to the hook or test that enforces it

## Not in scope

- `second-brain` content (private, separate repo)
- Rewriting what stays. This plan only cuts, merges and converts
