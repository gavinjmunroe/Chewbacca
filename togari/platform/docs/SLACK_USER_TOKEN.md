# Slack user token (xoxp-) setup

## The user token doesn't go through the OAuth callback

`/slack/oauth_callback` exists, but only for installing Togari into a
*client's* workspace so their reply cards land there
(docs/SLACK_EXTERNAL_WORKSPACE.md). It stores a bot token for that workspace
and never asks for user scopes.

The user token is for Togari's home workspace only, and Slack hands it over
finished in the dashboard. There is no code exchange to perform for it.

## Getting the token

1. Open the app at
   https://api.slack.com/apps → **Togari** → **OAuth & Permissions**.
2. Scroll to **Scopes** → **User Token Scopes** (this is a *separate*
   section from Bot Token Scopes — adding a scope to the bot side will not
   produce a user token).
3. Add only the scopes you actually need. Some common ones:
   - `search:read` — `search.messages`, which no bot token can call
   - `chat:write` — post as the installing human rather than as @Togari
   - `channels:history`, `groups:history` — read history as that person,
     including private channels they're in that the bot isn't
4. Scroll back to the top and click **Reinstall to Workspace**, then
   **Allow**. Reinstalling is required — scope changes do not apply to an
   already-issued token.
5. Copy the **User OAuth Token**. It starts with `xoxp-`. The **Bot User
   OAuth Token** above it starts with `xoxb-` and is the one already in
   `SLACK_BOT_TOKEN`; don't mix them up.

## Storing it

Railway → the `togari-bma-prod` service → **Variables**:

```
SLACK_USER_TOKEN=xoxp-...
```

Then redeploy. On boot the server calls `auth.test` with it and logs
`Slack user token active as <name>`, or warns if the token is bad.

Locally, put the same line in `.env` (already gitignored).

## Verifying

```bash
pnpm tsx scripts/verify-slack-user-token.ts
```

Prints the human the token acts as, the workspace, and the scopes Slack
actually granted — worth checking that last line, since a scope you added
but didn't reinstall for won't be there.

## Using it in code

```ts
import { getSlackUserClient, hasSlackUserToken } from "./transports/slack/user-client";

const res = await getSlackUserClient().search.messages({ query: "from:@sagar renewal" });
```

Use it **only** for calls a bot token genuinely can't make. The user token
carries that person's entire workspace access — every private channel and
DM they can see — so it has a far larger blast radius than the bot token,
and Slack attributes anything it writes to them personally. Default to
`SLACK_BOT_TOKEN` for everything else.

If the token is optional for your code path, gate on `hasSlackUserToken()`
rather than catching the throw.

## Rotating / revoking

The token dies if the installing user leaves the workspace or is
deactivated — worth knowing before wiring anything load-bearing to a
personal account. To rotate: reinstall the app, copy the new token, update
the Railway variable. To revoke: `auth.revoke`, or remove the app from the
workspace.
