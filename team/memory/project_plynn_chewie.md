---
name: project_plynn_chewie
description: "Plynn is Caleb's dictation app (fn types, Option asks Chewie). Chewie routes voice to Claude Code with a warm session, ~5s. Every silent failure it has had is recorded here, including the dead CGEventTap of 2026-09-17: no plynn: log line at all means the tap, not the mic."
metadata:
  node_type: memory
  type: project
---

**Plynn** is a macOS dictation app, bundle `co.charmtechnologies.plynn.spike`.
Upstream is `31Carlton7/plynn` (Carlton Aikins, pull access only).

**The source now lives at `~/code/chewbacca/plynn` and has
no `.git` of its own**: its 99 files are tracked inside Chewbacca. The old
standalone repo was trashed 2026-09-04 and **`calebnewtonusc/plynn` no longer
exists on GitHub** (checked 2026-09-15, 404). Its 92 commits, the `macos15`
branch and the v0.1.8/v0.1.9 tags survive only as a verified bundle at
`~/code/archive/2026-code-root/_archives/plynn-history-through-20260904.bundle`. Restore
with `git clone <bundle>`. Do not empty the Trash expecting to still have it.

## The two keys, settled 2026-09-04

**fn types. Either Option asks Chewie.** The key is the router, not a wake
word: a wake word had to be heard correctly, needed a boundary check so
"Chewy's bowl is empty" did not reach an agent, and made ordinary dictation
risk a slow round trip. Saying "Chewie" on the Option key is still stripped.

`option` deliberately shares a keycode with `rightOption`, so `rightOption` is
no longer offered as a dictation trigger. See `HotkeyTrigger.selectable`.

Chewie's answer is **shown on the pill and copied**, never typed. Ordinary
dictation pastes at the cursor and is blocked only by a secure field.

## Speed, measured not guessed

| Setup                                         | Time     |
| --------------------------------------------- | -------- |
| cold `claude -p`, CLAUDE.md loaded            | 26.0s    |
| warm session, CLAUDE.md loaded                | 18.0s    |
| cold, bare cwd + replaced system prompt       | 9.6s     |
| **warm session + bare cwd + replaced prompt** | **4.6s** |

The cold start was never the whole cost. Most of it was the model reading a
large CLAUDE.md and **writing a full prayer on every turn**. `--system-prompt`
replaces rather than appends, which keeps user instructions out; tools are
configured separately so tool use is unaffected. `ChewieSession` holds a
`--input-format stream-json` process open, warmed at launch.

Small talk and general knowledge go to the local Qwen3-4B instead, about a
second. `ChewieRouter.isLocallyAnswerable` is deliberately strict: a pronoun,
an action verb, a data noun, a time word, over 14 words, or any capitalised
proper noun after the first escalates to Claude. Answering a question about
his own life locally would invent a fact about someone he knows.

## Two silent failures worth remembering

**An expired HuggingFace token broke dictation polish for weeks.** Removing
`~/.cache/huggingface/token` on 2026-09-04 did **not** finish the job: the same
`foodvision-deploy` token was still registered in
`~/.cache/huggingface/stored_tokens` on 2026-09-15 and still returned 401.
Cleared with `hf auth logout --token-name foodvision-deploy`. The model repo is
public and anonymous access returns 200, so no token is wanted at all. A token
named `foodvision-deploy` sat in `~/.cache/huggingface/token` from January, so
every model fetch 401'd, the Qwen3-4B polish model never downloaded, and
dictation pasted raw transcripts. "Actually, scratch that" was detected fine;
there was no model behind the gate. On macOS 15 there is no fallback, because
`AppleFMFormatter` is `@available(macOS 26, *)`. Hidden by
`try? await llm.ensureLoaded()`, which now logs.

**swift-transformers looks in `~/Documents/huggingface/models`**, not the
Python cache at `~/.cache/huggingface/hub`. Downloading with `hf` puts it in
the wrong place for MLX.

## Permissions

Full Disk Access **is granted** (2026-09-04 02:31). A subprocess inherits the
launching app's TCC grants, so Chewie gets Plynn's, not a terminal's. That is
why FDA on Plynn matters at all. Re-signing with the same identity and bundle
ID preserves grants.

## Rebuilding it, 2026-09-05

**Sign with Caleb's own identity, never ad-hoc.** `scripts/make-app.sh` defaults
to Carlton Aikins' Developer ID, which is not on this machine, so the build
fails. Pass `IDENTITY="Apple Development: CALEB SPENCER NEWTON (N9F648W7F4)"`.

Signing ad-hoc (`IDENTITY="-"`) builds fine and then **will not launch**: the
bundled Sparkle.framework and the app end up with different Team IDs and dyld
refuses to load it. Re-signing the framework separately does not fix it. One
identity across both is what matters. This left Plynn dead for ten minutes and
the error names Sparkle rather than the signature, so it is worth remembering.

## Chewie draws now

`voiceStyle` in `ChewieRouter.swift` teaches Chewie about the display, so
"show me my week" reads the coursework ledger and puts a real panel on the
glass instead of a sentence in the pill. The word `hud` had appeared zero times
in that prompt until 2026-09-05: the display and the assistant were built in
the same repo and had never been introduced. See [[project_hud_backlog]].

## What was actually broken, 2026-09-15

Caleb said "chewbacca is cooked, plynn not workin". Chewbacca was healthy: 68
doctor checks passed and every `chewbacca live` check passed. Plynn had two
independent failures, and the kit was implicated in one of them.

**`--system-prompt` replaces the prompt but not the settings.** A bare working
directory keeps a project's CLAUDE.md out; it does nothing about the *user*
layer. Every Chewie turn still ran six SessionStart hooks and loaded
`~/.claude/CLAUDE.md`. Measured on a one-word answer: **47,502 tokens, 12.7 s,
$0.042, and it opened with a full prayer**. That is the exact cost `--system-prompt`
had been added to remove. With `--setting-sources ""`: **26,831 tokens, 1.1 s,
$0.013**, zero hooks, no MCP servers. `--bare` goes further but forces
`ANTHROPIC_API_KEY` and never reads OAuth, so it is **wrong for a subscription
machine**. Do not reach for it here.

**The warm session never aged out.** One was found alive after **six days**.
Every turn stays in one conversation, so it carried six days of history into
each request. `ChewieSession` now recycles at six hours or forty turns.

**Polish was a no-op, and the history proves it.** In
`~/Library/Application Support/Plynn/personal.db`, `verbatim == formatted` on
**41 of 42** rows, including a 73-second dictation that badly needed cleanup.
That table is the fastest way to tell whether polish is really running; RSS is
the second (a loaded Qwen3-4B sits far above the ~40 MB idle figure). After a
rebuild the app logs `plynn: polish engine Qwen3-4B (local)` about five seconds
in, which is the line to grep for.

**Reading Plynn's own NSLog:** `log show --predicate 'process == "Plynn"'
--last 10m --style compact | grep -F "plynn:"`. It is unreliable after the fact;
`log stream` across a deliberate restart is what actually catches startup lines.
Run it from a script file, because the shell mangles the predicate quoting.

## The tap dies and nothing says so, 2026-09-17

Caleb said "plynn not working bruh". The app had been up **two days** (PID
82693, launched Sep 15 15:44) and had captured **nothing since 02:13 that
morning**, fourteen hours earlier. Everything that usually explains this was
fine: Accessibility, Microphone and Full Disk Access all `auth_value=2` in the
TCC dbs, the process answered AppleScript, and 02:13 had been a clean run with
polish working (`ai-polish 1`, "formatting changed transcript", RSS 126 MB).

**The CGEventTap was dead.** Not disabled-and-recoverable: gone. `HotkeyMonitor`
re-enables on `.tapDisabledByTimeout`, but that only runs while the callback is
still being invoked, and a tap the system has torn down cannot report its own
death. Restarting fixed it instantly.

**How to tell the difference between a dead tap and a dead mic, fast.** The
recorder is rebuilt per recording and `main.swift` logs `plynn: mic error` and
`plynn: mic unavailable` on failure. So:

- `plynn: captured` present, output wrong → transcription or polish
- `plynn: mic error` present → audio device, usually a reconfiguring input
- **nothing at all in `plynn:` → the tap, not the mic**

Do not be misled by `order window: <id> op: 1` plus a UIIntelligenceSupport
connection in the log. That is macOS 15 checking Writing Tools availability on
any window order-in, it fires without Plynn recording anything, and it cost
time here by looking like the pill responding to fn. **The real tell that a
recording started is an `AVAudioEngine ... start` line.** The last one before
the restart was 02:13:13.

**The reusable test: synthesize the fn key.** Post a `flagsChanged` for keycode
63 with `.maskSecondaryFn` down, wait, then up, while running `log stream`
against Plynn. Zero reaction means the tap is dead; a full
captured/Parakeet/polish/paste chain means it is healthy. This was the control
that turned a guess into a diagnosis, because the identical test failed before
the restart and passed after.

**Fixed durably** in Chewbacca `54ce683`: a 5s timer on the main run loop in
`.common` mode polls `CGEvent.tapIsEnabled`, re-enables the tap when that is
enough, and rebuilds it when it is not. Verified by `SIGSTOP`ing the process
until macOS really disabled the tap; the watchdog logged
`plynn: hotkey tap was disabled, re-enabled` and dictation worked afterwards.
The timer uses target/action, because the block form of `Timer` takes a
`@Sendable` closure and `HotkeyMonitor` is a main-thread class.

**Two traps in the synthetic test itself.** Firing several `fnpost` processes
at once leaves `fnIsDown` stuck true, so the next press is swallowed and the
following release closes a session that was already open: a 32.2s phantom
capture. And synthetic events do not move the real hardware modifier flags, so
`resyncTriggerState()` cannot clear that state the way it would with a real
fn key. Run the test once to flush, then again to measure.

**Contributing conditions, not causes:** swap was at 7.9 GB of 9.2 GB and the
machine had 1,400+ sleep/wake cycles since boot. A long-lived tap on a
memory-pressured Mac is the situation to expect this in, so the watchdog
matters more than the restart.

## The macOS 15 ceiling

Caleb is on **macOS 15.6.1**; upstream Plynn requires **macOS 26** and his fork
lowered the floor to 15.0. That gate, not missing code, is what makes the app
feel like "just transcription". His fork is missing **zero** upstream files and
has more code (6,676 vs 5,566 LOC). What macOS 26 would unlock:

- `AppleFMFormatter`, the **primary** polish engine (Apple Intelligence)
- `AppleSpeechEngine`; below 26 it is `UnavailableSpeechEngine`, so Parakeet is
  the only ASR and there is nothing to fall back to
- the Liquid Glass pill (`GlassEffectContainer`, `.glassEffect`)
- six Apple-Intelligence paths in `TranscriptFormatter`

So **Qwen3-4B is the only polish he has**, which is why small-model output bugs
hit him harder than they hit upstream users.

**Ported v0.1.10 and v0.1.11** on 2026-09-15 (he was three commits behind, and
his version had the bug upstream had already fixed). The glossary had been
fenced and *named*, which taught the small model to reproduce it as a labelled
`**Glossary**` section; upstream's unlabelled one-line rule is correct, because
a label is a thing to reproduce. Also gained `stripScaffoldTail` and
`stripRepeatedTrailingList`, which drop the recap lists small models append.
Four files were byte-identical to v0.1.9 and took upstream wholesale; only
`AppleFMFormatter.swift` needed hand-merging, to preserve his `@available(macOS
26, *)`. 49 tests pass.

Related: [[project_chewbacca]], a private note.

Related: [[project_chewbacca]], [[project_hud_backlog]], a private note.
