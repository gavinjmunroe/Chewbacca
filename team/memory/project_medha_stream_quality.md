---
name: project_medha_stream_quality
description: "medha-platform quick-call/stream SSE contract, persona guard chokepoint, and tool-retry/progress plumbing (Tab 14 work, shipped 2026-06-02)"
metadata:
  node_type: memory
  type: project
  originSessionId: a8f3bc03-211f-41de-8853-e09943cc73f6
---

Tab 14 of the Amber 200-item sprint shipped agent-quality work to medha-platform `main` (commit 033f12f, 2026-06-02). Key architecture now in place:

- **SSE frame contract** for `/api/v1/quick-call/stream` lives in `lib/stream-frames.js`: events are `progress` (`{phase,label}`), `token` (`{delta}`), `done` (`{answer}`), `complete`, and `error` (`{error,message,retryable}`). Error codes (empty_response, agent_failed, timeout, rate_limited, upstream_unavailable, identity_not_minted, entitlement_required) drive the iOS app's mint/upgrade/retry UI. `statusToStreamErrorCode` maps HTTP status to these.
- **Tool progress** (item 191): `lib/reply-capture.js` now carries an `onProgress` handler on the capture context; `emitProgress(phase,label)` reads the ALS store. The tool dispatcher calls it at the top of `dispatchToolCall`. This reaches the stream WITHOUT touching agent.js because the whole agent run is already wrapped in `runWithReplyCapture`. No-op for normal iMessage.
- **Persona guard** (item 194): `guardOutbound(text,{allowEmoji})` in `lib/voice-guard.js` = humanize (botty filler + em dash) + stripEmoji, applied at the SINGLE chokepoint `transport.sendMessage` so every rail (LLM, deterministic, captured stream) is clean. Idempotent. EMOJI_RE deliberately excludes the Mathematical Alphanumeric block (U+1D400-1D7FF) that renderForIMessage emits for bold/italic.
- **Settle budget** (item 192): `lib/stream-budget.js` `computeStreamBudget(text)` picks no-output settle + hard cap per turn class (heavy_tool 40s/60s, light_tool 22s/40s, conversation 12s/30s). Heavy floor preserves the proven-safe 40s/60s.
- **Read-only tool retry** (item 193): `lib/middleware/tool-retry.js` `withToolRetry`, wired INNERMOST in the dispatcher composition (audit→rateLimit→authBounce→retry→inner). Retries ONLY `RETRYABLE_READ_TOOLS` (calendar/email/drive reads) on transient throws/5xx; never writes. Returns structured `tool_unavailable` on exhaustion.
- The temporary `qc-debug` ring buffer + `/debug/qc-trace` route were removed (the in-app bug they diagnosed is fixed). Resolves the TODO in [[project_medha_inapp_auth]].

Deferred to follow-up PRs: 195 (Pinecone recall), 196 (group attribution dedup), 197 (proactive idempotency), 198 (split the ~1900-line lib/server.js), and full HTTP e2e of the stream route (needs handler dep-injection, pairs with 198).

medha-platform deploys via `git push origin main` → Railway auto-deploy (see [[feedback_railway_autodeploy]]); it is a backend, EAS/TestFlight is the amber-ios orchestrator's job, not this repo's.
