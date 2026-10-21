# Quick-Call

`POST /api/v1/quick-call` is the public, Privy-gated twin of
`POST /admin/say-as-user`. It lets the caller send a message into the
Medha agent loop as if they had texted Medha themselves on iMessage —
without opening the Messages app. The reply comes back on iMessage; the
HTTP response is just an acknowledgement.

This is the backend the iOS Shortcut (Siri / Action Button / Back Tap /
Share Sheet) talks to.

## Contract

```
POST /api/v1/quick-call
Authorization: Bearer <privy jwt>
Content-Type: application/json

{ "text": "remind me about Shirley at 4pm" }
```

`text` is 1–2000 characters after trimming.

### Responses

| Status | Body                                        | Meaning                                                                                          |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 202    | `{ "ok": true, "message_id": "..." }`       | Accepted. The agent runs asynchronously; the reply arrives on iMessage.                          |
| 400    | `{ "error": "text_required" }`              | Missing, empty, or non-string `text`.                                                            |
| 400    | `{ "error": "text_too_long", "max": 2000 }` | `text` exceeded the cap after trimming.                                                          |
| 400    | `{ "error": "invalid_json" }`               | Body did not parse as JSON.                                                                      |
| 401    | `{ "error": "missing_privy_token" }`        | No Bearer header / `x-privy-token`.                                                              |
| 401    | `{ "error": "invalid_privy_token" }`        | Privy rejected the token (expired, wrong issuer, bad signature).                                 |
| 401    | `{ "error": "amber_id_rejected_token" }`    | Privy accepted the token here but medha-id rejected it (token-secret drift). Sign out + back in. |
| 424    | `{ "error": "caller_not_provisioned" }`     | The caller's tenant has no `phoneNumber` or `loopSenderId`. Finish onboarding.                   |
| 500    | `{ "error": "amber_id_url_unset" }`         | Server misconfigured: `AMBER_ID_API_URL` is not set.                                             |
| 502    | `{ "error": "amber_id_unreachable" }`       | medha-id is down or the network fetch threw.                                                     |
| 502    | `{ "error": "amber_id_error" }`             | medha-id returned a non-OK, non-401 status (5xx).                                                |

## How it works

1. Verify the Privy Bearer JWT.
2. `GET <AMBER_ID_API_URL>/v1/me` with the same `Authorization` header.
   medha-id reads the caller's Privy `customMetadata` and returns
   `{ phoneNumber, loopSenderId, ... }`.
3. Build a Loop-shaped envelope with the caller's own phone as `contact`
   and the caller's own Loop sender as `sender`. The source field is
   `"quick-call"` so downstream observability can tell these apart from
   real Loop inbound messages.
4. Hand off to `dispatchLoopEvent(envelope, ...)` — the same path Loop
   webhooks use. The HTTP handler returns 202 immediately; the agent
   loop runs in the background and replies on iMessage.

## Identity safety

The caller's identity is read from medha-id, not the request body. The
client cannot spoof `from`, `sender`, or `group_id`. The only field the
caller controls is `text`. This is the regression-prevention rule from
the original /admin/say-as-user design (decision 23): synthesized Loop
events must never let a caller's message be attributed to a different
tenant's identity.

## iOS Shortcut

Distributed separately. The Shortcut prompts for text via Siri / a share
sheet / the input field on long-press of the Action Button, then POSTs
here with the Privy JWT it gets from medha-frontend's
`/connect/quick-call` install page. Token refresh is the Shortcut's
problem; this endpoint accepts whatever fresh JWT it is given.

## Rate limits

Not enforced in v1. Target for v2: 6/min, 100/day per tenant. The
typical use is one or two calls per day per user; the burst protection
is mainly to keep a stuck Shortcut from looping forever.

## Curl example

```bash
curl -i -X POST \
  https://medha-platform-production.up.railway.app/api/v1/quick-call \
  -H "Authorization: Bearer $PRIVY_JWT" \
  -H "Content-Type: application/json" \
  -d '{"text":"set a reminder to call Shirley at 4pm"}'
```

Expected:

```
HTTP/1.1 202 Accepted
Content-Type: application/json

{"ok":true,"message_id":"quick-call-1748409601234-abc123"}
```

About 5–12 seconds later an iMessage from Medha arrives on the caller's
own phone.
