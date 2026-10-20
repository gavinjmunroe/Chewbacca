# Internal Fireflies — Claude Code Instructions

## What This Is
A complete Fireflies.ai replacement. Records all meetings (Google Meet, Zoom, Teams), transcribes with Whisper, extracts summaries + action items, and feeds deal intelligence into the GTM OS pipeline. Everything stays internal — no third-party meeting bot service.

## Architecture
```
products/internal-fireflies/
  backend/src/
    server.ts              — Express API on port 4300
    store.ts               — In-memory meeting store (swap for Firestore in prod)
    analyzer.ts            — GPT-4o powered: summary, action items, deal intelligence
    calendar-watcher.ts    — Google Calendar poller, auto-schedules recordings
  shared/src/
    types.ts               — All TypeScript types + Zod schemas
  chrome-extension/        — (planned) Browser-based meeting capture
```

## API Endpoints
```
POST /api/meetings/upload       — Upload meeting audio (multipart/form-data)
POST /api/meetings/transcribe   — Transcribe with Whisper + timestamps
POST /api/meetings/analyze      — Summary + action items + optional deal intel
GET  /api/meetings              — List all meetings
GET  /api/meetings/:id          — Full meeting with all artifacts
GET  /api/meetings/:id/transcript
GET  /api/meetings/:id/summary
GET  /api/meetings/:id/action-items
POST /api/search                — Full-text search across all transcripts
DELETE /api/meetings/:id
```

## Running
```bash
OPENAI_API_KEY=sk-... npm run dev
# Optional: GOOGLE_CALENDAR_CREDENTIALS=... GOOGLE_CALENDAR_REFRESH_TOKEN=...
```

## Key Patterns
- Same store pattern as New Loom (in-memory, swap for Firestore in prod)
- Analyzer runs summary + action items in parallel
- Deal intelligence extraction is optional (pass dealIntelligence: true to /analyze)
- Calendar watcher is automatic if Google credentials are present
- Zod schemas for all API validation

## Roadmap
- [ ] Chrome extension for capturing Google Meet / Zoom audio from browser
- [ ] Speaker diarization (currently segments only, no speaker ID)
- [ ] Real-time transcription via WebSocket
- [ ] Slack notifications for meeting summaries
- [ ] Auto-link to GTM OS deals on analyze
- [ ] Firestore persistence
- [ ] Meeting bot (auto-join Google Meet via Puppeteer)

## Port: 4300
