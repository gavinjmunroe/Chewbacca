---
name: togari-imessage is live and routing iMessage through togari-platform
description: First successful end-to-end iMessage round-trip for Togari happened 2026-05-12; service is on Railway, hits togari-platform /api/v1/message, Togari Loop org has its own API key and webhook URL
type: project
originSessionId: 791166fc-3862-4168-b279-3884bd900a2b
---

togari-imessage went from empty repo to live deploy with verified end-to-end round-trip on 2026-05-12 evening. Caleb's first real test text "Hello Togari" to +1 (626) 755-4085 came back with Togari's actual sales-ops voice.

## Wiring at first-light

- **Deployment**: Railway project `togari` (UUID aaab44db-c469-4f51-b6bd-027afa1abd08), service `togari-imessage`, environment `production`, hostname `togari-imessage-production.up.railway.app`
- **Phone**: +1 (626) 755-4085
- **Loop sender UUID**: c351f20c-dec0-44b3-8127-55b662e237a6
- **Loop org for Togari**: SEPARATE from Medha's Loop org. Each agent has its own Loop account; the `LOOP_API_KEY` values are different. Do not copy Medha's key onto Togari (we tried; outbound fails 401).
- **Loop webhook URL**: configured in Loop dashboard to point at `https://togari-imessage-production.up.railway.app/` (service root). togari-imessage accepts POST at `/`, `/webhook`, and `/loop/webhook` so any URL works.
- **togari-platform URL**: `https://togari-bma-prod.up.railway.app` (NOT Cloud Run, the README's Cloud Run claim is aspirational/stale). The Railway service is `togari-platform-48n`.
- **Shared auth to platform**: simple `X-Togari-Key` header. The shared secret `TOGARI_API_KEY` lives on both `togari-imessage` and `togari-platform-48n` in the same Railway project.

## The integration contract

togari-imessage is a THIN transport. The actual agent runs in togari-platform. iMessage hits togari-platform's existing universal NL endpoint:

```
POST {TOGARI_PLATFORM_URL}/api/v1/message
X-Togari-Key: <TOGARI_API_KEY>
Body: { message, user_id, context: { source: "imessage", phone, message_id, received_at } }
Response: { success: true, data: { type: "text", text: "<reply>", ... } }
```

Internally that endpoint calls `core/engine.processMessage()`, the SAME function the Slack transport invokes via `executeIntent`. So "texting Togari on iMessage" gets the same intent classifier, tools, and answers as "texting Togari in Slack".

## Loop webhook payload shape (reverse-engineered from medha-imessage)

```
payload.event           message_inbound | message_reaction | message_delivered | ...
payload.sender          OUR Loop sender UUID, must match LOOP_SENDER_ID
payload.from / .contact inbound caller's phone (E.164)
payload.text            message body
payload.speech.text     audio body (when message_type=audio)
payload.message_id      Loop's per-message ID
```

Only `message_inbound` runs the agent. All other events 200-ack and log.

## What's NOT yet wired (deferred polish)

- **LOOP_WEBHOOK_SECRET**: signature verification is skipped (matches medha's posture). When Loop's exact HMAC scheme is confirmed against real traffic, set the secret to lock it down.
- **LOOP_SECRET_KEY**: optional outbound `Loop-Secret-Key` header. Not set; medha doesn't set it either.
- **Sentry**: SENTRY_DSN unset. Errors only show in Railway logs.
- **Idempotency LRU**: Loop will retry on slow ACK. Currently we await the togari-platform call before responding, which can be 10s+, Loop may retry and double-call. Move platform call to background + immediate 200 ACK if duplicates surface.
- **Rich response types**: togari-platform can return proposals, Block Kit, images. iMessage currently flattens `.text` only.

**Why:** First-light deploy; defer hardening until real traffic patterns show what breaks.

**How to apply:** When adding features, remember the platform owns the agent. Adding tools or changing the agent's behavior belongs in togari-platform, not here. This repo only changes when transport details change (Loop API shape, webhook auth, new outbound channels).
