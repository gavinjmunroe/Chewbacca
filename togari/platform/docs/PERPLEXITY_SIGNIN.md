# Step 05 — signing Togari in to Perplexity, and keeping it signed in

One person clicks "allow" once **per Perplexity account**. After that Togari
renews that account's token on its own.

Accounts are per client, not one shared login: each client's drafting bills to
their own Perplexity account. Serif drafts on Serif's. A new client gets its own
by default and needs nothing configured — just its own sign-in click.

## What was built

| Piece | Where |
|---|---|
| Endpoints + the account setting (a) | `src/perplexity/config.ts` |
| Registration, PKCE, token calls (b–e) | `src/perplexity/oauth.ts` |
| The one token function + halt (f–g) | `src/perplexity/tokens.ts` |
| The one-time browser flow (c) | `scripts/perplexity-signin.ts` |

Every Perplexity call must go through **`getPerplexityAccessToken()`**. It
renews before expiry and throws when the login is broken; nothing else should
read the stored token directly.

## Setup, in order

**1. Create the encrypted secret store.** Tokens are written on every refresh,
so they need a writable store — the repo's `tenant_secrets` table
(AES-256-GCM, master key in env, plaintext never in BigQuery). Its dataset does
not exist yet:

```bash
bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < sql/migrations/0000_dataset.sql
bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < sql/migrations/0022_tenant_secrets.sql
```

**2. Set four variables in Railway:**

| Variable | Value |
|---|---|
| `TENANT_SECRETS_MASTER_KEY` | 64 hex chars (`openssl rand -hex 32`). Rotating it invalidates every stored secret. |
| `PERPLEXITY_ACCOUNT_<CLIENT>` | optional; only to point a client at a different account than their own (e.g. `PERPLEXITY_ACCOUNT_SERIF=bma` to run Serif on ours before step 14) |
| `TOGARI_PUBLIC_BASE_URL` | `https://togari-bma-prod.up.railway.app` |
| `PERPLEXITY_ALERT_SLACK_CHANNEL` | where the broken-login alert goes |

**3. Sign in, once per client, from your machine:**

```bash
npx tsx scripts/perplexity-signin.ts --client=serif
```

It opens your browser. **Sign in as the account that should be billed** — for
Serif, Serif's Perplexity account. The script catches the redirect, stores the
tokens encrypted, and prints the expiry.

### Why this is a local script and not a page on the server

Perplexity's authorize endpoint only accepts **loopback** redirect URIs:

| redirect_uri | authorize |
|---|---|
| `https://togari-bma-prod.up.railway.app/...` | 400 — "does not match allowed patterns" |
| `http://localhost:8765/callback` | accepted |
| `http://127.0.0.1:8765/callback` | accepted |

Registration accepts any URI, so this only surfaces at the authorize step. A
hosted callback cannot be made to work; the sign-in has to happen on loopback.

The tokens it writes go to the shared encrypted store, so the deployed server
reads and refreshes them normally afterwards. That means
**`TENANT_SECRETS_MASTER_KEY` must be identical on your machine and in
Railway**, or the server cannot decrypt what the script wrote. Refresh needs no
redirect URI, so renewal works server-side with no loopback involved.

If port 8765 is busy, set `PERPLEXITY_OAUTH_PORT`.

## Refresh tokens: what Perplexity actually does

Discovery advertises `refresh_token` in `grant_types_supported`, and
registration accepts `grant_types: ["authorization_code", "refresh_token"]`.
**A real exchange still came back without a refresh token**, and `offline_access`
is rejected outright at registration:

```
{"error":"invalid_client_metadata",
 "error_description":"Requested scopes are not valid: offline_access"}
```

So the server advertises renewal it does not appear to grant. Togari handles
both cases rather than betting on one:

- **With a refresh token** — renews on its own, as the plan describes.
- **Without one** — stores the access token and uses it until it expires, then
  alerts and halts with "re-run the sign-in". A token that works now is worth
  having; refusing to store it leaves the account signed out entirely.

Either way `getPerplexityAccessToken()` never loops on a renewal it cannot
perform, and never carries on quietly with a dead login.

**Measured, 2026-09-13:** the token response carries
`access_token, expires_in, scope, token_type` and nothing else, with
`expires_in: 2592000` — **30 days**, no refresh token.

That makes the constraint liveable. The login is good for a month, and renewing
it is one person running the sign-in script again. Togari alerts as it
approaches expiry rather than discovering it mid-run, so the work is a calendar
reminder, not an outage. Worth re-checking on the next sign-in in case
Perplexity starts issuing refresh tokens.

## How it keeps itself signed in

`getPerplexityAccessToken()` renews when **less than 20% of the token's
lifetime remains** — twelve minutes on a one-hour token — rather than waiting
for a call to fail. Verified live: registration returns `grant_types`
containing `refresh_token`, so renewal is available.

`resource=https://www.perplexity.ai/rest/computer/mcp` is sent on both the
authorize and token requests. It is required and appears in none of
Perplexity's documentation or its discovery output.

## When the login breaks

A failed renewal does three things: alerts Slack, sets a halt, and throws.
While halted, `getPerplexityAccessToken()` refuses immediately without
touching the network, so **no work goes to Perplexity**. Replies keep queueing
at `queued` and nothing is lost — that is the intended behaviour, not a
secondary failure.

Clearing the halt is either a redeploy or a successful sign-in (the callback
clears it). The halt is in-process, so a crash-looping instance would clear it
on each restart — the Slack alert, not the flag, is the thing a person acts on.

## The plan's two checks

Both are covered by `src/perplexity/__tests__/tokens.test.ts`:

1. **Expired token** → the next call renews and returns the new token.
2. **Corrupt refresh token** → one Slack alert, halted, and every later call
   refuses without a network call.

To run check 2 for real: edit the stored `PERPLEXITY_OAUTH_TOKENS` secret so
`refresh_token` is garbage, force a call, and watch for the alert. Recover by
running the sign-in script again.

## Adding another client

1. Register them in the replybot registry as usual (channel, voice, sender).
2. Run `npx tsx scripts/perplexity-signin.ts --client=<their id>` while logged
   into **their** Perplexity account.

That is the whole setup. The account defaults to the client id, so their tokens,
their halt state, and their spend are isolated from every other client with no
configuration. Set `perplexityAccount` in the registry only when the account
should be named something other than the client id, and
`PERPLEXITY_ACCOUNT_<CLIENT>` only to repoint a client temporarily.

**One client's broken login does not stop the others.** The halt is per account,
so if Serif's token expires, Serif's replies queue up and alert while everyone
else keeps drafting.
