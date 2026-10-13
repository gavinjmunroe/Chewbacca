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
- Native through the MCP: through the bare npx server, `open_binary` on
  universal /usr/bin/uuidgen said ok and every read after it failed with
  Ghidra's `architecture_unsupported`. Through `chewbacca rea mcp` the same
  call read the thinned slice in 8.5 s, and `open_binary` on
  /Applications/Cardhop.app mapped 20,985 functions and 26,193 strings in
  266 s (2026-10-13). Hopper and IDA are not installed.

## How to run it

Start with `chewbacca rea`. It holds the scoping, thinning and deadlines that
the raw tool gets wrong on a Mac, and it works, or says why not, whether REA
is installed or not.

- `chewbacca rea status`: installed, pinned version, which agents have the
  MCP, and whether native analysis works here.
- `chewbacca rea scope <App.app|app.asar|dir> "<seed>"`: extracts the ASAR,
  keeps the files holding the seed plus the preloads, runs REA on those under
  a deadline, prints the contextBridge and IPC counts and the Evidence path.
  Files over 1 MB come back as `read_these`: grep and read them by hand.
  Claude.app with seed `openExternal`: 12 s, 2 files, 23 contextBridge APIs;
  the whole app died at file 8 of 427.
- `chewbacca rea native <binary|App.app>`: thins the universal Mach-O to the
  host slice and runs the Ghidra overview with its env set. Ghidra refuses
  every universal binary, which is every app on a Mac; thinned, Cardhop's
  8.6 MB binary mapped 20,979 functions in 4 min 13 s.
- `chewbacca rea install`: a pinned local copy of rea-agents under
  ~/.chewbacca/rea/pkg, then `wire`. The MCP answers initialize in 0.9 to
  1.1 s from it, against 1.3 to 1.7 s through npx with a warm cache and 4.0 s
  cold, and it boots with no registry.
- `chewbacca rea wire --apply`: points the rea MCP entries in Claude Code and
  Codex at `chewbacca rea mcp`, the proxy in front of REA. It finds Ghidra and
  JDK 21 at launch, hands `open_binary` the host's slice of a universal binary
  or of an `.app` bundle's executable, and kills REA's whole process tree,
  Ghidra's JVM included, when a call passes 900 s, a cancelled call passes
  30 s, or the agent goes away. So over the MCP, open the app or binary
  itself; there is no thinned path to copy across.

Then:

1. Start from one question and one seed: a visible string, an API name, a
   channel, a URL. Never "analyze the whole app".
2. Try plain reading first: if grepping the bundle for the seed answers it,
   stop. A creator's test cloned one feature in 5 minutes without REA and 27
   with it, and the plain one was better.
3. Read summary-first: over MCP pass `detail: "summary"` and page with
   `inspect_analysis_view` by the parent Evidence ID. Never paste a full
   result into context; two scoped Claude.app files were 41 MB of Evidence.
4. When channels are dynamic (Claude.app: 1,333 of 1,340), take REA's line
   and column and read the minified source there, the way the Notion case
   study does.
5. Websites: don't run REA's static analyzer on a site's chunks. The 39
   Next.js chunks of uselemma.ai (1.6 MB) timed out at 6 min 40 s with 4
   parsed and left a worker running; grep found the same three `/api/` routes
   in 0.02 s. For a live click's request, REA's CDP capture (start Chrome with
   a throwaway profile and a debug port in the background, then
   `list-browser-targets` and `inspect-web-page --observation-ms 10000
   --include-json-body-shapes`) can feed api-anything, but api-anything's own
   capture does that job first.
6. Runtime tools (Electron/Node inspector, process capture, LLDB, Frida, adb)
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
