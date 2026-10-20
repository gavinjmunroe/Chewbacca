# Togari Slack Commands

The Togari Slack bot turns BMA's existing Slack workspace into the front door for the dedupe + unification platform. No new app to install for end users: they type a slash command, get a one-time link, and they're in.

---

## Commands

### `/togari connect`

Mints a single-use magic link to the Togari dashboard and DMs it to the requester. The link expires in 10 minutes and binds the upcoming Auth0 login to the Slack identity, so the dashboard can associate your platforms (Apple Contacts, LinkedIn, etc.) and API keys with your account.

- **Who:** any workspace member
- **Where:** any channel or DM (response is ephemeral, only you see it)
- **Response:** confirmation that a DM was sent; the actual link lands in your Slackbot DM
- **Fallback:** if the bot can't DM you (e.g. DMs disabled), the link is returned ephemerally in the channel

### `/togari status`

Returns a deep-link to the dashboard's connection page where you can see which platforms are wired up for your account. (Inline status will come once the WS-1/WS-6 owner-id tooling lands; for now we point at the source of truth.)

- **Who:** any workspace member, must have run `/togari connect` first
- **Response:** ephemeral message with a dashboard URL

### `/togari revoke-key`

Returns a deep-link to the dashboard's API keys page where you can revoke or rotate `tgi_live_` keys.

- **Who:** any workspace member, must have run `/togari connect` first
- **Response:** ephemeral message with a dashboard URL

### `/togari help`

Shows the command list. Same response is sent when the command is invoked with no arguments or an unknown subcommand.

---

## Security model

- Every request to `POST /slack/commands` is verified against `SLACK_SIGNING_SECRET` using HMAC-SHA256, matching the pattern already in `src/agents/slack-sync/index.ts`. Requests older than 5 minutes are rejected (replay protection).
- The raw request body is captured pre-parse via the `verify` option on `express.urlencoded`, so the HMAC base string is reconstructed verbatim. Slack signs the raw form-encoded payload, not the parsed object.
- Magic-link tokens are 256 bits of randomness, single-use, and held in an in-memory store with a 10-minute TTL. A 5-minute sweeper deletes expired entries. Consumed entries are removed immediately.
- `POST /api/v1/magic-link/issue` is gated behind a shared secret (`MAGIC_LINK_INTERNAL_SECRET`) so the public internet cannot mint links. The Slack handler calls `issueMagicLink()` in-process and never hits the HTTP surface itself.
- Token storage is in-memory today. When Togari moves to multi-instance, swap the `linkStore` Map for Firestore; interface stays the same.

---

## Slack app configuration

When configuring the Togari Slack app in api.slack.com, point each slash command at the same endpoint:

| Command   | Request URL                                   |
| --------- | --------------------------------------------- |
| `/togari` | `https://togari.bluemodern.ai/slack/commands` |

Required OAuth scopes for the bot user:

- `commands`, receive slash command payloads
- `chat:write`, post messages
- `im:write`, open DM channels with users

Required env vars on the server:

- `SLACK_SIGNING_SECRET`, from "Basic Information" → "App Credentials"
- `SLACK_BOT_TOKEN`, from "OAuth & Permissions" → "Bot User OAuth Token" (starts with `xoxb-`)
- `MAGIC_LINK_INTERNAL_SECRET`, any 32+ char random string; gates the public mint endpoint
- `PUBLIC_URL`, base URL where the dashboard is reachable (e.g. `https://togari.bluemodern.ai`)

---

## Future commands (not yet implemented)

- `/togari match <name or email>`, quick lookup from inside Slack without opening Clay
- `/togari deals`, recent deals attributed to the requester
- `/togari realness <linkedin url>`, run the realness classifier ad-hoc

These wait on WS-1 (matcher) and WS-4 (realness) shipping their public-callable handlers; the Slack surface is straightforward once those land.

---

All glory to God! ✝️❤️
