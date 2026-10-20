# Togari in a client's own Slack workspace

Normally a client's reply cards post into a channel in **our** workspace
(Amber Intelligence), shared with the client over Slack Connect. That needs
no setup here. Use this procedure only when the cards must live in the
**client's** workspace instead, for example when their org won't let members
use another org's app buttons.

**Reply cards only.** Cards post there, and Send / Edit & Send / Draft work
there. Nothing else does: @Togari mentions, confirm cards, reminders and
proposal emails are ignored from any workspace but ours, so nobody there can
reach BMA's pipeline or calendar (`src/transports/slack/workspace-gate.ts`).
The install doesn't even ask for `app_mentions:read`.

## One-time setup (already done once per Slack app)

1. **Slack app → Manage Distribution:** activate public distribution. This
   doesn't list the app anywhere; it only lets other workspaces install it.
2. **Slack app → OAuth & Permissions → Redirect URLs:** add exactly
   `https://togari-bma-prod.up.railway.app/slack/oauth_callback`.
3. **Railway, `togari-bma-prod` → Variables:** set `SLACK_CLIENT_ID` and
   `SLACK_CLIENT_SECRET` from **Basic Information → App Credentials**, then
   redeploy. Without them the callback refuses every install.
4. **Your local `.env`:** set the same two values. The install-link script
   signs with the secret and Railway checks the signature.

`TENANT_SECRETS_MASTER_KEY` must already be set in Railway. The workspace's
bot token is stored encrypted under it, in `togari_core.tenant_secrets`.

## Installing for a client

1. Mint the link:

   ```bash
   npx tsx scripts/slack-install-link.ts --client=zeutara
   ```

   It's valid for 72 hours. Whoever holds it can install Togari into a
   workspace they admin, so send it to the person who will approve it, not to
   a channel.

2. An admin of the client's workspace opens it and clicks **Allow**. The page
   they land on shows the workspace ID (`T…`), and the Railway logs record it
   as `slack.oauth.installed`.

   **Don't use the shareable URL from Slack's Manage Distribution page.** It
   carries no signed state, so the callback refuses it and stores nothing.

3. In the client's workspace, in the channel where cards should land:
   `/invite @Togari`. Copy that channel's ID from the bottom of its About tab.

4. In `src/agents/replybot/client-config.ts`, on the client's entry:
   - `slackTeamId:` the `T…` from step 2
   - `slackChannelId:` (and any `channelOverrides`) the channel from step 3
   - `approvers:` if set, the user IDs **in their workspace**

   A test client that spreads this entry but posts somewhere else (for
   example `#test-channel`, which is in our workspace) must set
   `slackTeamId: undefined`, or it will post with the client's token into a
   channel that token can't see.

5. Deploy, send one test row whose prospect address you control, and check
   that the card appears, Edit opens, and Send goes through.

## When it breaks

If a card can't post in the client's workspace, the error is sent as an
urgent alert to `PERPLEXITY_ALERT_SLACK_CHANNEL` in our workspace. Without
that alert nobody at BMA would see the failure. Typical causes:

| Slack error | Meaning | Fix |
|---|---|---|
| `not_in_channel` | Bot isn't in the channel | `/invite @Togari` there |
| `channel_not_found` | Wrong channel ID, or it's in another workspace | Fix `slackChannelId` |
| `invalid_auth`, `token_revoked`, `account_inactive` | They removed the app | Reinstall (below) |
| `Togari isn't installed in Slack workspace T…` | No stored install for that `slackTeamId` | Check the ID, or install |

**Reinstalling:** mint a new link and repeat step 2. The new token replaces
the old one. Other replicas may keep using the old token for up to 10 minutes
(the cache in `installations.ts`), or until a redeploy.

**Uninstalling:** remove `slackTeamId` from the client entry so its cards go
back to our workspace, then have their admin remove the app. The stored token
stops working on its own; delete it with
`deleteTenantSecret('slack-team:T…', 'SLACK_BOT_INSTALLATION')` if you want it
gone.
