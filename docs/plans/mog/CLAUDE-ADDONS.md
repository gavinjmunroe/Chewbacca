# Claude Code add-ons: competitive teardown (2026-10-10)

Covers 8 products. Marks: [read] = fetched in full or via gh API; [snippet] = search result only.
Repo stats via `gh api` on 2026-10-10. Chewbacca repo is private, no .claude-plugin dir, remote is gavin fork.
Chewbacca counts today: 63 files in .claude/hooks, 190 in bin, 69 skills, 327 tests.

## 1. noisy-studio (github.com/noisy/noisy-studio; "noisy-coding" is not a repo name)
Stars 12, MIT, last push 2026-10-06, 112 open issues (mostly a Windows port epic and a mobile app), 3.0.0-beta.2. [read: README, docs/hooks.md, releases, issues]
- Best: one voice daemon shared by many agent tabs, with identity that cannot be spoofed. Hooks (SessionStart, UserPromptSubmit, PreToolUse, Stop, SessionEnd) register each session in an inbox; PreToolUse binds any speech tool call to the session's trusted ID, so a reply is spoken for the right tab and a conflicting identity is refused rather than routed to someone else's tab. Routing key is session ID, never label or transcript path. Hooks never launch audio; the desktop app owns capture and playback. If the app is down, hooks fail open so coding is not broken.
- Bar: installs in 2 commands (`claude plugin marketplace add noisy/noisy-studio`, `claude plugin install noisy-studio@noisy`) plus a signed .app download. Per-conversation voice and character. Chewbacca must install in at most that.
- Counterpart: bin/hud-speak (Kokoro, kept warm), bin/hud-listen, tools/tabs.py (`tabs`), .claude/hooks/voice-guard.sh. Partial: Chewbacca has the board and the voice but no PreToolUse step that binds a spoken line to a session ID.
- Steal: session-ID-bound speech routing and fail-open hook launcher. License MIT.
- Test: start 3 tabs, speak a line from tab B while tab A is foreground; assert audio carries B's voice and `tabs` shows B spoke; kill the daemon and assert a Bash call in tab A still succeeds.

## 2. claude-voice-multiplexer (n33kos)
Stars 0, no license file (license null, so do not copy code), last push 2026-10-07 (v5.1.0), 0 open issues, 1 fork. [read: README]
- Best: phone-to-many-sessions voice. `vmuxd` launchd daemon supervises Whisper, Kokoro, LiveKit, relay with health checks and exponential-backoff restarts; spawns each Claude session in a named tmux window; voice text is injected by tmux send-keys. Session health states standby/active/zombie (alive tmux, relay heartbeat stale over 90s)/dead, checked every 30s. v5.1 adds per-session TTS voice stored in SQLite (about 0.2 ms lookup).
- Bar: heartbeat staleness 90s and 30s health poll; spawn-to-registered under 60s timeout.
- Counterpart: tools/tabs.py + bin/hud-speak. No zombie detection found by name; no phone voice path (bin/phone-mirror is a GitHub-mirror route, not live voice).
- Steal: the zombie state (process alive, no heartbeat) for `tabs`. License: none, so reimplement the idea only.
- Test: SIGSTOP a registered tab's process and assert `tabs list` shows it zombie within 90s.

## 3. CallClaude (incidentfox/callclaude)
Stars 19, MIT, last push 2026-04-07, 0 issues, 3 forks. [read: README]
- Best: call a phone number and manage local Claude sessions. Retell AI does STT and picks tools; ngrok to a bridge server; `claude-sessions` finds the right Terminal.app tab by tty path, injects keystrokes via AppleScript, and watches the session JSONL with kqueue for the reply. Phone allowlist plus API secret. Commands: list, read -n, send -w, fork, start, kill.
- Bar: install is one pasted sentence that has Claude clone, read CLAUDE.md, run setup.sh and walk the user through; needs tmux, ngrok, Retell account. Sessions run with --dangerously-skip-permissions (their stated tradeoff).
- Counterpart: `tabs` (list, note, register) covers read-state; cross-session send and fork: none found. bin/phone-mirror is not equivalent.
- Steal: "send and wait for reply" by tailing the session JSONL with kqueue instead of screen scraping. License MIT.
- Test: `tabs send <tab> "pwd" --wait` returns the reply text from the JSONL in under 5s without touching the window.

## 4. call-me (ZeframLou/call-me)
Stars 2,645 (highest in this set bar OpenClaw), forks 261, no license file, last push 2026-04-07 (v1.0.3), 18 open issues. [read: README, issues]
- Best: Claude phones you when done, stuck, or needing a decision, then holds a multi-turn conversation and can use tools mid-call. Plugin MCP server + ngrok tunnel + Telnyx/Twilio + OpenAI STT/TTS (Kokoro option). Defaults: silence 800 ms ends speech, 3 min transcript timeout, port 0 auto.
- Bar bites: setup needs 3 accounts (phone provider, OpenAI key, ngrok) and 7 env vars. Top issues are exactly that pain: Twilio auth errors (6 comments), "marketplace installation method -> no tools?", ngrok free-tier detection, request for Cloudflare Tunnels. Users want fewer accounts. Stars say the pitch ("start a task, walk away, your watch rings") is what sells.
- Counterpart: none for outbound phone call. Nearest: bin/hud-speak for local voice, `mac messages send` for text.
- Steal: the trigger vocabulary (done, stuck, needs decision) as three notify events, delivered by iMessage to Caleb's own number with no new accounts, which beats their 3 accounts. License none: idea only.
- Test: on a stuck long task, Caleb's phone gets a text with the question within 30s and replying resumes the task, with zero setup beyond what is installed.

## 5. groundtruth (vnmoorthy/groundtruth)
Stars 7, MIT, last push 2026-07-20 (v0.1.13), 2 open issues. [read: README, issues]
- Best: a Stop hook that refuses "done" without evidence in the same turn. Reads stdin (last_assistant_message, transcript_path, stop_hook_active); detector has 8 claim frames and 21 exclusion patterns; verifier recognizes 80+ command fragments (tests, typecheck, build, curl 2xx, Read/Grep of written symbol); returns {"decision":"block","reason"}; checks stop_hook_active first to avoid loops. Calibrated on 1,272 real turns, false positives 30 to 0-1 across 3 releases. Also `groundtruth audit` replays past sessions (text/JSON/SARIF) and a memory gate that rejects MEMORY.md writes containing unverified completion claims. 153 tests, audits 1k turns in 27 ms, zero network calls.
- Bar: 8 frames / 21 exclusions / 80+ verifier fragments / 1,272-turn corpus / 153 tests / 0 FP on corpus.
- Counterpart: partial only. .claude/hooks/agent-claim-guard.sh (claims of background work), handoff-guard.sh, scope-guard.sh, suite-rerun-guard.sh. No hook found that gates a general "done/fixed/tests pass" claim against same-turn evidence, no retroactive audit command, no memory-write claim gate.
- Steal: (1) general completion-claim Stop gate; (2) `audit` over ~/.claude/projects JSONL to produce a measured false-positive rate; (3) memory gate. MIT, safe to port with attribution.
- Test: replay groundtruth's fixtures (unverified-claim should give 3 findings, terse-closer 1, checklist 2, verified-claim 0) through Chewbacca's gate and match them, then run on Caleb's own corpus and report FP rate beside their 0-1 on 1,272.

## 6. No Excuses (hunted.space/product/no-excuses)
13 upvotes, 10 comments, not featured; no repo link on the page, maker appears to be "reda ayman"; GitHub search for no-excuses found no matching repo. Price not stated. [read: hunted.space page only; repo not found]
- Best: six Node hooks sold on one idea, exit codes cannot be argued with: finish-gate (runs the test suite on Stop, blocks if red), task-gate (no quitting with unfinished steps), rule-guard (rm -rf, force-push, .env edits), read-guard (token waste), context-keeper (memory across compaction), audit-guard (secret leaks). Claims zero dependencies, Windows support, 2 minute install.
- Bar: 6 hooks, 2 minute install. Chewbacca has 63 hook files, so count is not the gap; the gap is presenting them as one named, installable bundle.
- Counterpart: destructive-guard.sh, env-guard.sh, suite-rerun-guard.sh, plan-guard.sh, stale-read-guard.sh, kit-debt.sh; context-keeper analogue: a context-keeper agent exists but no PreCompact hook found. finish-gate that actually runs tests on Stop: none found.
- Steal: finish-gate (Stop runs the project's test command and blocks on red). No license visible; idea only.
- Test: seed a failing test, ask "fix and say done"; Chewbacca blocks the stop and the tab's next turn runs the test.

## 7. OpenClaw (github.com/openclaw/openclaw, docs.openclaw.ai)
Stars 391,602, forks 82,323, MIT, 9,407 open issues, created 2025-11-24, last push 2026-10-10, release 2026.9.9 on 2026-10-08. [read: README, why-openclaw page, issue list]
- Best: one local Gateway control plane that puts the assistant in 20+ chat channels (iMessage, WhatsApp, Slack, Telegram...) with state and memory on your hardware, plus a plugin ecosystem (ClawHub) with per-release trust verdicts and scans. Mechanics: curl one-liner installer that provisions Node and starts onboarding (`openclaw onboard --install-daemon`); DM pairing by default (`openclaw pairing approve <channel> <code>`) so unknown senders are untrusted; plugins.allow pins permitted plugins; manifests validated before runtime code imports; `openclaw memory forget`; telemetry limited to a daily version check.
- Top-voted issues (reaction counts 14, 12, 9, 8, 8): configurable streaming watchdog timeout, denylist for exec-approvals, theme studio, per-agent dreaming config, Telegram business bot. Users want control knobs over autonomy and approval, not more channels.
- Bar: 391k stars, one curl line, 1 onboarding wizard, 20+ channels. 9,407 open issues is the cost of breadth.
- Counterpart: bin/chewbacca-permissions, `chewbacca connect`, `people`, `chewbacca chat` (Synapse + 11 bridges per team memory), `chewbacca welcome`. No ClawHub-style signed skill registry and no pairing-code flow found.
- Steal: pairing-code approval for any inbound channel before it can instruct the agent (MIT), and plugin allowlist with pinned versions.
- Test: a text from an unknown number that says "run X" produces a pairing request and zero tool calls; an approved sender's text runs.

## 8. Anthropic Cowork plugins (claude.com/docs/cowork/guide/plugins)
First party docs. [read]
- Best: plugin = one package bundling skills, MCP connectors, subagents, commands, hooks, installed from a marketplace or any Git repo (owner/repo shorthand) with Check for updates or Sync automatically; installed plugins also appear in chat and Claude Code. Warns before an update overwrites local edits. Org admins can force-install required plugins.
- Bar: install is Customize > Plugins > Install, or Add marketplace with `owner/repo`. Limits: 200 MB per plugin, 5,000 files, 500 plugins per marketplace, 25 marketplaces, 512 MB repo archive. Chewbacca has 69 skills and 63 hooks, so packaging into plugins must respect 5,000 files.
- Counterpart: none. No .claude-plugin directory and no marketplace.json in the repo; install is setup.sh and `chewbacca agent setup`. Repo is private, so a Git marketplace add would fail for strangers.
- Steal: ship Chewbacca as a Git-repo marketplace of 3 to 5 plugins (gates, voice, tabs) so install matches noisy-studio's 2 commands. First party format, no license issue.
- Test: on a clean machine `claude plugin marketplace add <repo>` then `claude plugin install` yields a working Stop gate in under 2 minutes with no setup.sh.

## Summary
Count covered: 8 of 8. Not found: a public repo for No Excuses (page only).

Top 3 mechanisms to steal:
1. groundtruth: Stop gate on unverified completion claims, plus `audit` replay to measure FP rate on Caleb's own sessions (MIT). Biggest hole in Chewbacca's 63 hooks.
2. noisy-studio: session-ID-bound speech routing with fail-open hooks (MIT), so voice across `tabs` never speaks into the wrong tab.
3. Cowork/noisy-studio packaging: Git marketplace of plugins, 2-command install (first party format), because install friction is what call-me's issue list shows users hate and what Chewbacca currently lacks. Runner up: call-me's done/stuck/decision notify events delivered by iMessage.
