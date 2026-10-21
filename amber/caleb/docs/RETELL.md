# Retell — outbound voice-agent foundation

Status: **foundation only.** This PR introduces the adapter, config, and
test surface. It is **not** wired into Camber, Samber, the Claude tool
loop, the festival flow, the calendar runtime, or any scheduled job.
Wiring is intentionally a follow-up so the seam can be reviewed in
isolation.

The Retell adapter lives under `Newton/agent/lib/voice/retell/`. Import
through the barrel:

```js
import {
  isConfigured,
  describeConfig,
  createPhoneCall,
  createAgent,
  buildDynamicVariables,
  RETELL_KNOWN_VARIABLE_KEYS,
} from "./lib/voice/retell/index.js";
```

## How it's gated

The adapter is double-gated by design:

1. **Feature flag** — `AMBER_RETELL_ENABLED` must be truthy
   (`1` / `true` / `yes` / `on`). Default is **false**.
2. **API key** — `RETELL_API_KEY` must be a non-empty env var.

If either is missing, every call-creation path short-circuits to
`{ ok: false, reason }` *before* the SDK is even imported. There is no
"degrade by accident" branch — a missing key is treated the same as the
flag being off.

```js
if (!isConfigured()) {
  // voice unavailable — fall back to text
}
```

## Env vars

All on Railway, **not** in per-tenant secrets yet. Per-tenant migration
to amber-id's secret bag is the next PR.

| Variable                  | Required? | Purpose                                                                         |
| ------------------------- | --------- | ------------------------------------------------------------------------------- |
| `AMBER_RETELL_ENABLED`    | yes       | Master switch. Defaults to false even if `RETELL_API_KEY` is set.               |
| `RETELL_API_KEY`          | yes       | Server-side API key. Never read from a request, never logged.                   |
| `RETELL_AGENT_ID`         | optional  | Default agent override sent as `override_agent_id`. Caller may override.        |
| `RETELL_LLM_ID`           | optional  | Reserved for future direct-LLM attachment flows.                                |
| `RETELL_FROM_NUMBER`      | yes       | E.164 number Retell calls *from*. Caller may override per-call.                 |

Set them on the `amber-agent` Railway service. The repo name is
`amber-imessage`; the deployed service name is `amber-agent` and must
not be renamed — see `docs/ARCHITECTURE-NAMING.md`.

## Public surface

### `isConfigured(): boolean`

True iff the feature flag is on **and** the key is present. Treat false
as "voice unavailable", not as an error.

### `describeConfig(): object`

Log-safe descriptor — `keyLen: "len=N"`, `fromNumber: "…1234"`. The raw
key never appears. Suitable for `/health` and operator scripts.

### `createPhoneCall(opts)`

Places an outbound call. Always returns a result shape, never throws on
"expected" misconfiguration. Throws only on unexpected errors at the
SDK / runtime level (and even those are caught and surfaced as
`{ ok:false, reason:"api_error", detail }`).

```js
const res = await createPhoneCall({
  toNumber: "+14155550199",
  // either {tenant, contact, role, objective, safetyMode, calendarSummary, extra}
  // OR a pre-built flat string map.
  dynamicVariables: {
    tenant: { firstName: "Caleb", phoneNumber: "+14155550100", agentName: "camber" },
    contact: { firstName: "Mira" },
    role: "scheduler",
    objective: "confirm dinner 7pm",
    safetyMode: "safe",
  },
  metadata: { tenantDid: "did:privy:abc" },  // opaque, forwarded
  // fromNumber / agentId default to env, overridable per-call
});
// → { ok: true, callId, raw } | { ok: false, reason, detail? }
```

Known `reason` values:
- `feature_flag_off` — `AMBER_RETELL_ENABLED` is falsy
- `missing_api_key` — no `RETELL_API_KEY` in env
- `missing_to_number` / `missing_from_number` — caller validation
- `sdk_init_failed` — `import("retell-sdk")` or constructor failed
- `api_error` — Retell rejected the request

### `createAgent(spec)`

Admin-shaped action for bootstrapping an agent from a script. Honors
the same gates as `createPhoneCall`. Not exposed on the Claude tool
surface — provisioning belongs to operators, not the runtime agent.

### `buildDynamicVariables(input)`

Builds the flat string map Retell expects under
`retell_llm_dynamic_variables`. The allowlist is fixed
(`RETELL_KNOWN_VARIABLE_KEYS`):

- `agent_name` — `camber` / `samber` / `amber`
- `tenant_name` — first name of the tenant
- `tenant_phone_last4` — last 4 digits only, never the full number
- `contact_name`
- `role` — `concierge` / `scheduler` / `outreach` / …
- `objective` — one-line "why this call exists"
- `safety_mode` — `safe` / `alert` / `festival` (lets festival/SAFE
  guard downshift the agent before pickup)
- `calendar_summary` — short string the LLM can read out

Unknown keys are dropped. All values are coerced to strings. Nested
objects / arrays are refused.

## Secret handling

- `RETELL_API_KEY` is read **only** by `loadRetellSecret()` in
  `config.js` and passed directly into the SDK constructor.
- `redactApiKey(key)` returns `len=N`, never the value.
- `redactPhone(phone)` returns `…1234`, never the full number.
- All log lines route through the adapter's `logInfo` / `logWarn`, which
  serialize only the structured `summarizeCallAttempt()` fields. No
  raw payload, no transcript, no audio bytes.
- Defense-in-depth: if Retell ever surfaces the key in an SDK error
  message, the adapter scrubs it before returning the `detail` string.

The agent must never log raw secrets or PATs (CLAUDE.md / AGENTS.md
rule 5). The Retell tests explicitly assert this property.

## Smoke test (operator)

Once `AMBER_RETELL_ENABLED=true` is flipped on a Railway preview env
with a real key + sandbox `RETELL_FROM_NUMBER`:

1. `node -e "import('./Newton/agent/lib/voice/retell/index.js').then(m =>
   console.log(m.describeConfig()))"`
   Should print `enabled:true, hasKey:true, keyLen:'len=...'`.
2. Call a number you own:
   ```js
   await createPhoneCall({
     toNumber: "+1YOURNUMBER",
     dynamicVariables: { agent_name: "camber", role: "smoketest",
                         objective: "say 'hello, smoketest'" },
   });
   ```
3. Confirm Railway logs show only the structured `createPhoneCall.attempt`
   line with redacted phones — no raw `+1…` numbers, no key.
4. Flip `AMBER_RETELL_ENABLED=false` and rerun — the same call should
   return `{ ok:false, reason:"feature_flag_off" }` and the SDK must
   not be imported (no `retell-sdk` log noise).

## How this couples to Togari / Tiwari at scale

Today amber-agent is the conversational surface; Togari/Tiwari are the
heavy-lifting B2B primitives (search, stitch, schedule,
peoplerank). The Retell adapter is shaped to fit cleanly when those
worlds start placing voice calls on behalf of Amber:

- **Togari planning** decides *whether* a call is the right action
  (e.g. an opportunity is hot enough to talk live, or a scheduling
  thread has stalled).
- **Amber** owns the *voice* of the call — `agent_name`, `safety_mode`,
  `calendar_summary`. These come from amber-id and the calendar
  runtime, not from Togari.
- The adapter is the only thing in the repo that talks to Retell, so
  per-tenant API keys, rate limits, and Retell-side audit logs all
  live behind one seam. When per-tenant Retell keys move into
  amber-id's secret bag, `loadRetellSecret()` is the *only* function
  that changes.
- See `docs/AMBER-TOGARI-BOUNDARY.md` for the clean split — Togari
  must not reimplement this adapter, and Amber must not bake Togari
  business logic into dynamic variables.

## Out of scope for this PR

- Wiring into Camber / Samber tool surface
- Wiring into festival / SAFE / calendar runtime
- Per-tenant `RETELL_API_KEY` via `getSecret(tenant, …)` — env-only
  during foundation
- Inbound call webhook handlers
- Transcript ingest into Pinecone / context wikis
- Retell phone number provisioning
