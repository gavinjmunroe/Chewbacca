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
- [ActivityWatch/activitywatch](https://github.com/ActivityWatch/activitywatch): **rejected** for now (2026-10-09, read). MPL-2.0, 19k stars, v0.14.0 released 2026-10-06, very active. Task: "what Caleb actually does all day". The kit already answers that from `knowledgeC.db` with no daemon: `/app/usage` had 5,316 rows in the last 7 days with the newest from today, and `docs/plans/OS-COVERAGE.md` ranks apps from it. knowledgeC also has `/app/webUsage` and `/display/isBacklit`, a rough AFK signal. ActivityWatch's one real gain is window titles, and it costs a server, a window watcher, an AFK watcher and a browser extension running all the time; issue #824 says Chrome window titles aren't tracked on macOS anyway. Reopen if per-window history becomes a need, and then copy aw-watcher-window's approach into `hud-context` rather than installing the suite.
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
- [browserbase/stagehand](https://github.com/browserbase/stagehand), [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern): rejected as installs (2026-10-09). Their idea, cache the action once and replay it without the model, is already written into `docs/plans/SITE-LEARNING.md` and `docs/plans/WEB-AGENT.md`, and api-anything does the same one level lower. Skyvern is AGPL-3.0.
- [OpenAdaptAI/OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt): **used** as a design source. Credited in `CREDITS.md`: `mac-runtime`'s plan, verify and log shape comes from its "VERIFIED only if an independent check agrees" rule.
- [nicobailon/surf-cli](https://github.com/nicobailon/surf-cli): later. Drives Chrome over a Unix socket. MIT, 633 stars, pushed 2026-10-06. It overlaps `chrome-js` and the jev Chrome bridge, so it needs one timed read against them before it earns a place.
- [NangoHQ/nango](https://github.com/NangoHQ/nango): later. OAuth and prebuilt syncs for hundreds of APIs. The pasted link pointed at janhq/jan by mistake. It is a server to self-host, and the license reads NOASSERTION, so it waits for a client that needs many APIs at once.
- [activepieces/activepieces](https://github.com/activepieces/activepieces): later. An open connector library. Same NOASSERTION license caveat; mine its connector definitions, don't run the server.
- [morluto/rea](https://github.com/morluto/rea), [rea.tools](https://rea.tools/) and its skill ([skills.sh/morluto/rea/reverse-engineer-anything](https://www.skills.sh/morluto/rea/reverse-engineer-anything)): **used**, sent 2026-10-16 with "If ppl can do it for the entire adobe stack we can do it for clay". It's installed here as the `mcp__rea__*` tools. `inspect_web_page` records which request a click sends and which script sent it, and `analyze_javascript_application` maps a bundle. The 2026-10-16 Clay view ops (c27b3dc9) came from Clay's bundle contracts, and a session is mapping every contract with REA. The Touhou essays at rea.tools/blog say the repo is the working memory and each claim needs an oracle that gets tested against cases it should reject. That's where the GTME memory design started.
- [r/gtmengineering: advanced Clay workflows](https://www.reddit.com/r/gtmengineering/comments/1swh7wc/looking_for_advanced_clay_workflows_to_reverse/): read 2026-10-16, "food for thought". The one usable point: the workflows worth copying write their fallback logic down, plus which enrichment sources are trusted at what confidence. The happy path alone doesn't count.
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

- [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice): **queued** (sent 2026-10-09, "THIS IS SO TUFF"). Apache-2.0, 9.1k stars: Docs, Sheets, Slides and PDF editors plus a `genoffice` CLI and agent skill that edit real .docx/.xlsx/.pptx locally. The engine for the glass Doc surface, CHW-194.
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
- [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil) (2026-10-01): later. Already candidate 5 in `docs/plans/ENGINE-CANDIDATES.md` and in the registry; Figma time is under the floor that decides the next surface.
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

## Animation and art repos (2026-10-09)

Caleb: "There's prob a ton of github things that are gas for animation. And
art." A sweep for the T Combinator site and the Spider-Verse study turned up
319 repos, every one opened through the GitHub API (README, license, stars,
last commit) and the top 25 shallow-cloned and code-skimmed. The full catalog,
with one-line descriptions and the exact file each one plugs into, is
[ANIMATION-ART-REPOS.md](ANIMATION-ART-REPOS.md). Status here: **later** for
all of them, since none is installed yet; rank is the catalog's.

- [paper-design/shaders](https://github.com/paper-design/shaders): later, rank 1.
- [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny): later, rank 2.
- [plutotcool/fsv](https://github.com/plutotcool/fsv): later, rank 3.
- [bnpr/Malt](https://github.com/bnpr/Malt): later, rank 4.
- [MoStyle/SMEAR](https://github.com/MoStyle/SMEAR): later, rank 5.
- [GarrettGunnell/Post-Processing](https://github.com/GarrettGunnell/Post-Processing): later, rank 6.
- [OmarShehata/webgl-outlines](https://github.com/OmarShehata/webgl-outlines): later, rank 7.
- [chsh2/nijiGPen](https://github.com/chsh2/nijiGPen): later, rank 8.
- [vvoovv/blosm](https://github.com/vvoovv/blosm): later, rank 9.
- [jamriska/ebsynth](https://github.com/jamriska/ebsynth): later, rank 10.
- [oframe/ogl](https://github.com/oframe/ogl): later, rank 11.
- [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis): later, rank 12.
- [spite/sketch](https://github.com/spite/sketch): later, rank 13.
- [Yuntokon/BlenderLayer](https://github.com/Yuntokon/BlenderLayer): later, rank 14.
- [vpalos/Krbn](https://github.com/vpalos/Krbn): later, rank 15.
- [p2or/blender-loom](https://github.com/p2or/blender-loom): later, rank 16.
- [Pullusb/storytools](https://github.com/Pullusb/storytools): later, rank 17.
- [visioncortex/vtracer](https://github.com/visioncortex/vtracer): later, rank 18.
- [patriciogonzalezvivo/lygia](https://github.com/patriciogonzalezvivo/lygia): later, rank 19.
- [EatTheFuture/camera_shakify](https://github.com/EatTheFuture/camera_shakify): later, rank 20.
- [ranjian0/building_tools](https://github.com/ranjian0/building_tools): later, rank 21.
- [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing): later, rank 22.
- [gkjohnson/three-edge-projection](https://github.com/gkjohnson/three-edge-projection): later, rank 23.
- [carolineec/informative-drawings](https://github.com/carolineec/informative-drawings): later, rank 24.
- [Doubiiu/ToonCrafter](https://github.com/Doubiiu/ToonCrafter): later, rank 25.
- [mrdoob/three.js](https://github.com/mrdoob/three.js): later, rank 26.
- [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender): later, rank 27.
- [greensock/GSAP](https://github.com/greensock/GSAP): later, rank 28.
- [theatre-js/theatre](https://github.com/theatre-js/theatre): later, rank 29.
- [Acly/krita-ai-diffusion](https://github.com/Acly/krita-ai-diffusion): later, rank 30.
- [KDE/krita](https://github.com/KDE/krita): later, rank 31.
- [princeton-vl/infinigen](https://github.com/princeton-vl/infinigen): later, rank 32.
- [RodZill4/material-maker](https://github.com/RodZill4/material-maker): later, rank 33.
- [DLR-RM/BlenderProc](https://github.com/DLR-RM/BlenderProc): later, rank 34.
- [JacquesLucke/animation_nodes](https://github.com/JacquesLucke/animation_nodes): later, rank 35.
- [Mukosame/Anime2Sketch](https://github.com/Mukosame/Anime2Sketch): later, rank 36.
- [GarrettGunnell/AcerolaFX](https://github.com/GarrettGunnell/AcerolaFX): later, rank 37.
- [fand/vfx-js](https://github.com/fand/vfx-js): later, rank 38.
- [dkaoster/scrolly-video](https://github.com/dkaoster/scrolly-video): later, rank 39.
- [MisterPrada/morph-particles](https://github.com/MisterPrada/morph-particles): later, rank 40.
- [semontesdeoca/MNPR](https://github.com/semontesdeoca/MNPR): later, rank 41.
- [ljsabc/MangaLineExtraction_PyTorch](https://github.com/ljsabc/MangaLineExtraction_PyTorch): later, rank 42.
- [bpy-dev/blender-mcp](https://github.com/bpy-dev/blender-mcp): later, rank 43.
- [Pullusb/greasepencil_tools](https://github.com/Pullusb/greasepencil_tools): later, rank 44.
- [Pullusb/GP_refine_strokes](https://github.com/Pullusb/GP_refine_strokes): later, rank 45.
- [juliangarnier/anime](https://github.com/juliangarnier/anime): later, rank 46.
- [remotion-dev/remotion](https://github.com/remotion-dev/remotion): later, rank 47.
- [motiondivision/motion](https://github.com/motiondivision/motion): later, rank 48.
- [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber): later, rank 49.
- [airbnb/lottie-web](https://github.com/airbnb/lottie-web): later, rank 50.
- [GraphiteEditor/Graphite](https://github.com/GraphiteEditor/Graphite): later, rank 51.
- [blender/blender](https://github.com/blender/blender): later, rank 52.
- [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas): later, rank 53.
- [lllyasviel/style2paints](https://github.com/lllyasviel/style2paints): later, rank 54.
- [terkelg/awesome-creative-coding](https://github.com/terkelg/awesome-creative-coding): later, rank 55.
- [pmndrs/drei](https://github.com/pmndrs/drei): later, rank 56.
- [domlysz/BlenderGIS](https://github.com/domlysz/BlenderGIS): later, rank 57.
- [locomotivemtl/locomotive-scroll](https://github.com/locomotivemtl/locomotive-scroll): later, rank 58.
- [opentoonz/opentoonz](https://github.com/opentoonz/opentoonz): later, rank 59.
- [PixarAnimationStudios/OpenUSD](https://github.com/PixarAnimationStudios/OpenUSD): later, rank 60.
- [agmmnn/awesome-blender](https://github.com/agmmnn/awesome-blender): later, rank 61.
- [patriciogonzalezvivo/thebookofshaders](https://github.com/patriciogonzalezvivo/thebookofshaders): later, rank 62.
- [regl-project/regl](https://github.com/regl-project/regl): later, rank 63.
- [armory3d/armorpaint](https://github.com/armory3d/armorpaint): later, rank 64.
- [mattdesl/canvas-sketch](https://github.com/mattdesl/canvas-sketch): later, rank 65.
- [cocopon/tweakpane](https://github.com/cocopon/tweakpane): later, rank 66.
- [spite/ccapture.js](https://github.com/spite/ccapture.js): later, rank 67.
- [Auburn/FastNoiseLite](https://github.com/Auburn/FastNoiseLite): later, rank 68.
- [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh): later, rank 69.
- [fogleman/ln](https://github.com/fogleman/ln): later, rank 70.
- [AcademySoftwareFoundation/openvdb](https://github.com/AcademySoftwareFoundation/openvdb): later, rank 71.
- [software-mansion/TypeGPU](https://github.com/software-mansion/TypeGPU): later, rank 72.
- [nateherkai/scroll-craft](https://github.com/nateherkai/scroll-craft): later, rank 73.
- [mypaint/mypaint](https://github.com/mypaint/mypaint): later, rank 74.
- [nortikin/sverchok](https://github.com/nortikin/sverchok): later, rank 75.
- [gpac/mp4box.js](https://github.com/gpac/mp4box.js): later, rank 76.
- [AcademySoftwareFoundation/OpenImageIO](https://github.com/AcademySoftwareFoundation/OpenImageIO): later, rank 77.
- [AcademySoftwareFoundation/OpenShadingLanguage](https://github.com/AcademySoftwareFoundation/OpenShadingLanguage): later, rank 78.
- [hzwer/ICCV2019-LearningToPaint](https://github.com/hzwer/ICCV2019-LearningToPaint): later, rank 79.
- [AcademySoftwareFoundation/MaterialX](https://github.com/AcademySoftwareFoundation/MaterialX): later, rank 80.
- [ucupumar/ucupaint](https://github.com/ucupumar/ucupaint): later, rank 81.
- [AcademySoftwareFoundation/OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO): later, rank 82.
- [rlguy/Blender-FLIP-Fluids](https://github.com/rlguy/Blender-FLIP-Fluids): later, rank 83.
- [martinlaxenaire/curtainsjs](https://github.com/martinlaxenaire/curtainsjs): later, rank 84.
- [pencil2d/pencil](https://github.com/pencil2d/pencil): later, rank 85.
- [basementstudio/scrollytelling](https://github.com/basementstudio/scrollytelling): later, rank 86.
- [jiupinjia/stylized-neural-painting](https://github.com/jiupinjia/stylized-neural-painting): later, rank 87.
- [jankovicsandras/imagetracerjs](https://github.com/jankovicsandras/imagetracerjs): later, rank 88.
- [amandaghassaei/gpu-io](https://github.com/amandaghassaei/gpu-io): later, rank 89.
- [dillongoostudios/goo-engine](https://github.com/dillongoostudios/goo-engine): later, rank 90.
- [FarazzShaikh/THREE-CustomShaderMaterial](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial): later, rank 91.
- [BachiLi/diffvg](https://github.com/BachiLi/diffvg): later, rank 92.
- [dgreenheck/webgpu-claude-skill](https://github.com/dgreenheck/webgpu-claude-skill): later, rank 93.
- [naoto0804/pytorch-AdaIN](https://github.com/naoto0804/pytorch-AdaIN): later, rank 94.
- [rive-app/rive-react](https://github.com/rive-app/rive-react): later, rank 95.
- [grizzlypeak3d/DJV](https://github.com/grizzlypeak3d/DJV): later, rank 96.
- [festivities/Blender-miHoYo-Shaders](https://github.com/festivities/Blender-miHoYo-Shaders): later, rank 97.
- [tomayac/SVGcode](https://github.com/tomayac/SVGcode): later, rank 98.
- [Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks): later, rank 99.
- [hzwer/Practical-RIFE](https://github.com/hzwer/Practical-RIFE): later, rank 100.
- [shteeve3d/blender-wiggle-2](https://github.com/shteeve3d/blender-wiggle-2): later, rank 101.
- [acamposuribe/p5.brush](https://github.com/acamposuribe/p5.brush): later, rank 102.
- [14islands/r3f-scroll-rig](https://github.com/14islands/r3f-scroll-rig): later, rank 103.
- [Acly/krita-vision-tools](https://github.com/Acly/krita-vision-tools): later, rank 104.
- [rive-app/rive-wasm](https://github.com/rive-app/rive-wasm): later, rank 105.
- [yael-vinker/CLIPasso](https://github.com/yael-vinker/CLIPasso): later, rank 106.
- [abey79/vpype](https://github.com/abey79/vpype): later, rank 107.
- [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web): later, rank 108.
- [LingDong-/linedraw](https://github.com/LingDong-/linedraw): later, rank 109.
- [njbrown/texturelab](https://github.com/njbrown/texturelab): later, rank 110.
- [AcademySoftwareFoundation/OpenRV](https://github.com/AcademySoftwareFoundation/OpenRV): later, rank 111.
- [autotrace/autotrace](https://github.com/autotrace/autotrace): later, rank 112.
- [JacquesLucke/blender_vscode](https://github.com/JacquesLucke/blender_vscode): later, rank 113.
- [tahoma2d/tahoma2d](https://github.com/tahoma2d/tahoma2d): later, rank 114.
- [Picsart-AI-Research/LIVE-Layerwise-Image-Vectorization](https://github.com/Picsart-AI-Research/LIVE-Layerwise-Image-Vectorization): later, rank 115.
- [LingDong-/skeleton-tracing](https://github.com/LingDong-/skeleton-tracing): later, rank 116.
- [stegu/webgl-noise](https://github.com/stegu/webgl-noise): later, rank 117.
- [SSARCandy/Coherent-Line-Drawing](https://github.com/SSARCandy/Coherent-Line-Drawing): later, rank 118.
- [Huage001/PaintTransformer](https://github.com/Huage001/PaintTransformer): later, rank 119.
- [KubeezMedia/kubeez-scroll-world-video](https://github.com/KubeezMedia/kubeez-scroll-world-video): later, rank 120.
- [crowsonkb/style-transfer-pytorch](https://github.com/crowsonkb/style-transfer-pytorch): later, rank 121.
- [Deevad/deevad-krita-brushpresets](https://github.com/Deevad/deevad-krita-brushpresets): later, rank 122.
- [mypaint/libmypaint](https://github.com/mypaint/libmypaint): later, rank 123.
- [pmndrs/meshline](https://github.com/pmndrs/meshline): later, rank 124.
- [skyrpex/potrace](https://github.com/skyrpex/potrace): later, rank 125.
- [vaneenige/THREE.Phenomenon](https://github.com/vaneenige/THREE.Phenomenon): later, rank 126.
- [GDQuest/krita-free-brushes](https://github.com/GDQuest/krita-free-brushes): later, rank 127.
- [Rakurri/rakurri-brush-set-for-krita](https://github.com/Rakurri/rakurri-brush-set-for-krita): later, rank 128.
- [MarkMoHR/virtual_sketching](https://github.com/MarkMoHR/virtual_sketching): later, rank 129.
- [nkolkin13/NeuralNeighborStyleTransfer](https://github.com/nkolkin13/NeuralNeighborStyleTransfer): later, rank 130.
- [ubisoft/shotmanager](https://github.com/ubisoft/shotmanager): later, rank 131.
- [mattdesl/glsl-film-grain](https://github.com/mattdesl/glsl-film-grain): later, rank 132.
- [heisenshark/blender-krita-link-plugin](https://github.com/heisenshark/blender-krita-link-plugin): later, rank 133.
- [plottertools/hatched](https://github.com/plottertools/hatched): later, rank 134.
- [mustache-dev/Three-VFX](https://github.com/mustache-dev/Three-VFX): later, rank 135.
- [yeataro/TD-Anisotropic-Kuwahara](https://github.com/yeataro/TD-Anisotropic-Kuwahara): later, rank 136.
- [m5kr1pka/canvas-scroll-clip](https://github.com/m5kr1pka/canvas-scroll-clip): later, rank 137.
- [verekia/tslfx](https://github.com/verekia/tslfx): later, rank 138.
- [gkjohnson/three-jumpflood-demo](https://github.com/gkjohnson/three-jumpflood-demo): later, rank 139.
- [Kenton-GMI/sakuragaoka-station](https://github.com/Kenton-GMI/sakuragaoka-station): later, rank 140.
- [lvoxx/LSCherry](https://github.com/lvoxx/LSCherry): later, rank 141.
- [sahilsaini5/ditherwave](https://github.com/sahilsaini5/ditherwave): later, rank 142.
- [hertzmann/painterJava](https://github.com/hertzmann/painterJava): later, rank 143.
- [MarkMoHR/JoSTC](https://github.com/MarkMoHR/JoSTC): later, rank 144.
- [msurguy/watercolor-playground](https://github.com/msurguy/watercolor-playground): later, rank 145.
- [EmuMan/npr-face-shader](https://github.com/EmuMan/npr-face-shader): later, rank 146.
- [alvdansen/animating-on-twos](https://github.com/alvdansen/animating-on-twos): later, rank 147.
- [glslify/glsl-halftone](https://github.com/glslify/glsl-halftone): later, rank 148.
- [StarKnightt/summer-cycle](https://github.com/StarKnightt/summer-cycle): later, rank 149.
- [FuouM/ReEzSynth](https://github.com/FuouM/ReEzSynth): later, rank 150.
- [zippy731/vamp](https://github.com/zippy731/vamp): later, rank 151.
- [waylow/add_camera_rigs](https://github.com/waylow/add_camera_rigs): later, rank 152.
- [yoch/pykuwahara](https://github.com/yoch/pykuwahara): later, rank 153.
- [rogudator/rogudators_speech_bubble_generator](https://github.com/rogudator/rogudators_speech_bubble_generator): later, rank 154.
- [rogudator/rogudators_comic_panel_generator](https://github.com/rogudator/rogudators_comic_panel_generator): later, rank 155.
- [fcole/dpix](https://github.com/fcole/dpix): later, rank 156.
- [processing/p5.js](https://github.com/processing/p5.js): later, rank 157.
- [lettier/3d-game-shaders-for-beginners](https://github.com/lettier/3d-game-shaders-for-beginners): later, rank 158.
- [fogleman/primitive](https://github.com/fogleman/primitive): later, rank 159.
- [lengstrom/fast-style-transfer](https://github.com/lengstrom/fast-style-transfer): later, rank 160.
- [LingDong-/shan-shui-inf](https://github.com/LingDong-/shan-shui-inf): later, rank 161.
- [pmndrs/leva](https://github.com/pmndrs/leva): later, rank 162.
- [DavidHDev/canvas-ui](https://github.com/DavidHDev/canvas-ui): later, rank 163.
- [brunosimon/folio-2019](https://github.com/brunosimon/folio-2019): later, rank 164.
- [OpenMoonRay/openmoonray](https://github.com/OpenMoonRay/openmoonray): later, rank 165.
- [joanrod/star-vector](https://github.com/joanrod/star-vector): later, rank 166.
- [brunosimon/my-room-in-3d](https://github.com/brunosimon/my-room-in-3d): later, rank 167.
- [bryandlee/animegan2-pytorch](https://github.com/bryandlee/animegan2-pytorch): later, rank 168.
- [midrender/revideo](https://github.com/midrender/revideo): later, rank 169.
- [lllyasviel/Paints-UNDO](https://github.com/lllyasviel/Paints-UNDO): later, rank 170.
- [thi-ng/umbrella](https://github.com/thi-ng/umbrella): later, rank 171.
- [vijishmadhavan/ArtLine](https://github.com/vijishmadhavan/ArtLine): later, rank 172.
- [williamyang1991/VToonify](https://github.com/williamyang1991/VToonify): later, rank 173.
- [google-research/frame-interpolation](https://github.com/google-research/frame-interpolation): later, rank 174.
- [bradley/Blotter](https://github.com/bradley/Blotter): later, rank 175.
- [PixarAnimationStudios/OpenSubdiv](https://github.com/PixarAnimationStudios/OpenSubdiv): later, rank 176.
- [gre/gl-react](https://github.com/gre/gl-react): later, rank 177.
- [pmndrs/react-three-next](https://github.com/pmndrs/react-three-next): later, rank 178.
- [synfig/synfig](https://github.com/synfig/synfig): later, rank 179.
- [glslify/glslify](https://github.com/glslify/glslify): later, rank 180.
- [webgpu/webgpu-samples](https://github.com/webgpu/webgpu-samples): later, rank 181.
- [AcademySoftwareFoundation/OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO): later, rank 182.
- [fogleman/sdf](https://github.com/fogleman/sdf): later, rank 183.
- [gkjohnson/three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer): later, rank 184.
- [bootchk/resynthesizer](https://github.com/bootchk/resynthesizer): later, rank 185.
- [AcademySoftwareFoundation/openexr](https://github.com/AcademySoftwareFoundation/openexr): later, rank 186.
- [thorvg/thorvg](https://github.com/thorvg/thorvg): later, rank 187.
- [friction2d/friction](https://github.com/friction2d/friction): later, rank 188.
- [BrokenSource/DepthFlow](https://github.com/BrokenSource/DepthFlow): later, rank 189.
- [beardicus/awesome-plotters](https://github.com/beardicus/awesome-plotters): later, rank 190.
- [pmndrs/react-postprocessing](https://github.com/pmndrs/react-postprocessing): later, rank 191.
- [pmndrs/math](https://github.com/pmndrs/math): later, rank 192.
- [creativelifeform/three-nebula](https://github.com/creativelifeform/three-nebula): later, rank 193.
- [Kiri-Innovation/3dgs-render-blender-addon](https://github.com/Kiri-Innovation/3dgs-render-blender-addon): later, rank 194.
- [rive-app/rive-runtime](https://github.com/rive-app/rive-runtime): later, rank 195.
- [aachman98/Sorcar](https://github.com/aachman98/Sorcar): later, rank 196.
- [pixijs/filters](https://github.com/pixijs/filters): later, rank 197.
- [GafferHQ/gaffer](https://github.com/GafferHQ/gaffer): later, rank 198.
- [electricsquare/raymarching-workshop](https://github.com/electricsquare/raymarching-workshop): later, rank 199.
- [zhanghang1989/PyTorch-Multi-Style-Transfer](https://github.com/zhanghang1989/PyTorch-Multi-Style-Transfer): later, rank 200.
- [darkroomengineering/satus](https://github.com/darkroomengineering/satus): later, rank 201.
- [friggog/tree-gen](https://github.com/friggog/tree-gen): later, rank 202.
- [pmndrs/three-stdlib](https://github.com/pmndrs/three-stdlib): later, rank 203.
- [ProGamerGov/neural-style-pt](https://github.com/ProGamerGov/neural-style-pt): later, rank 204.
- [shader-park/shader-park-core](https://github.com/shader-park/shader-park-core): later, rank 205.
- [AcademySoftwareFoundation/OpenPBR](https://github.com/AcademySoftwareFoundation/OpenPBR): later, rank 206.
- [aresdevo/animaide](https://github.com/aresdevo/animaide): later, rank 207.
- [JasonMa0012/MooaToon](https://github.com/JasonMa0012/MooaToon): later, rank 208.
- [rive-app/awesome-rive](https://github.com/rive-app/awesome-rive): later, rank 209.
- [matiascodesal/awesome-openusd](https://github.com/matiascodesal/awesome-openusd): later, rank 210.
- [LordLiang/DrawingSpinUp](https://github.com/LordLiang/DrawingSpinUp): later, rank 211.
- [blender/cycles](https://github.com/blender/cycles): later, rank 212.
- [abey79/vsketch](https://github.com/abey79/vsketch): later, rank 213.
- [josauder/procedural_city_generation](https://github.com/josauder/procedural_city_generation): later, rank 214.
- [mmmerl/shader-doodle](https://github.com/mmmerl/shader-doodle): later, rank 215.
- [MarkMoHR/Awesome-Sketch-Synthesis](https://github.com/MarkMoHR/Awesome-Sketch-Synthesis): later, rank 216.
- [Kai-46/ARF-svox2](https://github.com/Kai-46/ARF-svox2): later, rank 217.
- [N8python/n8ao](https://github.com/N8python/n8ao): later, rank 218.
- [wdas/partio](https://github.com/wdas/partio): later, rank 219.
- [lllyasviel/sketchKeras](https://github.com/lllyasviel/sketchKeras): later, rank 220.
- [lisiyao21/AnimeInterp](https://github.com/lisiyao21/AnimeInterp): later, rank 221.
- [wdas/SeExpr](https://github.com/wdas/SeExpr): later, rank 222.
- [UstymUkhman/vite-plugin-glsl](https://github.com/UstymUkhman/vite-plugin-glsl): later, rank 223.
- [btk/vectorizer](https://github.com/btk/vectorizer): later, rank 224.
- [GDQuest/krita-batch-exporter](https://github.com/GDQuest/krita-batch-exporter): later, rank 225.
- [OmooLab/BioxelNodes](https://github.com/OmooLab/BioxelNodes): later, rank 226.
- [cpichard/usdtweak](https://github.com/cpichard/usdtweak): later, rank 227.
- [rrmina/fast-neural-style-pytorch](https://github.com/rrmina/fast-neural-style-pytorch): later, rank 228.
- [kayac/kamakura-shaders](https://github.com/kayac/kamakura-shaders): later, rank 229.
- [Falano/kritaSpritesheetManager](https://github.com/Falano/kritaSpritesheetManager): later, rank 230.
- [LuggLD/SmearFrame](https://github.com/LuggLD/SmearFrame): later, rank 231.
- [kilobtye/potrace](https://github.com/kilobtye/potrace): later, rank 232.
- [codrops/ScrollBasedLayoutAnimations](https://github.com/codrops/ScrollBasedLayoutAnimations): later, rank 233.
- [NevermindNilas/TheAnimeScripter](https://github.com/NevermindNilas/TheAnimeScripter): later, rank 234.
- [PrismPipeline/QuiltiX](https://github.com/PrismPipeline/QuiltiX): later, rank 235.
- [MisterPrada/singularity](https://github.com/MisterPrada/singularity): later, rank 236.
- [ximinng/DiffSketcher](https://github.com/ximinng/DiffSketcher): later, rank 237.
- [festivities/Blender-StellarToon](https://github.com/festivities/Blender-StellarToon): later, rank 238.
- [ertdfgcvb/Sequencer](https://github.com/ertdfgcvb/Sequencer): later, rank 239.
- [EyeOdin/Pigment.O](https://github.com/EyeOdin/Pigment.O): later, rank 240.
- [arjun988/blender-skills](https://github.com/arjun988/blender-skills): later, rank 241.
- [openshaders/openshaders](https://github.com/openshaders/openshaders): later, rank 242.
- [Ameobea/three-good-godrays](https://github.com/Ameobea/three-good-godrays): later, rank 243.
- [jdhoek/inkscape-isometric-projection](https://github.com/jdhoek/inkscape-isometric-projection): later, rank 244.
- [hughsk/glsl-dither](https://github.com/hughsk/glsl-dither): later, rank 245.
- [ektogamat/r3f-webgpu-starter](https://github.com/ektogamat/r3f-webgpu-starter): later, rank 246.
- [armstrongl/awesome-krita](https://github.com/armstrongl/awesome-krita): later, rank 247.
- [hepesu/LineDistiller](https://github.com/hepesu/LineDistiller): later, rank 248.
- [martinlaxenaire/gpu-curtains](https://github.com/martinlaxenaire/gpu-curtains): later, rank 249.
- [LucaScheller/VFX-UsdSurvivalGuide](https://github.com/LucaScheller/VFX-UsdSurvivalGuide): later, rank 250.
- [flupke/pypotrace](https://github.com/flupke/pypotrace): later, rank 251.
- [HoldMyBeer-gg/blenderwright](https://github.com/HoldMyBeer-gg/blenderwright): later, rank 252.
- [ybouane/VideoFlow](https://github.com/ybouane/VideoFlow): later, rank 253.
- [johnroper100/CrowdMaster](https://github.com/johnroper100/CrowdMaster): later, rank 254.
- [Trentonom0r3/Ezsynth](https://github.com/Trentonom0r3/Ezsynth): later, rank 255.
- [ShuhongChen/eisai-anime-interpolator](https://github.com/ShuhongChen/eisai-anime-interpolator): later, rank 256.
- [rolyatmax/watercolor-canvas](https://github.com/rolyatmax/watercolor-canvas): later, rank 257.
- [cullenwebber/three-ml-sharp](https://github.com/cullenwebber/three-ml-sharp): later, rank 258.
- [Tams3d/T3D-GN-Presets](https://github.com/Tams3d/T3D-GN-Presets): later, rank 259.
- [philgyford/python-halftone](https://github.com/philgyford/python-halftone): later, rank 260.
- [InteractiveComputerGraphics/blender-sequence-loader](https://github.com/InteractiveComputerGraphics/blender-sequence-loader): later, rank 261.
- [mayacoda/toon-shader](https://github.com/mayacoda/toon-shader): later, rank 262.
- [KnowZero/Krita-PythonPluginDeveloperTools](https://github.com/KnowZero/Krita-PythonPluginDeveloperTools): later, rank 263.
- [Ameobea/sketches-3d](https://github.com/Ameobea/sketches-3d): later, rank 264.
- [kanzwataru/EEVEEToon](https://github.com/kanzwataru/EEVEEToon): later, rank 265.
- [NHasan143/delaunay-stippler](https://github.com/NHasan143/delaunay-stippler): later, rank 266.
- [bnpr/BEER](https://github.com/bnpr/BEER): later, rank 267.
- [cl0nazepamm/powershot-threejs](https://github.com/cl0nazepamm/powershot-threejs): later, rank 268.
- [folkertdev/freestyle-svg-exporter](https://github.com/folkertdev/freestyle-svg-exporter): later, rank 269.
- [Celstomp/celstomp](https://github.com/Celstomp/celstomp): later, rank 270.
- [its2easy/animate-images](https://github.com/its2easy/animate-images): later, rank 271.
- [doakey3/GreaseWriter](https://github.com/doakey3/GreaseWriter): later, rank 272.
- [thorvg/thorvg.web](https://github.com/thorvg/thorvg.web): later, rank 273.
- [Pullusb/viewport_timeline_scrub](https://github.com/Pullusb/viewport_timeline_scrub): later, rank 274.
- [folkertdev/freestyle-gpencil-exporter](https://github.com/folkertdev/freestyle-gpencil-exporter): later, rank 275.
- [thomaslynge/krita-plugins](https://github.com/thomaslynge/krita-plugins): later, rank 276.
- [dcc-mcp/dcc-mcp-blender](https://github.com/dcc-mcp/dcc-mcp-blender): later, rank 277.
- [SkyeShark/threejs-silhouette-pom](https://github.com/SkyeShark/threejs-silhouette-pom): later, rank 278.
- [mypaint/mypaint-brushes](https://github.com/mypaint/mypaint-brushes): later, rank 279.
- [adamb70/Spiderverse-Shader-Unity](https://github.com/adamb70/Spiderverse-Shader-Unity): later, rank 280.
- [FelineEntity/Outline-Helper](https://github.com/FelineEntity/Outline-Helper): later, rank 281.
- [Pullusb/curveRig](https://github.com/Pullusb/curveRig): later, rank 282.
- [yuki-koyama/btoon](https://github.com/yuki-koyama/btoon): later, rank 283.
- [Pullusb/breakdowner](https://github.com/Pullusb/breakdowner): later, rank 284.
- [kerimcharfi/frame-scroll-animation](https://github.com/kerimcharfi/frame-scroll-animation): later, rank 285.
- [a1studmuffin/SpaceshipGenerator](https://github.com/a1studmuffin/SpaceshipGenerator): later, rank 286.
- [ruucm/shadergradient](https://github.com/ruucm/shadergradient): later, rank 287.
- [LingDong-/fishdraw](https://github.com/LingDong-/fishdraw): later, rank 288.
- [wdas/brdf](https://github.com/wdas/brdf): later, rank 289.
- [codrops/RainEffect](https://github.com/codrops/RainEffect): later, rank 290.
- [LottieFiles/lottie-player](https://github.com/LottieFiles/lottie-player): later, rank 291.
- [inkstitch/inkstitch](https://github.com/inkstitch/inkstitch): later, rank 292.
- [ubisoft/mixer](https://github.com/ubisoft/mixer): later, rank 293.
- [jbilcke-hf/ai-comic-factory](https://github.com/jbilcke-hf/ai-comic-factory): later, rank 294.
- [pmndrs/triplex](https://github.com/pmndrs/triplex): later, rank 295.
- [s9roll7/ebsynth_utility](https://github.com/s9roll7/ebsynth_utility): later, rank 296.
- [MaurycyLiebner/enve](https://github.com/MaurycyLiebner/enve): later, rank 297.
- [textext/textext](https://github.com/textext/textext): later, rank 298.
- [spite/Wagner](https://github.com/spite/Wagner): later, rank 299.
- [wdas/ptex](https://github.com/wdas/ptex): later, rank 300.
- [fablabnbg/inkscape-silhouette](https://github.com/fablabnbg/inkscape-silhouette): later, rank 301.
- [evil-mad/axidraw](https://github.com/evil-mad/axidraw): later, rank 302.
- [blender/blender-addons](https://github.com/blender/blender-addons): later, rank 303.
- [dreamworksanimation/usdmanager](https://github.com/dreamworksanimation/usdmanager): later, rank 304.
- [inconvergent/svgsort](https://github.com/inconvergent/svgsort): later, rank 305.
- [veryprofessionaldodo/Krita-UI-Redesign](https://github.com/veryprofessionaldodo/Krita-UI-Redesign): later, rank 306.
- [codrops/codrops-sketches](https://github.com/codrops/codrops-sketches): later, rank 307.
- [Fyrestar/THREE.InfiniteGridHelper](https://github.com/Fyrestar/THREE.InfiniteGridHelper): later, rank 308.
- [abrasic/abratools](https://github.com/abrasic/abratools): later, rank 309.
- [ghepting/javascript-video-scrubber](https://github.com/ghepting/javascript-video-scrubber): later, rank 310.
- [JacquesLucke/Blender-Camera-Addon](https://github.com/JacquesLucke/Blender-Camera-Addon): later, rank 311.
- [ma-xu/LIVE](https://github.com/ma-xu/LIVE): later, rank 312.
- [finnursig/VideoScroller](https://github.com/finnursig/VideoScroller): later, rank 313.
- [lsimic/ProceduralBuildingGenerator](https://github.com/lsimic/ProceduralBuildingGenerator): later, rank 314.
- [Pullusb/GP_brush_fill](https://github.com/Pullusb/GP_brush_fill): later, rank 315.
- [jaelpark/droplet-render](https://github.com/jaelpark/droplet-render): later, rank 316.
- [Grum999/BuliCommander](https://github.com/Grum999/BuliCommander): later, rank 317.
- [oneilltomhq/lib3](https://github.com/oneilltomhq/lib3): rejected, see the catalog's rejected list.
- [Zylann/godot_sdf_blender](https://github.com/Zylann/godot_sdf_blender): rejected, see the catalog's rejected list.
