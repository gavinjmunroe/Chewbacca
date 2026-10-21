# amber-agent deploy guide

Single Railway service, multi-tenant. Tenants (who owns which Loop
sender) are stored in amber-id, not in Railway env vars, so onboarding
a new person = one amber-id upsert, no redeploy.

## Architecture

```
  +15550100003 (Sagar) ─┐
                        ├──►  Loop Message  ──►  amber-agent (Railway)  ──►  amber-id
  Caleb's number  ──────┘         webhook                │                     │
                                                         │                     ▼
                                                         └─ resolves tenant by sender_id
```

- **One deploy** serves every tenant. Each inbound webhook carries
  `sender` (Loop sender UUID) which the agent looks up in amber-id's
  `/tenants/resolve?sender_id=…` to get the right tenant's phone,
  display name, and permissions before routing through the AI pipeline.
- **Check-in scheduler** fans out per tenant. Every 60s it calls
  `listActiveTenants()` → amber-id's `/tenants/list?active=true` and
  runs each tenant's morning/evening/Sunday windows independently.
- **Sending out** uses `tenant.loopSenderId` (not the global env var)
  so replies originate from the right Loop number.

## Required env on Railway (amber-agent service)

```
# AI providers (fallback chain: Perplexity Agent → Perplexity Sonar → Anthropic → Ollama)
PERPLEXITY_API_KEY=...
ANTHROPIC_API_KEY=...        # fallback when Perplexity credits deplete
CLAUDE_MODEL=claude-haiku-4-5-20251001

# Loop Message
LOOP_API_KEY=...
LOOP_SECRET_KEY=...
LOOP_SENDER_ID=...           # Caleb's sender_id — used as the startup fallback
LOOP_SENDER_PHONE=...        # Caleb's sender phone — used as the startup fallback
CALEB_PHONE_NUMBER=...       # Caleb's personal phone (for failed-delivery alerts)

# amber-id (source of truth for tenants)
AMBER_ID_API_URL=https://amber-id.up.railway.app
AMBER_ID_API_KEY=...

# Privy (auth)
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...

# Webhook secret (Loop dashboard must send matching ?secret=...)
WEBHOOK_SECRET=...

# Optional: typing indicator duration (1–60 sec, default 10)
LOOP_TYPING_SECONDS=10
```

## Loop Message dashboard

Point **both** sender numbers at the same webhook URL:

```
https://<amber-agent>.up.railway.app/webhook?secret=<WEBHOOK_SECRET>
```

For each sender in the Loop dashboard, enable at minimum these events:

- `message_inbound`
- `message_reaction`
- `message_delivered`
- `message_failed`
- `inbound_call`
- `opt-in`

## Onboarding a tenant (Samber / anyone new)

amber-id holds the `(privyDid ↔ loopSenderId ↔ phoneNumber)` mapping.
There are two ways to register:

### Option A: register-tenant script

From anywhere with the amber-id credentials in env:

```bash
AMBER_ID_API_URL=https://amber-id.up.railway.app \
AMBER_ID_API_KEY=... \
node scripts/register-tenant.js \
  --samber \
  --privyDid did:privy:<SAGAR_PRIVY_ID>
```

The `--samber` preset fills in Sagar's name, phone (+15550100003), and
loopSenderId (`c351f20c-dec0-44b3-8127-55b662e237a6`). Equivalent
preset `--camber` exists for Caleb.

### Option B: curl

```bash
curl -X POST "$AMBER_ID_API_URL/tenants/upsert" \
  -H "x-api-key: $AMBER_ID_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "privyDid": "did:privy:<SAGAR_PRIVY_ID>",
    "displayName": "Sagar Tiwari",
    "phoneNumber": "+15550100003",
    "loopSenderId": "c351f20c-dec0-44b3-8127-55b662e237a6",
    "loopSenderPhone": "+15550100003",
    "active": true
  }'
```

Once the row exists, the agent picks Sagar up on the next inbound
webhook (tenant cache is 5 min; check-in scheduler refreshes every 2 min).

## Verification

1. **Health check:** `curl https://<amber-agent>.up.railway.app/health`
   should return `status: running` plus cache stats.
2. **Camber:** text Caleb's Loop number from any other iPhone — reply
   should come back within ~5s, typing indicator should appear
   immediately.
3. **Samber:** text +15550100003 from any other iPhone — reply should
   originate from Sagar's sender_id and use his displayName in the
   prompt ("Hi Sagar…"). If it replies as Caleb, his tenant row in
   amber-id isn't picking up — double-check `loopSenderId` on the
   upsert.
4. **Check-ins:** opt-in per tenant. By default no tenant receives
   scheduled morning / evening / Sunday prompts. To enable Caleb, either
   set `preferences.proactive.checkins=true` on his amber-id tenant or
   add his phone to `AMBER_CHECKIN_ALLOWLIST` on Railway and enable the
   scheduler globally via `AMBER_PROACTIVE_CHECKINS=1`. Sagar is
   deliberately off the allowlist until he asks for it back. When a
   tenant is enabled, the 07:00 PT tick logs `[checkin] Morning sent
from <Agent> to <Owner>`.

## Rollback

Railway auto-deploys from `main`. To roll back, revert the offending
commit and push — or redeploy a previous build from the Railway UI.
