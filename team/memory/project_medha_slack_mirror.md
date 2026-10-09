---
name: project_medha_slack_mirror
description: Medha Slack channel mirror, live copyable web feed of
metadata:
  node_type: memory
  type: project
  originSessionId: f857eb5f-1e6d-4dab-97c3-c7fc5a95c68c
---

Slack channel mirror Caleb built 2026-06-05: a Next.js 14 app that mirrors the
`#medha-personal-updates` Slack channel (full history + threads + files) into a
polished dark web feed with collapsible threads, per-message/per-thread/copy-all
buttons, inline images, file download proxy, and 30s client polling for liveness.
Built to capture the use-case messages flowing through the channel.

- **Repo:** github.com/calebnewtonusc/medha-slack-mirror (private, personal account)
- **Live:** https://slack-mirror-production.up.railway.app
- **Railway:** service `slack-mirror` inside the **medha** project, Blue Modern
  Advisory workspace (NOT a standalone project, Caleb wanted it in the medha project).
- **Slack:** workspace = Amber (T087JNEUVHD); bot user `channel_export`
  (U0B8L5JT59U); channel id `C0B55ESJS1L`. Bot needs to be `/invite`d to a channel
  (token lacks `channels:join` scope). Scopes: channels/groups:history+read,
  users:read, files:read.
- **Env vars** (set on Railway service): `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`,
  `SLACK_CHANNEL_NAME`.
- **Deploy:** shipped via `railway up` (local upload), NOT GitHub-connected, to
  redeploy run `railway up -s slack-mirror` from the dir, or connect the repo in
  the Railway dashboard for git auto-deploy.
- **Liveness:** `/api/slack/messages` is force-dynamic (polled every 30s, always
  live). `vercel.json` hourly cron only fires on Vercel, irrelevant on Railway,
  and unnecessary because polling keeps the open page fresh.
- Filters out system noise (channel_join/rename/bot_add). Caleb (Caleb's USC email)
  can link/deploy in the BMA Railway workspace but NOT create new projects there
  (Unauthorized), add services to existing projects instead.

Relates to [[project_medha_togari_split]] and [[project_amber_vision]].
