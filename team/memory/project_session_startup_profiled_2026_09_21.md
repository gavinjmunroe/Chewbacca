---
name: project_session_startup_profiled_2026_09_21
description: Session startup measured and cut on 2026-09-21; npx MCP boot 9.27s to 1.33s, brain-check 5.14s to 1.93s
metadata:
  type: project
---

Caleb said sessions took too long to load and that replies were slow. Measured
rather than guessed, on 2026-09-21.

**What was actually slow**

| Cost | Before | After |
| --- | --- | --- |
| 6 MCP servers spawned via `npx -y pkg@latest` | 9.27s | 1.33s |
| `brain-check.sh` on every SessionStart | 5.14s | 1.93s |
| `prompt-optimizer` MCP server, dead, dialed every start | removed | gone |
| 4 UserPromptSubmit hooks, per message | 0.42s | unchanged |

**The two fixes.** Every local MCP server now spawns by absolute path to
`node` plus the package's entry script, so startup never touches the npm
registry. All six were verified with a real `initialize` handshake, not just a
file-exists check. And `brain-check.sh` was running a full-repo `find` once per
unresolved wikilink: 282 candidates at 0.04s a walk. It now builds one filename
index with a single `os.walk`, byte-identical output.

**What was NOT the problem.** Always-on context is ~20,375 tokens across
CLAUDE.md, the four `core/` files and MEMORY.md, which is inside his own 28k
budget. Combining MCP servers behind a proxy would have made startup worse, not
better: the proxy still spawns every child, plus a hop.

**Why:** the absolute paths buy ~7x and cost silence. An `nvm` upgrade moves
`~/.nvm/versions/node/v22.20.0/bin/node` and all six servers die with no error
he would ever see.

**How to apply:** that silence is guarded. `doctor.sh` gained an "MCP servers"
section (chewbacca `a5ae9b1`) that resolves every local server command and each
`.js` argument, and warns separately if anything still routes through npx. Run
`./doctor.sh` after any node version change.

See [[feedback_timeout_is_missing_on_this_mac]], which is why the first pass at
this got the hook numbers wrong, and
[[project_chewbacca_installer_gutted_unresolved]].
