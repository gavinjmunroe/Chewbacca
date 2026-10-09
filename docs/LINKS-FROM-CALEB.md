# Links Caleb sent for Chewbacca

Every repo and link Caleb pasted during the 2026-10-08 messaging session, kept
whole so none get lost. Backlog items CB-517 to CB-522 point here. Most came
from Google AI Mode answers he pasted in. Their descriptions are that source's
words, unverified, and one of its links was wrong (noted below).

What happened to each so far: **used** means it's in the kit now, **rejected**
means looked at and decided against (with why), **later** means worth a real
task but not adopted yet, with the reason it is waiting.

How the 2026-10-09 pass was done. Every GitHub link was checked through the
GitHub API the same day (stars, last push, license, archived) and grepped
against the kit for overlap. The four that fit now (api-anything, sqlite-vec,
ActivityWatch, nicbarker/clay) were also read in full: README, source tree,
commit log, issues. **run** after a verdict means it was installed into a
scratch dir and tested; **read** means the verdict comes from reading only.
Nothing from an unknown repo was executed. Six links 404 on GitHub, which
suggests the AI Mode answer invented them.

## The four that fit now (CHW-187)

- [goodnight000/api-anything](https://github.com/goodnight000/api-anything): **later** (CB-519, 2026-10-09, read). MIT, 248 stars, last push 2026-10-02, one closed issue, not on npm. It learns a site's own request from two example inputs in headless Chrome, then replays it over plain `fetch` (400 ms for an Instagram profile), with a browser fallback. The source has no hardcoded hosts and no install hooks beyond `tsc`; credentials stay in `~/.api-anything`, and writes are off unless `--allow-writes`. Task it was judged on: CB-519's "a reader for Instagram or LinkedIn DMs". It doesn't do that: its README says LinkedIn messaging isn't bundled or tested, and the Instagram ops are logged-out profile and 12-post reads. The real fit is `bin/brand-grab`, which opens a Playwright page per Instagram handle for the same profile data. Next check: run it in a throwaway `API_ANYTHING_HOME` on `instagram getProfile` against brand-grab's output for one handle, and adopt only if the fields match. Caleb's take: "this one is insane".
- [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec): **later**, closest to used (2026-10-09, run). Apache-2.0 or MIT, 8.2k stars, last push 2026-05-18, 215 open issues, npm `sqlite-vec` 0.1.9 (pre-1.0). Task: semantic search over people.db messages next to the existing `messages_fts` FTS5 table. Results: it loads into `node:sqlite` (the driver `bin/lib/people/db.js` uses) with `allowExtension: true` on Node 22.20 in 359 ms. 3,000 recent messages embedded with the local Ollama `embeddinggemma` took 138.6 s, and a top-10 query took 8 ms. For "getting paid back for money I spent", FTS on `reimburs*` found 2 of the top 10; the other 8 included a Venmo-the-treasurer and a tuition-refund message that FTS can't reach, plus noise. At 100k synthetic 768-d vectors a brute-force query took 160 to 710 ms. Blocker: people.db holds 520,143 messages, so a full backfill at about 22 per second is about 6.6 hours of embedding, plus roughly 1.6 GB of float vectors. Next check: embed only the last 90 days, or `bit[768]` quantized vectors, behind a `people search --semantic` flag, and keep FTS as the default.
- [ActivityWatch/activitywatch](https://github.com/ActivityWatch/activitywatch): **rejected** for now (2026-10-09, read). MPL-2.0, 19k stars, v0.14.0 released 2026-10-06, very active. Task: "what Caleb actually does all day". The kit already answers that from `knowledgeC.db` with no daemon: `/app/usage` had 5,316 rows in the last 7 days with the newest from today, and `docs/OS-COVERAGE.md` ranks apps from it. knowledgeC also has `/app/webUsage` and `/display/isBacklit`, a rough AFK signal. ActivityWatch's one real gain is window titles, and it costs a server, a window watcher, an AFK watcher and a browser extension running all the time; issue #824 says Chrome window titles aren't tracked on macOS anyway. Reopen if per-window history becomes a need, and then copy aw-watcher-window's approach into `hud-context` rather than installing the suite.
- [nicbarker/clay](https://github.com/nicbarker/clay) (2026-09-29): **rejected** (2026-10-09, read). A C layout library, not Clay.com. Zlib, 18k stars, last push 2026-05-20, single 5,058-line `clay.h`. Task: lay out a HUD panel. The HUD is native Swift with 27 SwiftUI files, and SwiftUI already does layout. Clay emits render commands that need a renderer, and its renderers are raylib, SDL, sokol, cairo, GLES, web, terminal, win32 and Playdate, with no Metal, CoreGraphics or Swift bindings. Using it means a C bridge plus a new Metal renderer to replace a layout engine that works. Reopen only if the HUD moves to an immediate-mode Metal renderer.

## Messaging and Slack

- [shaharia-lab/slackcli](https://github.com/shaharia-lab/slackcli): **used**. Slack sending, `chewbacca slack link`.
- [openclaw/slacrawl](https://github.com/openclaw/slacrawl): **used**. Slack reading from the desktop cache.
- [open-cli-collective/slack-chat-api](https://github.com/piekstra/slack-cli) (`slck`, the old piekstra/slack-cli): later. Slack Web API CLI with keyring auth. 21 stars, pushed 2026-10-04. Only worth it if slackcli's session auth (CB-517) is refused.
- [Slack's official CLI](https://docs.slack.dev/tools/slack-cli/guides/running-slack-cli-commands): rejected. It builds Slack apps and can't send ad-hoc messages.
- The pasted `msg` shell script (webhooks plus a named pipe): rejected. Webhooks can't DM a person, the JSON breaks on quotes, and `eval` runs input. `people send` does the job.
- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks), [App manifest reference](https://docs.slack.dev/reference/app-manifest): reference only.
- `@rvgpl/slack-message` (npm), the bash `slack-cli`, and the Rust `slack-cli` crate: rejected. Each needs a bot token or webhook.
- [larksuite/cli](https://github.com/larksuite/cli): rejected (2026-10-09). Official and active (17.6k stars, MIT), but people.db has no Lark source at all: its messages come from iMessage, LinkedIn, Slack, email and WhatsApp. Reopen if a Lark user shows up.
- [paperfoot/clinstagram](https://github.com/paperfoot/clinstagram): rejected (2026-10-09, read). 14 stars, untouched since 2026-04-17. DMs go through instagrapi's private API, which logs in with the account password and is the classic way to get an Instagram account flagged. Instagram DMs stay open (no reader in the kit, and api-anything doesn't cover them either).
- [Android: send data to other apps](https://developer.android.com/develop/ui/compose/sharing/send): reference for an OS-wide share/send model.
- [High-level design for an IM app](https://levelup.gitconnected.com/high-level-design-for-an-instant-messaging-app-like-whatsapp-b2974d82124a): reference.

## Email

- [mail-0/zero](https://github.com/mail-0/zero): later, to mine for parts (CB-521). Running it is rejected: it needs Docker, Postgres and its own OAuth app, and it hasn't been pushed since 2026-05-26, so it would be a second app the way Plynn was.
- [elie222/inbox-zero](https://github.com/elie222/inbox-zero): later (CB-521). AI triage for Gmail. Active (pushed 2026-10-09), but the license reads NOASSERTION on GitHub, so check it before copying any code.

## Apps with no API (the "never open an app" layer)

- [goodnight000/api-anything](https://github.com/goodnight000/api-anything): see the four above.
- [browser-use/browser-use](https://github.com/browser-use/browser-use): **used** in part. `bin/jev-browse` wraps browser-use/jev-ultrafast and `bin/mac-use` runs browser-use/macOS-use. The main library isn't installed and doesn't need to be.
- [browserbase/stagehand](https://github.com/browserbase/stagehand), [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern): rejected as installs (2026-10-09). Their idea, cache the action once and replay it without the model, is already written into `docs/SITE-LEARNING.md` and `docs/WEB-AGENT.md`, and api-anything does the same one level lower. Skyvern is AGPL-3.0.
- [OpenAdaptAI/OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt): **used** as a design source. Credited in `CREDITS.md`: `mac-runtime`'s plan, verify and log shape comes from its "VERIFIED only if an independent check agrees" rule.
- [nicobailon/surf-cli](https://github.com/nicobailon/surf-cli): later. Drives Chrome over a Unix socket. MIT, 633 stars, pushed 2026-10-06. It overlaps `chrome-js` and the jev Chrome bridge, so it needs one timed read against them before it earns a place.
- [NangoHQ/nango](https://github.com/NangoHQ/nango): later. OAuth and prebuilt syncs for hundreds of APIs. The pasted link pointed at janhq/jan by mistake. It is a server to self-host, and the license reads NOASSERTION, so it waits for a client that needs many APIs at once.
- [activepieces/activepieces](https://github.com/activepieces/activepieces): later. An open connector library. Same NOASSERTION license caveat; mine its connector definitions, don't run the server.
- Composio CLI ([ComposioHQ/awesome-agent-clis](https://github.com/ComposioHQ/awesome-agent-clis)): later. The repo moved to composio-community/awesome-agent-clis and hasn't been pushed since 2026-03-27. Treat it as a list to mine.

## Agent and OS building blocks

- [goodnight000](https://github.com/goodnight000) (Charles Zheng, whole profile): taking (2026-10-09, all 18 repos cloned and read). Every repo with a license is MIT. Being ported: cstack's five skills, countinghouse + dime into `skills/startup-finance`, Sift's librarian procedures into second-brain references, Pebble's feed list as data; exact-paste and tally judged for install. api-anything is handled separately under CB-519.
- [goodnight000/cstack](https://github.com/goodnight000/cstack): taking (2026-10-09, read in full). 8 stars, pushed 2026-10-09. Five skills: reflect, rsi, video-edit, animated-video, video-script. `rsi` (test a skill change against the current version with bounded runs) is the one the kit lacks a direct twin for; read it against `skill-training` before taking anything.
- [FastMCP client](https://gofastmcp.com/cli/client), [chrishayuk/mcp-cli](https://mcpservers.org/servers/chrishayuk/mcp-cli): later. Not opened in this pass; useful only for testing `chewbacca-mcp` from outside Claude.
- [OpenCode](https://opencode.ai/install), [Gemini CLI, Aider, Codex CLI, Dorothy, Claw Code](https://github.com/bradagi/awesome-cli-coding-agents): later. Codex and Gemini CLI are already installed and wired by `chewbacca connect`; OpenCode and Aider aren't installed. Add one only when someone on the team uses it.
- [microsoft/semantic-kernel](https://github.com/microsoft/semantic-kernel), [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph), [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI): rejected (2026-10-09). The kit's task graphs are its own (`fanout`, `task-graph`, the graph-engineering skill), and each of these would add a framework runtime under them. Semantic Kernel is C#-first.
- [temporalio/temporal](https://github.com/temporalio/temporal): rejected. A server cluster for durable workflows is out of scale for one Mac. [statelyai/xstate](https://github.com/statelyai/xstate): rejected. The kit's UI is SwiftUI and its CLIs are short-lived, so there is no JS state machine to host it.
- [lancedb/lancedb](https://github.com/lancedb/lancedb), [chroma-core/chroma](https://github.com/chroma-core/chroma): rejected in favor of sqlite-vec (2026-10-09). people.db is already SQLite, sqlite-vec loads into it, and a second store would need syncing.
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri), [electron/electron](https://github.com/electron/electron), [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit), [socketio/socket.io](https://github.com/socketio/socket.io): rejected for the HUD. It is native Swift, and a web shell would replace it. [shadcn-ui/ui](https://github.com/shadcn-ui/ui): **used**. The `interface` skill's component taxonomy names its parts after shadcn.
- [janhq/jan](https://github.com/janhq/jan), [TabbyML/tabby](https://github.com/TabbyML/tabby): rejected. Ollama already serves local models here (7 installed, including embeddinggemma and llama3.1:8b). Tabby is a coding assistant, which Claude Code covers, and hasn't been pushed since 2026-06-30.

## Open-source apps Chewbacca could replace or reuse

Checked against the `oss-apps` registry on 2026-10-09 (`tools/oss_apps.py search --offline`). **used** here means it has a registry entry, not that it is installed.

- [calcom/cal.com](https://github.com/calcom/cal.com): **used** (registry). The repo now redirects to calcom/cal.diy.
- [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot): **used** (registry).
- [AFFiNE](https://github.com/toeverything/AFFiNE): **used** (registry).
- [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy): **used** (registry). AGPL-3.0, so reference only.
- [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw): **used** (registry).
- [twentyhq/twenty](https://github.com/twentyhq/twenty): **used** (registry).
- [nocodb/nocodb](https://github.com/nocodb/nocodb): **used** (registry).
- [documenso/documenso](https://github.com/documenso/documenso): **used** (registry). AGPL-3.0.
- [supabase/supabase](https://github.com/supabase/supabase): **used** (registry).
- [hoppscotch/hoppscotch](https://github.com/hoppscotch/hoppscotch): **used** (registry).
- [infisical/infisical](https://github.com/infisical/infisical): **used** (registry).
- [umami-software/umami](https://github.com/umami-software/umami): **used** (registry).
- [coollabsio/coolify](https://github.com/coollabsio/coolify): **used** (registry).
- [immich-app/immich](https://github.com/immich-app/immich): **used** (registry). AGPL-3.0.
- [Stirling-Tools/Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF): **used** (registry).
- [localsend/localsend](https://github.com/localsend/localsend): **used** (registry).
- [corentinth/it-tools](https://github.com/corentinth/it-tools): later. The only one of these with no registry entry. GPL-3.0, a web bundle of small converters; add it to the registry next time it is rebuilt.
- [pluja/awesome-privacy](https://github.com/pluja/awesome-privacy): later. A list (CC0) to mine for registry entries.

## Developer shell tools

None of these are installed on Caleb's Mac and none is referenced by the kit (checked 2026-10-09). The rule from CB-520 is to adopt only what replaces a step the kit does by hand, and the agent works through its own shell while Caleb works in VS Code, so most of these are rejected.

- [atuin](https://github.com/atuinsh/atuin): rejected. Interactive shell history with optional server sync; the agent doesn't use an interactive history.
- [bruno](https://github.com/usebruno/bruno), [posting](https://github.com/darrenburns/posting), [slumber](https://github.com/LucasPickering/slumber): rejected. API clients for people; the agent uses `curl` and `gh api`.
- [jesseduffield/lazygit](https://github.com/jesseduffield/lazygit), [yazi](https://github.com/sxyazi/yazi), [superfile](https://github.com/yorukot/superfile), [zellij-org/zellij](https://github.com/zellij-org/zellij): rejected. Keyboard TUIs that an agent can't drive and Caleb doesn't open.
- [lazydocker](https://github.com/jesseduffield/lazydocker), [k9s](https://github.com/derailed/k9s): rejected. No Docker or Kubernetes work in the kit; lazydocker hasn't been pushed since 2026-04-19.
- [sharkdp/bat](https://github.com/sharkdp/bat), [eza](https://github.com/eza-community/eza), [ajeetdsouza/zoxide](https://github.com/ajeetdsouza/zoxide): rejected. Display niceties for a human at a terminal.
- [repomix](https://github.com/yamadashy/repomix): rejected. The agent reads files directly, and packing a repo into one file spends context.
- [gron](https://github.com/tomnomnom/gron), [dasel](https://github.com/TomWright/dasel), [yq](https://github.com/mikefarah/yq): rejected. `jq` and Python already cover JSON, and the `coursework` CLI reads the YAML ledger.
- [just](https://github.com/casey/just), [mise](https://github.com/jdx/mise): rejected. The kit runs through `bin/` scripts and `tests/run.sh`. mise could pin the Node 22.5+ that `people` needs, but `people` already refuses older Node with a clear message.

## Lists to mine

- [ishandutta2007/Awesome-CLI-Coding-Agents](https://github.com/ishandutta2007/Awesome-CLI-Coding-Agents): rejected. 4 stars; bradagi's list covers it.
- [QAInsights/awesome-ai-tools](https://github.com/QAInsights/awesome-ai-tools): later. 26 stars, active.
- [RoggeOhta/awesome-codex-cli](https://github.com/RoggeOhta/awesome-codex-cli): later. 545 stars, for the Codex adapter.
- [kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents): later. 2.9k stars.
- [bradagi/awesome-cli-coding-agents](https://github.com/bradagi/awesome-cli-coding-agents): later. 1.3k stars, the best of the agent lists.
- [ComposioHQ/awesome-agent-clis](https://github.com/ComposioHQ/awesome-agent-clis): later (moved, see above).
- [toolleeo/awesome-cli-apps-in-a-csv](https://github.com/toolleeo/awesome-cli-apps-in-a-csv): later. Already a CSV, so it can be queried rather than read.
- [mopa/cool-cli-apps](https://github.com/mopa/cool-cli-apps): rejected. 1 star, last push 2025-03-31.
- [pinggy: best open-source CLI coding agents](https://pinggy.io/blog/best_open_source_cli_coding_agents/): later, not opened.
- [a video on CLI coding agents](https://www.youtube.com/watch?v=hJm_iVhQD6Y): later, not watched yet.

## From Caleb's notes to self (iMessage to himself, 2026-09-24 to 2026-10-08)

Pulled on 2026-10-09 by reading every message in his self-thread for those two
weeks. Credentials in that thread are deliberately left out of here.

Memory and "learns how you operate" (his search, 2026-10-08):

- [hhao/memoria](https://github.com/hhao/memoria), [cogni-ai/cogni](https://github.com/cogni-ai/cogni), [philschmid/llm-memory](https://github.com/philschmid/llm-memory), [testground/sync-engine](https://github.com/testground/sync-engine): rejected. All four 404 on the GitHub API (2026-10-09).
- [hindsight-ai/hindsight](https://github.com/hindsight-ai/hindsight): later. The link 404s; the project is probably [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) (MIT, 47k stars, active). Unconfirmed that it is the one he meant.
- [mem0ai/mem0](https://github.com/mem0ai/mem0): later. Apache-2.0, 67k stars. It extracts memories with model calls; compare against people.db `observations` on one week of texts before adopting anything.
- [letta-ai/letta](https://github.com/letta-ai/letta): rejected. A server platform for stateful agents; the kit's memory is the second brain plus people.db.
- [CaviraOSS/LongMemory](https://github.com/CaviraOSS/LongMemory): later. Apache-2.0, 4.5k stars, local memory for Claude Desktop. Read it against the second brain's memory index.
- [zilliztech/GPTCache](https://github.com/zilliztech/GPTCache): rejected. The kit doesn't repeat identical model calls at a volume where a semantic cache pays.
- [langfuse/langfuse](https://github.com/langfuse/langfuse): rejected. Needs Postgres and ClickHouse servers; the kit's receipts are local logs.
- [unum-cloud/usearch](https://github.com/unum-cloud/usearch), [facebookresearch/faiss](https://github.com/facebookresearch/faiss), [nmslib/hnswlib](https://github.com/nmslib/hnswlib): later. Approximate indexes; only if sqlite-vec's brute force is too slow at full people.db size (projected 1 to 3.5 s per query at 520k from the 100k run above).
- [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec): see the four above (run).
- [pisa-engine/pisa](https://github.com/pisa-engine/pisa): rejected. An academic inverted index; FTS5 already does keyword search in people.db.
- [ActivityWatch/activitywatch](https://github.com/ActivityWatch/activitywatch): see the four above.
- [microsoft/GraphRAG](https://github.com/microsoft/GraphRAG): later. The graph-engineering skill already teaches the idea; the library costs many model calls per document, so price one run first.
- [KuzuDB/kuzu](https://github.com/KuzuDB/kuzu): rejected. The repo is archived (last push 2025-10-10).
- [nebula-graph/nebula](https://github.com/nebula-graph/nebula): rejected. The link 404s (it moved to vesoft-inc/nebula), and it is a distributed graph database cluster; the kit's graph lives in SQLite.
- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy): later. Worth one test as a prompt optimizer for a Jev-backed judgment with a held-out set.
- [BerriAI/litellm](https://github.com/BerriAI/litellm): later. `bin/model-route` does the kit's routing; litellm only helps if a provider the kit doesn't speak gets added. License reads NOASSERTION.
- [guidance-ai/guidance](https://github.com/guidance-ai/guidance), [outlines-dev/outlines](https://github.com/outlines-dev/outlines): rejected. Ollama's own JSON-schema output covers structured local generation. Outlines moved to dottxt-ai/outlines; guidance hasn't been pushed since 2026-05-21.
- [ollama](https://ollama.com/): **used**. Installed, 7 models, and `bin/lib/context_bank.py` embeds with its embeddinggemma.
- [memorylake.ai](https://www.memorylake.ai): later, not opened.

Jev and fast routers (his search "any dope jev os type shi"). The kit already routes with Jev, so these are for comparison:

- [typesafe.ai: System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev): **used**. Jev is in the kit (`jev`, `jev-browse`, `untrusted-screen`).
- [cobanov/awesome-jev](https://github.com/cobanov/awesome-jev), [yibie/awesome-jev](https://github.com/yibie/awesome-jev): later. Lists, 531 and 2.2k stars, both active.
- [jevbest.com](https://jevbest.com/), [LangChain's post on building with Jev](https://www.langchain.com/blog/building-a-harness-with-jev): later, not opened.
- [lm-sys/RouteLLM](https://github.com/lm-sys/routellm): rejected. Last push 2024-08-10.
- [aurelio-labs/semantic-router](https://github.com/aurelio-labs/semantic-router): later. MIT, active; an embedding router to compare against Jev on the kit's routing evals.
- [vllm-project/semantic-router](https://github.com/vllm-project/semantic-router): rejected. Built to sit in front of vLLM serving, which the kit doesn't run.

AI operating systems. Read them for Chewbacca OS ideas, don't run them:

- [ritishBhatoye/AgentOS](https://github.com/ritishBhatoye/AgentOS): rejected. 1 star, no license.
- [fiatrete/OpenDAN-Personal-AI-OS](https://github.com/fiatrete/OpenDAN-Personal-AI-OS): later, to read. Last push 2026-03-28.
- [MAL19INDUSTRIES/JARVIS-OS-V.2](https://github.com/MAL19INDUSTRIES/JARVIS-OS-V.2): rejected. 106 stars, a generic assistant script collection.
- [khaled4123e/AIOS](https://github.com/khaled4123e/AIOS): rejected. Android and Kotlin; the kit is macOS.
- [agiresearch/AIOS](https://github.com/agiresearch/AIOS), [agiresearch/Cerebrum](https://github.com/agiresearch/Cerebrum): later, to read. 6.5k and 164 stars, last push 2026-07-20.
- [agiresearch/AIOS-LSFS](https://github.com/agiresearch/AIOS-LSFS): rejected. Last push 2025-03-09.

Single links he saved:

- [nicbarker/clay](https://github.com/nicbarker/clay) (2026-09-29): see the four above. It is a C layout library, not Clay.com.
- [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil) (2026-10-01): later. Already candidate 5 in `docs/ENGINE-CANDIDATES.md` and in the registry; Figma time is under the floor that decides the next surface.
- [Tobii Pro Spark eye tracker](https://www.tobii.com/products/eye-trackers/screen-based/tobii-pro-spark) (2026-10-01): later. Gaze input for the HUD; hardware purchase, Caleb's call.
- [chroma-core/chroma](https://github.com/chroma-core/chroma) (2026-09-27): rejected in favor of sqlite-vec, see above.
- [slackcli.dev](https://slackcli.dev/): **used** (the shaharia-lab slackcli site). [orchid.ai](https://orchid.ai/): later, not opened. [github.com/Mail-0](https://github.com/Mail-0) (2026-10-08): the org behind Zero, see Email.
- [Charles Zheng's reels](https://www.instagram.com/charles.zhengg/reels/) (2026-10-08): **adopted** (2026-10-10, read). All 10 reels transcribed in second-brain `raw/charles-zheng-instagram/`. The three tools his 2026-09-15 reel names are now kit skills: `grilling` (mattpocock/skills), `openspec` (Fission-AI/OpenSpec, CLI installed) and `ponytail` (DietrichGebert/ponytail). He's the cstack and api-anything author (goodnight000), and the seed of the dev-creator graph in `raw/creators/`.
- Instagram posts he saved, not opened yet: [DaeeojNCCaX](https://www.instagram.com/reel/DaeeojNCCaX/), [DbJXJi6DD9X](https://www.instagram.com/reel/DbJXJi6DD9X/), [DdY8okcERHD](https://www.instagram.com/p/DdY8okcERHD/), [DdAw0iqhWm-](https://www.instagram.com/reel/DdAw0iqhWm-/). Later.

Product direction he wrote himself, 2026-10-04: "I should literally need no app,
just chewbacca os. Honestly build gleam into it glassmorphic and everything.
Carlton told me he'd love to see what that looks like."

A prompt someone sent him on 2026-09-27, worth keeping as Chewbacca's thesis in
someone else's words: AI makes software for one person or a small group easy to
build, but deploying, sharing, securing and managing it is still hard. What
infrastructure would make purpose-built software as easy to make and share as
a Google Doc?

For the Jonah work, not Chewbacca: his self-thread also holds the Zeutara site
critique (2026-09-27, measured against uselemma.ai) and the Clay demo script for
Jonah (2026-09-25). `people texts search "Zeutara.com: why it isn't working"`
finds them.
