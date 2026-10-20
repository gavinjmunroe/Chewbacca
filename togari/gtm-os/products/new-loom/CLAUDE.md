# New Loom — Claude Code Instructions

## What This Is
A Loom replacement: record video, transcribe, transform to McKinsey-caliber dialogue via BMA training modules, synthesize with ElevenLabs voice cloning. Three clients (Chrome extension, macOS app) talk to one Express backend.

## Project Structure
```
packages/products/new-loom/
  backend/src/
    server.ts              — Express API (upload, transcribe, transform, synthesize)
    bma-training-modules.ts — All McKinsey transform logic (vocabulary, fillers, hedges, frameworks)
    elevenlabs.ts          — ElevenLabs voice synthesis client
    store.ts               — In-memory recording store (swap for Firestore in prod)
  chrome-extension/
    manifest.json          — Manifest V3
    popup.html/js          — Step-by-step UI
    background.js          — Recording state + API calls
    content.js             — MediaRecorder capture on page
    content-styles.css     — Recording overlay styles
    styles.css             — Popup styles
  macos-app/NewLoom/NewLoom/
    NewLoomApp.swift       — App entry
    Models/AppState.swift  — All state + API calls
    Views/                 — SwiftUI views per workflow step
    Services/ScreenRecorder.swift — ScreenCaptureKit recording
  shared/src/
    types.ts               — All TypeScript types + Zod schemas
```

## Running
```bash
# Backend
OPENAI_API_KEY=sk-... ELEVENLABS_API_KEY=... pnpm dev

# Chrome Extension: load unpacked from chrome-extension/ in chrome://extensions

# macOS: cd macos-app/NewLoom && swift build && swift run
```

## Key Patterns
- Zod schemas for all API validation (shared/src/types.ts)
- BMA training modules are self-contained in bma-training-modules.ts
- Transform has LLM path (GPT-4o) with local fallback (regex-based)
- In-memory store — replace with Firestore for production
- Chrome extension uses background service worker + content script pattern
- macOS uses ScreenCaptureKit (requires macOS 13+)

## When Modifying
- Add new vocabulary mappings in `VOCABULARY_MAPPINGS` array
- Add new filler words in `FILLER_WORDS` array
- Add new hedge replacements in `HEDGE_REPLACEMENTS` array
- New API endpoints go in server.ts, types in shared/src/types.ts
- Keep the transform prompt in `buildTransformPrompt()` — it feeds all rules to the LLM

## API runs on port 4200 by default
