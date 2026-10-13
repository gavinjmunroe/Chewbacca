---
name: reference-rea-reverse-engineering
description: "REA (rea-agents 6.4.0) is the rea MCP in Claude Code and Codex, behind `chewbacca rea mcp` since 10/13: native works over MCP (Cardhop 20,985 functions); whole big ASARs fail; grep beats it on websites."
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

On websites grep wins: 3 of 3 of api-anything's open questions in 0.2 to 0.6 s,
against 16 s and 0 values extracted for REA's browser tools.

Use it for one scoped feature at a time. Breaking changes land almost daily,
so keep the pin. How to run it: [[reverse-engineering]] skill. Full report:
`~/.chewbacca/overnight/rea-research-report.md`.
