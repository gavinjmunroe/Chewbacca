---
name: reverse-engineering
description: "Find out how a shipped app, extension, site or binary does one thing, with REA (rea-agents MCP and CLI). Use for how does <app> do X, trace this button, what request does this click make, decompile, Electron, ASAR."
triggers: >-
  Find out how a shipped program does one specific thing when its source is not available: an Electron or desktop app, a VS Code extension, a website, an Android APK, a .NET assembly or a native binary. Use when asked how an app implements a feature, to trace a button or a click to its code, what request a page makes, to decompile or disassemble something, to inspect an app.asar, to compare two versions of an app, or to study how another agent app draws a permission ask, a diff or a running agent. Also fires on: reverse engineer, REA, rea-agents, Ghidra, Hopper, IDA, JADX, decompile, disassemble, app.asar, IPC channel, preload, how does Cursor, how does Claude.app.
---

# Reverse engineering with REA

REA (`rea-agents`, MIT, github.com/morluto/rea) is installed as the `rea` MCP
server in Claude Code and Codex, pinned to 6.4.0, plus the upstream skill
`reverse-engineer-anything`. Read that skill for tool routing. This one holds
what was measured on this Mac and the limits that decide whether to use it.

Full research: `~/.chewbacca/overnight/rea-research-report.md` (2026-10-12).

## What it is good for

One feature, traced through shipped bytes, with every claim tied to a file,
line and column or an address. The case studies that hold up are all small:
an Electron export through preload, IPC and main handler; one native function
plus its callers and constants; a browser click to its request and script.

## What was measured here

- The 6-file Notes example: 4.3 s, 393 KB of Evidence, IPC channel paired to
  its handler.
- Claude.app's app.asar (44 MB, 427 JS files): refused by default
  (`artifact_integrity_mismatch`, codesigned native addons). With
  `--integrity-policy record-and-continue` it died at file 8 of 427 after
  about 4.5 minutes, wrote a 98 MB error JSON, and the CLI never exited
  (upstream issue #2290). What it did see: 100 IPC operations, 99 of them
  with computed channel names, so literal pairing found nothing.
- MCP `binary_session` returned 227,158 characters, over the client limit.
- Native: Ghidra 12.1.4 and JDK 21 pass `rea doctor --provider ghidra`, but
  the MCP registration has no `GHIDRA_INSTALL_DIR`, so every native tool
  reports provider_missing until that env is added to the `rea` entry.
  Hopper and IDA are not installed.

## How to run it

1. Start from one question and one seed: a visible string, an API name, a
   channel, a URL. Never "analyze the whole app".
2. Try plain reading first: if grepping the bundle for the seed answers it,
   stop. A creator's test cloned one feature in 5 minutes without REA and 27
   with it, and the plain one was better.
3. Scope before analyzing, since 6.4.0 has no file selector, so extract the ASAR
   (`npx -y @electron/asar extract <app.asar> <dir>`), grep for the seed, copy
   the matching bundle and its preload into a small directory, and analyze
   that. VS Code extensions are plain folders under `~/.vscode/extensions`.
4. Codesigned Mac apps need `--integrity-policy record-and-continue`.
5. Read summary-first: over MCP pass `detail: "summary"` and page with
   `inspect_analysis_view` by the parent Evidence ID. Never paste a full
   result into context.
6. When channels are dynamic, take REA's line and column and read the
   minified source there, the way the Notion case study does.
7. Put a deadline on every CLI call, because it can hang after a failure.
   GNU `timeout` is not on this Mac:
   `perl -e 'alarm shift; exec @ARGV' 600 npx -y rea-agents@6.4.0 ...`.
   Anything over a few files goes through `chewbacca jobs submit --heavy`.
8. Web: start Chrome with a throwaway profile and a debug port, opened in the
   background, then `list-browser-targets` and `inspect-web-page
--observation-ms 10000 --include-json-body-shapes` around one click. Hand
   the request shape to api-anything.
9. Runtime tools (Electron/Node inspector, process capture, LLDB, Frida, adb)
   run or touch the real program with Caleb's permissions. REA's own security
   page says it is not a sandbox. Use them only on a target he named.

## Limits to say out loud

- Breaking changes land almost daily (4.0 to 6.4 between Oct 5 and Oct 11).
  Keep the pin; saved Evidence from another minor will not validate.
- Results are large. The token bill, not the analysis, is usually the cost.
- Static analysis cannot prove what runs; computed names and obfuscation stay
  unknown, and REA says so. Report its unknowns as unknowns.
- The star count (42 on Oct 2, 155K on Oct 12) is not evidence of quality.

## The line

Inspect to learn the mechanism, then build ours from scratch. Never copy
protected code or assets into Caleb's or a client's product, never bypass DRM,
license checks or anti-cheat, and never put another company's internals into
client-facing copy. REA's DISCLAIMER.md refuses the same list.
