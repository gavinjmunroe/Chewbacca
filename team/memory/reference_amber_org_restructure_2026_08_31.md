---
name: reference-amber-org-restructure-2026-08-31
description: "Where every Amber/Medha/Togari repo lives after the org split and the 2026-09-03 local cleanup: 16 live clones, 30 archived, and the backup repos holding 269 rescued commits."
metadata:
  node_type: memory
  type: reference
  originSessionId: d3122983-d929-4866-b78a-c893685122fc
  modified: 2026-09-03T00:00:00.000Z
---

`amber-organization` is gone. Some old clone URLs still fetch because GitHub
follows the transfer redirect; most 404. Cleaned up locally 2026-09-03.

**Live remotes.** `amberintelligence`: amber-id, amber-ios, amber-sandbox,
amber-search, amber-website. `bluemodernadvisory`: togari-sandbox, bma-website,
claude-context. `rytualhealth`: rytual-website. Plus `calebnewtonusc/silo`,
`amber-caleb`, `amber-phone-call`, `medha-slack-mirror`, and
`karthikBMA/TogariMCP`.

**Gone since the 8/31 note:** `amberintelligence/amber-mcp` (so `medha-platform`
and `medha-imessage` lost their real remote) and
`amber-organization/peoplerank-sandbox`. **New:**
`amberintelligence/amber-search`, which is where `togari-search` and
`togari-peoplerank` were transferred, so `feat/peoplerank-v2` does still have a
remote.

**Sagar folded whole projects into `amber-sandbox`** as `domains/`: clearout,
knowledge-graph (extracted from amber-id), messaging (messages2 + messages2kit),
peoplerank, tizzy. Its README calls it "Sagar's founder lab, nothing here is
user-facing." That was a fold-in, so per-repo history survives only in the
archive.

## Local layout after 2026-09-03 (all under `~/code/`)

`amber-ios`, `amber-sandbox`, `amber-search`, `rytual-website`, `openvision`,
`silo`, `amber-phone-call`, `medha-slack-mirror`, `TogariMCP` at top level;
`bma/` holds bma-website, claude-context, togari-gtm-os, togari-dedup.

**`projects/medha/` keeps its stale name on purpose.** It holds `medha-id`
(= amber-id), `medha-frontend` (= amber-website), `medha-platform` and
`medha-imessage` (both = amber-caleb). Roughly **90 git worktrees** live in
`projects/medha/.worktrees/` and as siblings, with absolute gitdir paths, so
renaming that directory breaks all of them. Leave it. `git worktree repair`
fixes paths if a move ever becomes worth it.

## Backups holding work that exists nowhere else

269 commits were sitting on local branches with no remote. All pushed 9/3:

| Repo                              | Holds                                            |
| --------------------------------- | ------------------------------------------------ |
| `calebnewtonusc/togari-gtm-os`    | Togari GTM OS, unified MCP server, 48 commits    |
| `calebnewtonusc/togari-dedup`     | dedup engine + Chrome extension, 17 branches     |
| `calebnewtonusc/amber-id-wip`     | 118 worktree branches off amber-id               |
| `calebnewtonusc/amber-website-wip`| 32 branches off amber-website                    |
| `calebnewtonusc/amber-ios-wip`    | 27 branches off amber-ios                        |
| `calebnewtonusc/amber-archive-wip`| never-pushed branches from deleted repos         |
| `calebnewtonusc/amber-caleb`      | all medha-platform + medha-imessage branches     |

The `-wip` repos exist so the shared org repos do not get 170 branches dumped
into them. Push a branch to the real remote when it is actually ready.

**30 clones whose remote is dead** are at
`_Archive/amber-restructure-2026-09-03/` (511M after gc, build dirs stripped).
Their history exists nowhere else: **do not delete.**

## The trap that cost a re-do

`git fetch --all` fails if **any** remote 404s, so a repo with one dead remote
and one live remote looks dead. That is how `medha-frontend`, `medha-platform`,
and `medha-imessage` got archived by mistake, and `medha-platform` had 171
commits that existed only on this machine. **Check every remote, and every
branch, not just origin and HEAD.**

Also unresolved: nobody said why `amber-mcp` disappeared. `amber-caleb` is
Caleb's personal mirror, not a replacement for it. Worth asking Sagar.

Related: [[project_amber_vision]], [[project_medha_togari_split]],
a private note, a private note.
