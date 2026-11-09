---
name: reference-rea-reverse-engineering
description: "REA (rea-agents 6.4.0) is the rea MCP in Claude Code and Codex, behind `chewbacca rea mcp` since 10/13: drive it through the MCP with detail summary, never the CLI; inventory whole, trace scoped; its live headless click capture beats grep for what a page sends."
metadata:
  type: reference
---

REA, Reverse Engineer Anything (github.com/morluto/rea, npm `rea-agents`, MIT,
rea.tools), installed 2026-10-12 as the `rea` MCP server in Claude Code and
Codex, pinned to 6.4.0. 170 MCP tools, 127 CLI commands, every result an
Evidence record with coverage and named unknowns.

Measured on 2026-10-12: a 6-file Electron example ran in 4.3 s; Claude.app's
44 MB app.asar was refused by default (integrity mismatch on signed addons),
and with `--integrity-policy record-and-continue` it died at file 8 of 427,
wrote a 98 MB error JSON and the CLI hung (upstream #2290). No Hopper or IDA.

Since 2026-10-13 both agents launch it as `chewbacca rea mcp`: a pinned local
copy (~/.chewbacca/rea/pkg/6.4.0, no npx) behind a proxy that hands Ghidra the
host's slice of a universal binary and kills REA's whole process tree at a
900 s call deadline. Through it, `open_binary` on /Applications/Cardhop.app
mapped 20,985 functions in 266 s; through the bare MCP every native read on a
universal binary failed. REA starts Ghidra's JVM in its own process group, so
a group kill alone leaves it running: kill the tree.

On websites grep wins for finding a string: 3 of 3 of api-anything's open
questions in 0.2 to 0.6 s, against 16 s and 0 values for REA's browser tools.

Corrected 2026-10-13: the whole-app failures were the CLI, not REA. Through the
MCP with `detail: "summary"`, `record-and-continue` and a 4096 MB heap,
Claude.app parsed 408 of 427 files in 5 min with nothing hung, and uselemma.ai's
Next.js chunks 38 of 38 in 106 s (the CLI: 4 of 39 in 6 min 40 s). But the
whole-app graph keeps relationships for only 29 files, so traces need a scoped
tree of a few files (11 to 14 s). `capture_browser_scenario`, launched headless,
showed in 6.6 s which requests a page really sends, which grep can't.
Redo report: `~/.chewbacca/overnight/d1013/REPORT-rea-redo.md`.

Use it for one scoped feature at a time. Breaking changes land almost daily,
so keep the pin. How to run it: [[reverse-engineering]] skill. Full report:
`~/.chewbacca/overnight/rea-research-report.md`.
