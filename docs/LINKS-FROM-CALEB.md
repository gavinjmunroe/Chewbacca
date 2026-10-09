# Links Caleb sent for Chewbacca

Every repo and link Caleb pasted during the 2026-10-08 messaging session, kept
whole so none get lost. Backlog items CB-517 to CB-522 point here. Most came
from Google AI Mode answers he pasted in. Their descriptions are that source's
words, unverified, and one of its links was wrong (noted below).

What happened to each so far: **used** means it's in the kit now, **rejected**
means looked at and decided against (with why), **later** means not evaluated
yet.

## Messaging and Slack

- [shaharia-lab/slackcli](https://github.com/shaharia-lab/slackcli): **used**. Slack sending, `chewbacca slack link`.
- [openclaw/slacrawl](https://github.com/openclaw/slacrawl): **used**. Slack reading from the desktop cache.
- [open-cli-collective/slack-chat-api](https://github.com/piekstra/slack-cli) (`slck`, the old piekstra/slack-cli): later. Slack Web API CLI with keyring auth.
- [Slack's official CLI](https://docs.slack.dev/tools/slack-cli/guides/running-slack-cli-commands): rejected. It builds Slack apps and can't send ad-hoc messages.
- The pasted `msg` shell script (webhooks plus a named pipe): rejected. Webhooks can't DM a person, the JSON breaks on quotes, and `eval` runs input. `people send` does the job.
- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks), [App manifest reference](https://docs.slack.dev/reference/app-manifest): reference only.
- `@rvgpl/slack-message` (npm), the bash `slack-cli`, and the Rust `slack-cli` crate: rejected. Each needs a bot token or webhook.
- [larksuite/cli](https://github.com/larksuite/cli): later. Lark messaging, scheduling and tasks.
- [paperfoot/clinstagram](https://github.com/paperfoot/clinstagram): later. Instagram from the terminal, a candidate for Instagram DMs.
- [Android: send data to other apps](https://developer.android.com/develop/ui/compose/sharing/send): reference for an OS-wide share/send model.
- [High-level design for an IM app](https://levelup.gitconnected.com/high-level-design-for-an-instant-messaging-app-like-whatsapp-b2974d82124a): reference.

## Email

- [mail-0/zero](https://github.com/mail-0/zero): later, to mine for parts (CB-521). Running it is rejected: it needs Docker, Postgres and its own OAuth app, and it hasn't been pushed since 2026-05-26, so it would be a second app the way Plynn was.
- [elie222/inbox-zero](https://github.com/elie222/inbox-zero): later (CB-521). AI triage for Gmail.

## Apps with no API (the "never open an app" layer)

- [goodnight000/api-anything](https://github.com/goodnight000/api-anything): later (CB-519). It turns any website into an API by learning the site's frontend. Caleb's take: "this one is insane".
- [browser-use/browser-use](https://github.com/browser-use/browser-use), [browserbase/stagehand](https://github.com/browserbase/stagehand), [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern), [OpenAdaptAI/OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt): later (CB-522). Compare each against jev-browse on one real task.
- [nicobailon/surf-cli](https://github.com/nicobailon/surf-cli): later. Drives Chrome over a Unix socket.
- [NangoHQ/nango](https://github.com/NangoHQ/nango): later. OAuth and prebuilt syncs for hundreds of APIs. The pasted link pointed at janhq/jan by mistake.
- [activepieces/activepieces](https://github.com/activepieces/activepieces): later. An open connector library.
- Composio CLI ([ComposioHQ/awesome-agent-clis](https://github.com/ComposioHQ/awesome-agent-clis)): later. App actions for agents.

## Agent and OS building blocks

- [goodnight000/cstack](https://github.com/goodnight000/cstack): later. Agent skills, starting with Reflect (evidence-backed reviews). 8 stars.
- [FastMCP client](https://gofastmcp.com/cli/client), [chrishayuk/mcp-cli](https://mcpservers.org/servers/chrishayuk/mcp-cli): later.
- [OpenCode](https://opencode.ai/install), [Gemini CLI, Aider, Codex CLI, Dorothy, Claw Code](https://github.com/bradagi/awesome-cli-coding-agents): later. Each is another runtime `chewbacca connect` could wire.
- [microsoft/semantic-kernel](https://github.com/microsoft/semantic-kernel), [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph), [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI): later. Compare against the kit's own task graphs before adopting.
- [temporalio/temporal](https://github.com/temporalio/temporal), [statelyai/xstate](https://github.com/statelyai/xstate): later. For long-running tasks and state machines.
- [lancedb/lancedb](https://github.com/lancedb/lancedb), [chroma-core/chroma](https://github.com/chroma-core/chroma): later. Local vector memory.
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri), [electron/electron](https://github.com/electron/electron), [shadcn-ui/ui](https://github.com/shadcn-ui/ui), [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit), [socketio/socket.io](https://github.com/socketio/socket.io): later. Shell and generated-UI pieces for the HUD.
- [janhq/jan](https://github.com/janhq/jan), [TabbyML/tabby](https://github.com/TabbyML/tabby): later. Local models.

## Open-source apps Chewbacca could replace or reuse

[calcom/cal.com](https://github.com/calcom/cal.com),
[chatwoot/chatwoot](https://github.com/chatwoot/chatwoot),
[AFFiNE](https://github.com/toeverything/AFFiNE),
[AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy),
[excalidraw/excalidraw](https://github.com/excalidraw/excalidraw),
[twentyhq/twenty](https://github.com/twentyhq/twenty),
[nocodb/nocodb](https://github.com/nocodb/nocodb),
[documenso/documenso](https://github.com/documenso/documenso),
[supabase/supabase](https://github.com/supabase/supabase),
[hoppscotch/hoppscotch](https://github.com/hoppscotch/hoppscotch),
[infisical/infisical](https://github.com/infisical/infisical),
[umami-software/umami](https://github.com/umami-software/umami),
[coollabsio/coolify](https://github.com/coollabsio/coolify),
[immich-app/immich](https://github.com/immich-app/immich),
[Stirling-Tools/Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF),
[localsend/localsend](https://github.com/localsend/localsend),
[corentinth/it-tools](https://github.com/corentinth/it-tools),
[pluja/awesome-privacy](https://github.com/pluja/awesome-privacy). All later.
Check each against the `oss-apps` registry before adding.

## Developer shell tools

[atuin](https://github.com/atuinsh/atuin), [bruno](https://github.com/usebruno/bruno),
[jesseduffield/lazygit](https://github.com/jesseduffield/lazygit), [sharkdp/bat](https://github.com/sharkdp/bat),
[ajeetdsouza/zoxide](https://github.com/ajeetdsouza/zoxide), [eza](https://github.com/eza-community/eza),
[repomix](https://github.com/yamadashy/repomix), [yazi](https://github.com/sxyazi/yazi),
[superfile](https://github.com/yorukot/superfile), [lazydocker](https://github.com/jesseduffield/lazydocker),
[k9s](https://github.com/derailed/k9s), [zellij-org/zellij](https://github.com/zellij-org/zellij),
[posting](https://github.com/darrenburns/posting), [slumber](https://github.com/LucasPickering/slumber),
[gron](https://github.com/tomnomnom/gron), [dasel](https://github.com/TomWright/dasel),
[yq](https://github.com/mikefarah/yq), [just](https://github.com/casey/just), [mise](https://github.com/jdx/mise). All later.

## Lists to mine

[ishandutta2007/Awesome-CLI-Coding-Agents](https://github.com/ishandutta2007/Awesome-CLI-Coding-Agents),
[QAInsights/awesome-ai-tools](https://github.com/QAInsights/awesome-ai-tools),
[RoggeOhta/awesome-codex-cli](https://github.com/RoggeOhta/awesome-codex-cli),
[kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents),
[bradagi/awesome-cli-coding-agents](https://github.com/bradagi/awesome-cli-coding-agents),
[ComposioHQ/awesome-agent-clis](https://github.com/ComposioHQ/awesome-agent-clis),
[toolleeo/awesome-cli-apps-in-a-csv](https://github.com/toolleeo/awesome-cli-apps-in-a-csv),
[mopa/cool-cli-apps](https://github.com/mopa/cool-cli-apps),
[pinggy: best open-source CLI coding agents](https://pinggy.io/blog/best_open_source_cli_coding_agents/),
[a video on CLI coding agents](https://www.youtube.com/watch?v=hJm_iVhQD6Y) (not watched yet).

## From Caleb's notes to self (iMessage to himself, 2026-09-24 to 2026-10-08)

Pulled on 2026-10-09 by reading every message in his self-thread for those two
weeks. Credentials in that thread are deliberately left out of here.

Memory and "learns how you operate" (his search, 2026-10-08):
[hhao/memoria](https://github.com/hhao/memoria),
[mem0ai/mem0](https://github.com/mem0ai/mem0),
[cogni-ai/cogni](https://github.com/cogni-ai/cogni),
[hindsight-ai/hindsight](https://github.com/hindsight-ai/hindsight),
[letta-ai/letta](https://github.com/letta-ai/letta),
[CaviraOSS/LongMemory](https://github.com/CaviraOSS/LongMemory),
[philschmid/llm-memory](https://github.com/philschmid/llm-memory),
[zilliztech/GPTCache](https://github.com/zilliztech/GPTCache),
[langfuse/langfuse](https://github.com/langfuse/langfuse),
[unum-cloud/usearch](https://github.com/unum-cloud/usearch),
[asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) (fits people.db directly),
[facebookresearch/faiss](https://github.com/facebookresearch/faiss),
[nmslib/hnswlib](https://github.com/nmslib/hnswlib),
[pisa-engine/pisa](https://github.com/pisa-engine/pisa),
[ActivityWatch/activitywatch](https://github.com/ActivityWatch/activitywatch) (what he actually does all day, local),
[microsoft/GraphRAG](https://github.com/microsoft/GraphRAG),
[KuzuDB/kuzu](https://github.com/KuzuDB/kuzu),
[nebula-graph/nebula](https://github.com/nebula-graph/nebula),
[testground/sync-engine](https://github.com/testground/sync-engine),
[stanfordnlp/dspy](https://github.com/stanfordnlp/dspy),
[BerriAI/litellm](https://github.com/BerriAI/litellm),
[guidance-ai/guidance](https://github.com/guidance-ai/guidance),
[outlines-dev/outlines](https://github.com/outlines-dev/outlines),
[ollama](https://ollama.com/),
[memorylake.ai](https://www.memorylake.ai). All later.

Jev and fast routers (his search "any dope jev os type shi"):
[typesafe.ai: System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[cobanov/awesome-jev](https://github.com/cobanov/awesome-jev),
[yibie/awesome-jev](https://github.com/yibie/awesome-jev),
[jevbest.com](https://jevbest.com/),
[LangChain: building a harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev),
[lm-sys/RouteLLM](https://github.com/lm-sys/routellm),
[aurelio-labs/semantic-router](https://github.com/aurelio-labs/semantic-router),
[vllm-project/semantic-router](https://github.com/vllm-project/semantic-router). Later. The kit already routes with Jev, so these are for comparison.

AI operating systems: [ritishBhatoye/AgentOS](https://github.com/ritishBhatoye/AgentOS),
[fiatrete/OpenDAN-Personal-AI-OS](https://github.com/fiatrete/OpenDAN-Personal-AI-OS),
[MAL19INDUSTRIES/JARVIS-OS-V.2](https://github.com/MAL19INDUSTRIES/JARVIS-OS-V.2),
[khaled4123e/AIOS](https://github.com/khaled4123e/AIOS),
[agiresearch/AIOS](https://github.com/agiresearch/AIOS),
[agiresearch/Cerebrum](https://github.com/agiresearch/Cerebrum),
[agiresearch/AIOS-LSFS](https://github.com/agiresearch/AIOS-LSFS). Later. Read them for Chewbacca OS ideas, don't run them.

Single links he saved:
- [nicbarker/clay](https://github.com/nicbarker/clay) (2026-09-29): a C layout library. This is not Clay.com, so check it as a HUD layout engine.
- [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil) (2026-10-01)
- [Tobii Pro Spark eye tracker](https://www.tobii.com/products/eye-trackers/screen-based/tobii-pro-spark) (2026-10-01): gaze input for the HUD.
- [chroma-core/chroma](https://github.com/chroma-core/chroma) (2026-09-27)
- [slackcli.dev](https://slackcli.dev/), [orchid.ai](https://orchid.ai/), [github.com/Mail-0](https://github.com/Mail-0) (2026-10-08)
- [Charles Zheng's reels](https://www.instagram.com/charles.zhengg/reels/) (2026-10-08). He's the cstack author.
- Instagram posts he saved, not opened yet: [DaeeojNCCaX](https://www.instagram.com/reel/DaeeojNCCaX/), [DbJXJi6DD9X](https://www.instagram.com/reel/DbJXJi6DD9X/), [DdY8okcERHD](https://www.instagram.com/p/DdY8okcERHD/), [DdAw0iqhWm-](https://www.instagram.com/reel/DdAw0iqhWm-/)

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
