---
name: reverse-engineering
description: "Find out how a shipped app, extension, site or binary does one thing, with REA (rea-agents MCP and CLI). Use for how does <app> do X, trace this button, what request does this click make, decompile, Electron, ASAR."
triggers: >-
  Find out how a shipped program does one specific thing when its source is not available: an Electron or desktop app, a VS Code extension, a website, an Android APK, a .NET assembly or a native binary. Use when asked how an app implements a feature, to trace a button or a click to its code, what request a page makes, to decompile or disassemble something, to inspect an app.asar, to compare two versions of an app, or to study how another agent app draws a permission ask, a diff or a running agent. Also fires on: reverse engineer, REA, rea-agents, Ghidra, Hopper, IDA, JADX, decompile, disassemble, app.asar, IPC channel, preload, how does Cursor, how does Claude.app.
---

# Reverse engineering with REA

REA (`rea-agents`, MIT, github.com/morluto/rea) is the `rea` MCP server in
Claude Code and Codex, pinned to 6.4.0 and booted through `chewbacca rea mcp`,
plus the upstream skill `reverse-engineer-anything`. This file is the
operator's guide: which tool answers which question, with what arguments, and
how long it took on this Mac.

Measurements: `~/.chewbacca/overnight/d1013/REPORT-rea-redo.md` (2026-10-13,
load 17 to 40). Earlier research: `~/.chewbacca/overnight/rea-research-report.md`.

## Drive it through the MCP, not the CLI

Every failure we blamed on REA on 10/12 came from the CLI. The CLI returns the
whole Evidence record inline and keeps nothing between commands, so a big app
fills memory and a trace has nothing to trace. The MCP keeps the analysis in
the session and hands back a summary plus a `parent_evidence_id`.

Same Claude.app, same REA 6.4.0:

- CLI, defaults: died at file 8 of 427 after 4.5 min, 98 MB error JSON, hung
  until killed at 12.5 min.
- MCP, `detail: "summary"`, `integrity_policy: "record-and-continue"`,
  `max_heap_mb: 4096`, `analysis_timeout_ms: 120000`: finished in 5 min, 408
  of 427 parsed, nothing hung or leaked.

uselemma.ai's Next.js chunks: CLI 4 of 39 parsed in 6 min 40 s; MCP 38 of 38
in 106 s.

## Which tool answers which question

| Question                                                                  | Tool and arguments                                                                                                                                                                                 | Time here                                                                                  | Grep instead?                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What's in this Electron app: windows, preload bridges, IPC, sender checks | `analyze_javascript_application` on the `app.asar`, `detail: "summary"`, `integrity_policy: "record-and-continue"`, `max_heap_mb: 4096`                                                            | Claude.app 5 min: 14 windows, 52 bridge APIs, 1,508 IPC ops (10 literal), 63 sender checks | Grep can't tell an IPC channel from an EventEmitter `.on("error")`                                                                                                 |
| How one IPC channel reaches its window and main side                      | Scope to the files holding the channel, `analyze_javascript_application` (summary), then `trace_application_feature` with `seed: {kind: "channel", value, match: "contains"}`, `direction: "both"` | 3 files: 14 s total                                                                        | Grep finds the files; REA tied Claude.app's LocalExecConsent channel to its BrowserWindow (sandbox, contextIsolation on, nodeIntegration off) at a line and column |
| Which fetch a bundle makes, at what column                                | Scope to the chunk, analyze, then `trace_javascript_semantics` with `seed: {kind: "endpoint", value}`, `direction: "backward-provenance"`                                                          | 1 chunk: 11 s                                                                              | Usually no: grep shows the same call and its body                                                                                                                  |
| What requests a page really sends, in what order, on a click              | `capture_browser_scenario`, `browser: {mode: "launch", executable_path: <chrome-headless-shell>, headless: true}`, actions `goto`/`click`/`wait_for_timeout`, `capture: {events: ["network"]}`     | 6.6 s                                                                                      | Yes, it answers what grep can't: see below                                                                                                                         |
| Routes and endpoints in a live page's loaded scripts                      | Start the Playwright headless shell with a debug port in the background, `list_browser_targets`, then `analyze_web_bundle` with `observation_ms: 2000`                                      | 10 s, 121 scripts                                                                          | Close call. It dropped grep's fake hit but missed PostHog's paths and mislabels `x.get("age")` as an endpoint                                                      |
| Read a HAR someone saved                                                  | `inspect_web_network_capture`, `format: "har"`                                                                                                                                                     | not timed                                                                                  | n/a                                                                                                                                                                |
| Which native function uses this string                                    | `open_binary` on the binary or `.app` (the proxy thins it), then `trace_feature` with `query`, then `close_binary`                                                                                 | uuidgen: 11 s; Cardhop open: 266 s                                                         | Yes: `strings` can't say which function references it                                                                                                              |
| One native function's code                                                | `open_binary`, `search_procedures` or `trace_feature`, then `analyze_function` / `procedure_pseudo_code`                                                                                           | not timed here; the open is the slow part (Cardhop 266 s) | n/a                                                                                                                                                                |

## The four rules that decide whether it works

1. **Inventory whole, trace scoped.** The whole-app graph keeps relationships
   for only 29 of Claude.app's 427 files (398 hit the result budget, keeping
   static facts only), so every seed traced on it came back `no-match`. Grep
   the bundle for the seed, copy those few files plus `package.json` into a
   scratch dir keeping their paths, and analyze that. `chewbacca rea scope`
   does the copy and prints the two MCP calls (`mcp_next`) to run next.
2. **Summary first, then pages.** Pass `detail: "summary"` and read further
   with `inspect_analysis_view` on the `parent_evidence_id`. On a whole-app
   graph every view repeats about 680 KB of limitations, more than a client
   shows; page modules 8 at a time and save the file the client writes.
3. **Narrow every semantic trace.** A 403 KB Claude Code UI chunk hit REA's
   100,000-node semantic ceiling, and a forward trace from one property came
   back over the 10 MB MCP response cap. Seed an endpoint, literal or channel,
   set a direction, and add `allowed_relations` when the first try overflows.
4. **Headless only.** `capture_browser_scenario` with `mode: "launch"` and
   `headless: true` opens no window. Use Playwright's `chrome-headless-shell`
   (`~/Library/Caches/ms-playwright/chromium_headless_shell-*/`), never the
   user's Chrome. Kill any headless shell you started for `analyze_web_bundle`.
   Locators must match one element: `a[href='/careers']` matched 4 and failed;
   `header a[href='/careers']` worked.

## What the live click showed that grep couldn't

On uselemma.ai, grep listed six `/api/` strings. The live capture showed
which requests actually go out: the page, a PostHog relay under
`/relay-fgLF/` (a POST to `flags`), a Next.js prefetch of
`/careers?_rsc=...`, and Google Analytics. Clicking Careers sent nothing
new, because the prefetch had already loaded it. `/api/agent` is a string in
a demo trace span and is never called. Use the capture when the question is
"what does this page send", and feed the request shapes to api-anything.

## When grep or api-anything is still the right call

- Finding which file holds a string: grep, 0.02 to 0.3 s on 195 MB.
- Listing route strings or reading one fetch's body: grep plus reading the
  minified source at the column.
- Getting data out of a site again and again: api-anything. REA observes; it
  doesn't build a replayable operation.
- Dynamic IPC names (Claude.app: 1,497 of 1,508): REA reports them as
  unknown. Read the source at its line and column, as the Notion showcase does.
- A simple clone: a creator's test took 27 min with REA and 5 without.

## Setup checks

- `chewbacca rea status`: installed, pin, which agents have the MCP, native
  readiness. Ghidra and JDK 21 are found at launch by the proxy.
- The proxy kills REA's whole tree, Ghidra's JVM included, at 900 s per call,
  30 s after a cancel, or when the agent exits. After a long run,
  `ps -axo pid,command | grep rea.mjs` should show only the live servers.
- Codesigned Mac apps need `integrity_policy: "record-and-continue"`: the
  default refuses Claude.app in 4.8 s because signing rewrites its native
  addons after the ASAR hashes were taken.
- Hopper and IDA aren't installed; Ghidra covers native.

## Limits to say out loud

- Breaking changes land almost daily (4.0 to 6.4 between Oct 5 and Oct 11).
  Keep the pin; saved Evidence from another minor won't validate.
- Results are large; the token bill is usually the real cost.
- Static analysis can't prove what runs. Report REA's unknowns as unknowns,
  and check `endpoint` hits: `t.get("kind")` came back as a network endpoint.
- Runtime tools (Electron inspector, process capture, LLDB, Frida, adb) run or
  touch the real program with the user's permissions. Use them only on a
  target the user named.

## The line

Inspect to learn the mechanism, then build ours from scratch. Never copy
protected code or assets into a product, never bypass DRM, license checks or
anti-cheat, and never put another company's internals into client-facing
copy. REA's DISCLAIMER.md refuses the same list.
