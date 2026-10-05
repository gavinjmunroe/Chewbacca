# Engine candidates

Open source repos from the universe dump of 2026-10-03 that could put an app's
everyday task on the glass, after a second agent re-checked each claim against
the repo itself. Two can be an `engines.json` entry; the rest need a surface
written in code, because `bin/lib/surfaces/engine.py` only runs a detected
binary with fixed args or a plain GET to 127.0.0.1. The two spec entries sit in
`config/data/surfaces/engines.proposed.json`, outside the loader's path.

The order is by app time removed, using the 14-day foreground hours in
[OS-COVERAGE.md](OS-COVERAGE.md). Chrome sites have no per-site hours there,
only a rank inside Chrome's 15.8, so a Google site sits below Messages because
Messages has a measured number and the sites do not. Re-measure before
reordering.

## Ranked

**1. photon-hq/imessage-kit (surface idea).** Covers the gaps in Messages, 7.1
hours, the biggest native app after Chrome and VS Code. MIT. A TypeScript
library with typed `chat.db` reads (`getMessages`, `listChats` with
`unreadCount`), an osascript send path and a watcher for delivery. It has no
`bin` and no HTTP server, so it can't be a spec. Not installed, and
`STARRED-AUDIT.md` skipped it as too narrow. It removes only part of the 7.1
hours, because Messages is already partial on the glass: what it adds is the
three missing pieces in `config/data/surfaces/apps.json` (group replies, attachments,
starting a thread). Sends resolve when osascript exits, not on delivery, so the
existing read-back rule still applies. To bring it live: compare it against
the `mac messages` and `texts` paths first, then wrap it in a small Node
surface only for the gaps those two can't cover.

**2. googleworkspace/cli (engine).** Replaces Drive, Calendar and Gmail in
Chrome, ranks 3, 4 and 8 of the Chrome sites. Apache-2.0. A CLI,
`gws <service> <resource> <method> --params '<json>'`, that returns raw Google
API JSON, plus helpers like `gws calendar +agenda`. Not installed. The proposed
spec lists the ten most recently modified Drive files, rows at `files`, which
passes `check_spec` once the repo is registered. It overlaps `gogcli`, which is
installed and signed in, so its use is Drive first and a fallback if gog's
OAuth client breaks. Setup still needs a Cloud project, but `gws auth setup`
creates it through `gcloud`, which is installed, and Caleb approves OAuth once
in a browser. To bring it live: add `googleworkspace/cli` to
`config/data/oss-apps/apps.json` as Apache-2.0 and remixable, since engine.py refuses
it until then.

**3. fastrepl/anarlog (engine).** Replaces Granola, 0.8 hours. MIT for the
desktop app and CLI; only `enterprise/**` is commercial. The CLI's
`anarlog --json meetings list` reads the app's local SQLite with no login, and
`output.rs` pins the envelope to `{schema_version, command, data, pagination}`,
so rows sit at `data`. Not installed; Granola.app is. It fixes the Granola
blocker in `apps.json`, where Granola's cache is encrypted to Granola-signed
code, but only for meetings recorded in Anarlog, not the existing Granola
history. The spec's row keys `title` and `created_at` are guesses: only `id`
and `folder_path` are confirmed. To bring it live: `brew install --cask anarlog`,
install its CLI from Settings > Developers, and run one real
`anarlog --json meetings list` to confirm the binary path and row keys before
merging.

**4. korotovsky/slack-mcp-server (surface idea).** Replaces Slack, 0.7 hours.
MIT. A Go MCP server over stdio, SSE or HTTP with `conversations_unreads`,
`conversations_history`, `conversations_replies`, search and `channels_list`;
posting, reactions and mark-read are off unless an env var turns them on. Its
HTTP transport is JSON-RPC over POST, so a spec can't read it. Not installed.
The claude.ai Slack connector already covers history and search but has no
unread tool, so `conversations_unreads` is the real addition, and that is what
a needs-you surface wants. On an OAuth `xoxp` token, which is the one to use,
unreads fall back to one call per channel and mention filtering is
unavailable; the faster paths need browser session tokens nobody granted. To
bring it live: write a read-only MCP client surface on the `xoxp` path, and
leave posting off.

**5. open-pencil/open-pencil (surface idea).** Replaces Figma for local files.
Figma.app is under the 0.2-hour floor of the native list and figma.com is
tenth in Chrome, so the time it removes is small. MIT. The `openpencil` CLI
(npm `@open-pencil/cli`) reads `.fig` files offline with `tree`, `find`,
`info`, `query` and `lint`, all with `--json`, and there is an MCP server.
Every read needs a file path, which a fixed-args spec can only hard-code, so a
surface has to choose the file. It doesn't touch Figma cloud files, which the
Figma connector already reads and writes. It is in `config/data/oss-apps/apps.json`
as MIT and remixable, and already listed under Figma in `apps.json`. Not
installed. To bring it live: `npm install -g @open-pencil/cli`, then a surface
that runs `openpencil info --json` on the newest `.fig` in Downloads.

**6. onyx-dot-app/onyx (surface idea).** Replaces searching inside Slack,
Drive, Notion and Gmail, with no measured hours of its own. MIT outside the
`ee` directories, which are under the Onyx Enterprise License; `apps.json` has
it as not remixable until someone records the license in `curated.json`. It
runs as a multi-container Docker stack, and its CLI (`onyx-cli search` and
`ask`, both with `--json`) needs a query that changes each time plus a personal
access token. Not installed, and `STARRED-AUDIT.md` skipped it. To bring it
live: record its license in `config/data/oss-apps/curated.json`, and only then weigh a
Docker stack against the connectors already signed in.

**7. vercel/sdk (surface idea).** Replaces the Vercel dashboard in Chrome,
which isn't in the measured top ten. Apache-2.0. A TypeScript SDK with no CLI,
no localhost endpoint and no MCP server. Not installed, and not in
`apps.json`. The `vercel` CLI is already installed under the nvm prefix, and a
command read can reach any host, so a deploys panel built on that CLI is the
cheaper candidate. To bring it live: drop the SDK and try a fixed-args read on
the installed `vercel` CLI instead.

**8. toeverything/AFFiNE (surface idea).** Replaces Notion, which has no
measured hours. The client layer is MIT; `packages/backend` and
`packages/common/native` fall under the AFFiNE Enterprise Edition license.
It's an Electron app plus a self-hosted server; the `affine` binary in its tree
is a build runner, and its MCP server sits in the EE backend behind
per-workspace credentials. Not installed. Docs, Colanode and Beaver Notes in
`apps.json` are ahead of it. To bring it live: don't, until a Notion candidate
with a local read loses to it.

**9. Stirling-Tools/Stirling-PDF (surface idea).** Replaces Preview or Acrobat
for merge, split, OCR and redact, with no measured hours. Root license MIT, with
`app/proprietary`, `app/saas`, `engine/` and seven frontend folders carved out;
`apps.json` records it as remixable with a caveat. A REST server on `:8080`
whose only GETs are health and uptime; every PDF operation is a multipart
POST. Not installed. To bring it live: wait for a measured PDF task, then
write a surface that POSTs one file from Downloads.

**10. trycompai/crm (surface idea).** Replaces a hosted CRM tab, which isn't a
tracked app. MIT. NestJS with tRPC on `:3001`, a REST bridge under `/rest`,
Postgres in Docker, and a session cookie on every data route, which
`local_get` never sends. It also duplicates the `people` CLI. Not installed,
skipped in `STARRED-AUDIT.md`. To bring it live: only if a CRM shows up in the
measured hours.

**11. thesysdev/appless (surface idea).** Replaces no app; it's an Expo phone
app that asks a model for a screen per request and prefetches up to six likely
next screens per tap. MIT for the app code; the OUI-1 model's license was not
checked. Nothing in it is a data source, and its own README says actions are
simulated. Not installed. To bring it live: port the prefetch-next-tap pattern
into the generative surface code, not the app.

## Reference only

These are worth reading for a pattern, not installing.

- Carlton Aikins' macOS agent control plane (31Carlton7 on GitHub, entry R022
  in the 2026-10-03 dump): its Settings > Import reads agent transcripts, memory
  and skills with a strict scan-then-apply split. No license, so read it and
  ask before lifting code.
- `thesysdev/appless`: one component contract that generates the system
  prompt, a streaming renderer, and prefetch of the next screens.
- `NVIDIA-NeMo/Guardrails`: the prompt-injection rail, if the glass starts
  acting on other people's inbound text at volume.
- `symgraph/GhidrAssist`: precomputed summaries per level, then queries over
  SQLite FTS5 with no model call, if brain retrieval stalls.
- `serhii-londar/open-source-mac-os-apps`, Keyboard section: Karabiner-Elements
  and Input Source Pro show the Input Monitoring and Accessibility grant flow.
