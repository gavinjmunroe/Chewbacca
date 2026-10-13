---
name: reference-rea-reverse-engineering
description: "REA (rea-agents 6.4.0) is the rea MCP in Claude Code and Codex: traces one feature through shipped apps; whole big ASARs fail, native needs GHIDRA_INSTALL_DIR in its env."
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
wrote a 98 MB error JSON and the CLI hung (upstream #2290). Ghidra 12.1.4 and
JDK 21 are installed and pass `rea doctor`, but the MCP entry has no
`GHIDRA_INSTALL_DIR`, so native tools report provider_missing. No Hopper or IDA.

Use it for one scoped feature at a time. Breaking changes land almost daily,
so keep the pin. How to run it: [[reverse-engineering]] skill. Full report:
`~/.chewbacca/overnight/rea-research-report.md`.
