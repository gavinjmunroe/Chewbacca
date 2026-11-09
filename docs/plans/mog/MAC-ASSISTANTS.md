# Mac assistant teardown, 2026-10-10

Scope: the ten products Caleb named. docs/plans/COMPETITORS.md already holds one-line mentions of all ten (sweep of 2026-10-07: price and funding for a few) and the "Screen overlay that acts across apps" paragraph. This file adds what that doc lacks: the demo moment, a bar with numbers, data path, and the counterpart in this repo.

Marks: [read] = page fetched through a summarizing fetch tool (close to verbatim, not exact). [film] = YouTube captions read with yt-transcript. [snippet] = search result only. [api] = read through the GitHub API. Nothing was installed or used hands-on. Page text was treated as data only.

One tool note: the untrusted-content hook flagged the 404 page for a guessed GitHub path (openclaw-dottie/dottie) as "text addressed to an AI". It was the fetch tool's standard 404 boilerplate. Nothing was acted on.

Chewbacca facts used for counterparts (all from the repo):

- Voice: `bin/hud-listen` (speech in, interface out, model behind a socket), design rules in `docs/reference/VOICE-DESIGN.md` (receipt at 0 s, first model sentence about 1.0 to 1.7 s, filler past 2 s). Dictation: `plynn/` (fn types, Option asks Chewie, about 5 s to a warm Claude Code session per `team/memory/project_plynn_chewie.md`).
- Acts: `bin/jev-browse` (own Chrome, stops before send/submit/pay), `bin/mac-use`, `bin/peekaboo`, `bin/chewbacca-apps`, `skills/mac-act`, `skills/mac-control`, `mac` CLI.
- Reads: `bin/lib/osgraph*.py` (needs-you, missing, walks), `skills/texts`, `skills/people`, `bin/people` store, `bin/room-capture` and `bin/room-listen` (meeting capture), `skills/kyber-surfaces`.
- Install: `curl -fsSL .../start.sh | bash` (README.md). `docs/plans/FIRST-COHORT.md` says a stranger install has not passed.
- Own numbers from COMPETITORS.md: "waiting on you" 41 of 55 right on a sealed set (about 75%, 90% with a 7-day window); first words 1.0 to 1.7 s after prompt; generated panels 14 of 20 first try.

---

## 1. Highlight (highlightai.com)

- Best thing: the post-meeting moment. A "Kirk <> Jane 1:1" ends and the screen shows a summary, a logged decision, and three drafts staged and waiting (Google Doc launch plan, Slack message, Ashby scorecard), all behind an approval. [read]
- Bar: unmeasured for speed (site gives no latency; the only number in the changelog fetch is a cold start of 1.8 s to 1.1 s on M-series, from an older release). The bar is scope: 10 named integrations (Gmail, Docs, Slack, GitHub, Notion, Linear, Ashby, Granola, Claude Code, Juicebox) and drafts for 3 apps from one meeting with 0 presses before review. Beat it by staging the same 3 drafts from a real meeting in under 60 s after the call ends, one press each to approve.
- Price: Lite $35/mo (20 h transcription, 500 credits), Pro $60/mo (50 h, 3,000 credits), Max $200/mo (80 h, 8,000 credits); 14-day trial on Lite and Pro. [read] Install: signed Mac download, arm64 path (highlightai.com/download/arm64). Data: cloud; SOC 2 Type 2, Trust Center, "not for sale or training", per-app/domain exclusions, never captures passwords or health/financial content. [read] Funding $40M Series A 2026-03-24 [snippet in COMPETITORS.md].
- Cadence: changelog entry every 1 to 3 weeks (Aug 15 unified side panel and "Actions" renamed "Ready for you"; Jul 21 scheduled and event-triggered skills; May 21 "Everything Is a Skill Now"). [read]
- Counterpart: `bin/room-capture` + `bin/lib/osgraph_missing.py` + CHW-206 "Go" on a meeting action item (text draft, tentative event, or ledger task). Gap: no Docs/Slack/Notion/Linear drafts, no local summary model.
- Beat test: record a real 30-minute call; from hang-up to three staged drafts (email, message, task) in under 60 s, on a stranger's laptop, with only the summary call leaving the Mac.
- Sources: https://highlightai.com [read]; https://highlightai.com/pricing [read]; https://highlightai.com/changelog [read]; https://docs.highlightai.com/FAQ [snippet]. No demo video found by search.

## 2. Shadow (shadow.do)

- Best thing: press a shortcut, speak, cleaned text is pasted at the cursor; meetings auto-start and end with the call, no bot joins, audio never leaves the device. [read] Site has no video.
- Bar: "4x faster than typing" is their only number (no method). Price bar: Free forever with unlimited transcription, audio recording and screenshots; Plus $8/mo. Beat: meeting capture that is free, fully local including the summary, and starts without a press. [read]
- Price: $0 / $8 per month. Install: "Download for Mac" button, no steps. Data: transcription on-device; Skills call LLM APIs only when triggered; never trained on. Detects Zoom, Slack, Teams, Meet, Webex, Discord. Webhooks to Zapier, n8n, Make. [read] Funding about $1M [snippet in COMPETITORS.md].
- Counterpart: `bin/room-capture`, `bin/room-listen` (audio deleted per chunk per COMPETITORS.md), `plynn/` for the dictation half. Gap: summaries go to Anthropic via `claude -p`, so "audio never leaves" is true only for audio, not for the transcript.
- Beat test: a stranger installs, joins a Zoom, and gets named meeting notes with zero transcript bytes leaving the Mac (verified with a network capture) within 5 min of setup.
- Sources: https://shadow.do [read]; https://shadow.do/pricing [read].

## 3. VoiceOS (voiceos.com)

- Best thing: voice plus pointing. In the film, with the manager's message on screen: "Respond to my manager politely and send him a Google Drive link to the files... give Google Drive access to my manager's email... and book a meeting," and it does the chain across Gmail, Drive and Calendar with no tab switching. Tagline: "Say it and it's done." [film gbzo-Er-PEs, 31 caption segments, found via a GoodFirms listing] The site's own demo is "find his LinkedIn" resolved from where the cursor is. [read]
- Bar: no latency on the site (audio "processed in real time"). Presses: 1 hold-to-talk. Beat: the same 3-action chain from one utterance, each action read back before it runs, under 10 s to the first action and 2 presses or fewer. Users: 20,000+ claimed.
- Price: Pro $11.99/mo billed annually (60% off monthly), Enterprise custom with zero data retention and SSO; 7-day trial, card required; 50% student and builder discounts; 100 languages. Install: .dmg; Mac and Windows now, iPhone and Android "coming soon". Data: audio not stored on servers or used for training; the FAQ says stored only if you opt in; transcripts can be local. [read] YC; funding about $500K, possibly conflated with a same-named company [snippet in COMPETITORS.md].
- Counterpart: `plynn/` + `bin/hud-listen` + `skills/mac-act`. Gap: no cursor-as-context ("his" resolved from the pointer); no Drive/Calendar write for a stranger without Caleb's OAuth client (COMPETITORS.md gap 1).
- Beat test: a stranger holds the key on a Mail thread, says "reply politely and put 30 minutes on my calendar Thursday," both drafts appear read back in under 10 s, one press to send.
- Sources: https://voiceos.com [read]; https://voiceos.com/pricing [read]; https://www.youtube.com/watch?v=gbzo-Er-PEs [film]; https://dupple.com/reviews/voiceos [snippet].

## 4. Gemini app for Mac (announced 2026-04-15)

- Best thing: Option + Space from anywhere, then share a window so Gemini answers about what is on screen (summarize a complex chart, write a spreadsheet formula). The announcement describes no actions taken on the Mac. [read]
- Bar: the shortcut is 2 keys; latency unmeasured. Price bar: free with a personal Google account. Beat: a hotkey that answers about the focused window on the glass in under 3 s and also answers from the person's mail and texts, which the launch post does not claim. The post lists no data handling beyond Workspace admin controls (Generative AI settings). [read]
- Price: none on the post; any personal Google account, macOS 15+, on by default for Workspace orgs with Gemini enabled. Install: gemini.google/mac. Data goes to Google cloud under admin controls. COMPETITORS.md separately cites Gemini Spark acting on the Mac for $99.99/mo AI Ultra [snippet via ppc.land]; not re-verified here.
- Counterpart: `bin/hud-gemini`, `bin/peekaboo` (window capture), `skills/mac-see`. Gap: no one-press "ask about this window" with the answer on the glass in under 3 s, measured.
- Beat test: one hotkey on a chart in Numbers: correct summary on the glass under 3 s, timed on video, then the same hotkey answering from the person's mail.
- Sources: https://workspaceupdates.googleblog.com/2026/04/now-available-gemini-app-for-mac.html [read]; https://ppc.land/google-restricts-new-mac-ai-agent-to-99-99-ultra-subscribers/ [snippet].

## 5. Cluely (cluely.com)

- Best thing: the live "What should I say?" answer in a floating panel during a call, triggered with Cmd+Enter, claimed hidden from screen share. [read]
- Bar (their claims, unverified): 300 ms response time, 95% transcription accuracy, 12+ languages. Beat: live suggestion on screen within 1 s of a question ending, 95%+ word accuracy on a fixed clip. The "undetectable" tier is the one thing not to copy (deceptive use; a competitor argues macOS has no reliable hidden-window API [snippet]).
- Price: Starter free (limited, 3 files), Pro $19.99/mo, Pro + Undetectability $149.99/mo (page title says "from $11.99/mo"). [read] Install: desktop app and iOS App Store. Data: the site gives none. One non-English review reports a 2025 breach exposing screenshots and recordings of 83,000+ users via an admin password file in a public repo; single source, unconfirmed. [snippet] Funding $15M a16z Series A, $20.3M total [snippet in COMPETITORS.md].
- Counterpart: `bin/call-listen`, `bin/call-pill`, `bin/call-practice`, `bin/call-watch`, `apps/call/ears.swift`, `skills/call-coach`. The strongest counterpart of the ten. Gap: no measured latency or word accuracy on a fixed clip.
- Beat test: play one fixed 60 s sales-call clip; time from the last word of a question to the suggestion on the glass, median under 1 s, and score word accuracy against a reference transcript. Publish both.
- Sources: https://cluely.com [read]; https://cluely.com/pricing [read]; https://dupple.com/reviews/cluely [snippet]; https://www.bluedothq.com/de/blog/cluely-review [snippet].

## 6. mrmr (getmrmr.com)

- Best thing: hold Fn+Shift, speak a multi-step command (client reply, calendar kickoff, channel message, reminder), and it chains across apps, then waits for one confirm before any write. Reads run freely. [read]
- Bar: no latency given. Presses: 1 hold plus 1 confirm. Connectors: 14 live (Slack, Linear, Google Calendar, Drive, Tasks, Meet, Zoom, Notion, Gmail, Cal.com, Calendly, Attio, Apple Reminders, GitHub), 4 soon (HubSpot, Jira, Outlook, Teams). Beat: the same 4-step chain with one confirm for all four writes, under 15 s; read-only questions with zero presses.
- Price: none published ("founder pricing when paid plans launch"). Install: invite-only waitlist or a 20-minute setup call. Data: not described; writes confirmed, scripts untrusted until reviewed, Runs tab keeps history. Mac only. Also runs Raycast Script Commands by voice. [read] Its demo text and its steps list disagree on what the command does.
- Counterpart: `bin/hud-listen`, `skills/mac-runtime` (typed plan, verify, log), `bin/chewbacca-google`, `bin/chewbacca-slack`. Gap: Slack/Linear/Notion/Attio/Cal.com not wired for a stranger; Gmail and Calendar need Caleb's OAuth client.
- Beat test: a 4-action voice command, one confirm card showing all four, every action verified afterward, on a stranger's Mac with no setup call.
- Sources: https://getmrmr.com [read]; https://getmrmr.com/blog/ai-assistants-that-act-on-your-mac [snippet in COMPETITORS.md].

## 7. Jarvis (getjarvis.eu)

- Best thing: "Show Me." A floating bar on a hotkey takes one screenshot on request and points at the exact spot on screen it is explaining; interruptible voice (double-tap Ctrl). The site names no single demo. [read]
- Bar: no latency. Install claim: "about two minutes" with a free account. Beat: install to first useful answer in under 2 min, no account. 40 free requests a week is the free-tier bar.
- Price: Free 40 requests/week plus 7-day Pro trial, no card; Pro $16/mo ($144/yr); Unlimited $32/mo. Install: macOS 12+, Windows 10/11, Linux AppImage; account required. Data: user DB in the EU, app servers in the US; inference via Anthropic, OpenAI and Google under no-training terms; OAuth tokens AES-256-GCM; screenshots discarded after the turn, no continuous recording; 30+ OAuth connectors (Gmail, Slack, Notion, Linear, GitHub, Calendar, Drive, Figma, M365, others); approval before send, post or delete. Solo founder, Sibiu, Romania; no funding. [read]
- Counterpart: `bin/peekaboo`, `skills/mac-see`, `bin/hud-listen`. Gap: no pointer-to-the-spot overlay (a Kyber mark on the control, no model in the draw).
- Beat test: ask "where do I turn on X" in System Settings; a mark lands on the right control in under 5 s, timed, no account.
- Sources: https://getjarvis.eu [read].

## 8. Fazm (fazm.ai, github.com/mediar-ai/fazm)

- Best thing: the real Claude Code, Codex and Gemini CLI loops in a native Mac app on your own Claude Pro or Max login, where chats survive a Mac restart (demo: 18 turns kept in context, 47 of 47 tests passing, against a raw CLI that auto-compacted 12 messages), one-click fork, no auto-compaction, up to 40 parallel windows, phone remote by QR. [read]
- Bar: sessions persisting across restart (pass/fail) and 40 parallel windows. Push-to-talk by holding Left Control per the site home; a search of fazm.ai/cc did not show voice, so treat as single-source. No latency. Install: enter an email for a download link, then log in to Claude in Settings. Beat: after a reboot, every Claude session is back with history in under 10 s, with many sessions running under the load guard.
- Price: app free; you pay your Claude plan. Open source: README says MIT, but the GitHub API reports no license file, so verify before relying on it. Repo mediar-ai/fazm: 345 stars, last push 2026-10-05, latest release v2.9.89 on 2026-09-02, five releases between 2026-08-24 and 2026-09-02. Swift/SwiftUI app plus an acp-bridge in TypeScript; building needs macOS 14, Xcode and a Developer ID. Data: nothing stated beyond your own Claude account; on a fresh clone the build fetches a bootstrap config from fazm.ai pointing at the hosted backend (Firebase), with model keys fetched at runtime behind auth. README demos: Smart Connections, CRM Management, Visual Tasks. Mac only. [read] [api]
- Counterpart: `bin/kyber-sessions` (send, allow once, deny, interrupt, fork per COMPETITORS.md), `bin/claude-tab`, `bin/tabs`, `bin/hud-codex`, `bin/hud-gemini`. The closest analog. Gap: nothing proves all sessions come back after a restart; the only phone remote is `bin/phone-mirror`.
- Beat test: reboot, log in, all N Claude sessions listed and resumable with history in under 10 s, timed on video. Plus a stranger installs in under 5 min with no Xcode.
- Sources: https://fazm.ai [read]; https://fazm.ai/cc [snippet]; https://github.com/mediar-ai/fazm [read via gh api]; releases via `gh release list -R mediar-ai/fazm` [api].

## 9. Dottie (dottie.ai)

- Best thing: "Talk to Your Mac. Watch It Work." Hold Option+Space and speak, or say "Hey Dottie" hands-free; it chains email, calendar, messages, music, web search, app control and screen vision. No single demo on the page. [read]
- Bar: unmeasured ("instantly" is the only claim). Install: unzip from GitHub and open, no account, macOS 15.4+ on Apple Silicon. Beat: wake word to first action under 2 s, offline, no account. It lets users pick local models, their own OpenAI/Anthropic/xAI/Cerebras keys, or Dottie Pro (keyless Grok).
- Price: app free; Dottie Pro price not listed. Data: no privacy claims; local model option. [read] Not the same as OpenAI's "Dottie" character in "dots" (DevDay 2026-09-29) [snippet]. I could not find the GitHub repo (my guessed path 404ed); a Product Hunt page exists at producthunt.com/p/dottie [snippet]. Source base is thin.
- Counterpart: `plynn/`, `bin/hud-listen`, `bin/hud-ollama` (local model route). Gap: no wake word.
- Beat test: say a wake phrase with Wi-Fi off; a local model opens a thread and drafts a reply in under 5 s.
- Sources: https://dottie.ai [read]; https://www.producthunt.com/p/dottie [snippet].

## 10. Alter (alterhq.com)

- Best thing: a context-aware voice-first Mac copilot. It reads whatever app is on screen, ships 80+ built-in actions, connects to 2,000+ services, records meetings locally with speaker ID (works offline), and lets the user pick the model (50+ cloud models, Ollama, LM Studio, any OpenAI-compatible endpoint). No single demo named. [read]
- Bar (their claims, no data shown): answers 2 to 3x faster than ChatGPT or Claude through routing; voice workflows about 3x faster; "chats stay encrypted and local." Beat: a published benchmark on a fixed 20-task Mac list, median time to a correct result, Chewbacca vs Alter, same Mac. Breadth bar: 80+ actions and 2,000+ services.
- Price: Free (bring your own keys or local models); Local+ add-on $29/yr; Pro $240/yr; Lifetime $720 one-time (one active device); 7-day trial. Fair use: top 5% of users average about 30 interactions a day; API gateway 400 requests/day. Install: universal macOS app from the beta page; hero says macOS 14+, FAQ says 13+. Data: local chats, no training, optional anonymous analytics. Bootstrapped, small team in Pau, France; Product Hunt launch 2025-04-23 (320 upvotes); weekly Friday updates per a reviewer. [read] [snippet]
- Counterpart: `bin/mac-use`, `skills/mac-act`, `bin/hud-ollama`, `bin/model-route`, `bin/room-capture`. Gap: no 2,000-service reach for a stranger (Chewbacca covers Apple apps, Chrome, Clay; Slack and Google for Caleb only).
- Beat test: fixed 20-task Mac benchmark with a stopwatch, same Mac, both apps, task list published.
- Sources: https://alterhq.com [read]; https://alterhq.com/pricing [read]; https://www.producthunt.com/products/alter/launches/alter-4 [snippet]; https://afadingthought.substack.com/p/alter-mac-ai-assistance-for-productivity [snippet]. The indexator.ai page was not opened.

---

## Where Chewbacca is behind

| Product    | Unmatched thing                               | Chewbacca status                            |
| ---------- | --------------------------------------------- | ------------------------------------------- |
| Highlight  | 3 drafts staged after a meeting               | partial (CHW-206: text, event or task only) |
| Shadow     | free local meeting capture, $8 Plus           | partial (transcript leaves via claude -p)   |
| VoiceOS    | cursor-as-context, 3-app chain, 100 languages | none for cursor context                     |
| Gemini Mac | Option+Space ask-about-window                 | partial (hud-gemini, unmeasured)            |
| Cluely     | 300 ms live suggestion claim                  | built (call-\*), unmeasured                 |
| mrmr       | 14 live connectors, one confirm for a chain   | partial (Caleb-only OAuth)                  |
| Jarvis     | Show Me pointer, 2-minute install             | none                                        |
| Fazm       | restart-proof sessions, 40 windows            | partial (kyber-sessions)                    |
| Dottie     | wake word, no account                         | none                                        |
| Alter      | 2,000 services, user-picked models            | partial (hud-ollama, model-route)           |

## The 3 hardest bars

1. Stranger install to first useful result with no help. Jarvis claims about 2 minutes; Fazm, Alter and Dottie are download-and-open; Highlight and VoiceOS are a signed .dmg. Chewbacca's `start.sh` installs 190 skills and 63 hooks, and COMPETITORS.md says it has not passed this test. Bar: under 5 minutes, no Xcode, no hand-made OAuth client, timed on video.
2. Cluely's 300 ms live suggestion and 95% accuracy (their claim). `bin/call-*` exists and is unmeasured; Chewbacca's own voice path is 1.0 to 1.7 s to first words. Bar: median under 1 s from end of question to suggestion, 95% word accuracy on a fixed clip, both published.
3. Cross-app action with one approval (Highlight, VoiceOS, mrmr): three or four writes across Docs, Slack, Linear, Calendar, Gmail from one utterance or one meeting. Chewbacca's "waiting on you" is about 75% right on the sealed set (41 of 55), and Gmail, Calendar and Slack are Caleb-only. Bar: a 4-action chain from one sentence, one confirm, each action verified, on a stranger's Mac.

Honorable mention: Shadow's $0 tier with local meeting capture removes the price argument entirely.
