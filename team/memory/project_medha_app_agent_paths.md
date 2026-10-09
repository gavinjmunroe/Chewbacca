---
name: project-medha-app-agent-paths
description: How the Medha iOS app reaches RAG vs the tool-using agent (calendar/email/drive) in medha-platform
metadata:
  node_type: memory
  type: project
  originSessionId: b25444b9-30b5-4d4b-b4fa-59280043b8d8
---

The Medha iOS app (amber-ios Personal tab) has TWO possible backends, and they are NOT the same:

- **`/api/ask/stream`** (what the app uses today) → medha-platform `tiwari-proxy.js` thin SSE proxy → medha-id `/ask/stream` = **RAG/PeopleRank only** (Perplexity Sonar over the user's Pinecone people vectors). **No calendar/email/drive tools.**
- **`/api/v1/quick-call`** (medha-platform `server.js` + `lib/quick-call.js`) → resolves caller's phone+loopSenderId via medha-id `/v1/me`, builds a Loop-shaped envelope, runs the SAME `dispatchLoopEvent` agent loop iMessage uses = **full tool agent (calendar/gmail/drive)**. Auth = Privy JWT (same token the app holds). BUT it is fire-and-forget: returns `202 {ok}` and the **reply comes back as an iMessage via Loop, not in the HTTP response**.

The tool agent lives in `Newton/agent/agent.js`; tools in `Newton/agent/lib/tools/` (gcal, gmail, drive). Tools fetch the user's Google OAuth token via `getSecret(tenant, ...)` from medha-id's secret bag; a missing token yields a "connect your Google account" link, not a hard error.

**To give the app in-app tool-Medha (decided 2026-06-02, Option B):** add a streaming twin of quick-call in medha-platform that runs `dispatchLoopEvent` with a CAPTURING transport (sendMessage writes to the SSE response instead of Loop), emitting frames the app parser expects (`token` delta + `done`). Then point the app's Medha mode at the new endpoint. Reuses the agent 100%; only changes where the reply goes. Related: [[project_medha_togari_split]], a private note.
