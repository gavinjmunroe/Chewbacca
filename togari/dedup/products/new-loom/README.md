# New Loom

A Loom replacement that records video, transcribes audio, transforms it into McKinsey-caliber professional dialogue using BMA training modules, and synthesizes polished audio with ElevenLabs voice cloning.

## Architecture

```
new-loom/
  chrome-extension/    Chrome Extension (Manifest V3) — record from browser
  macos-app/           SwiftUI macOS app — record from desktop
  backend/             Express API server — transcribe, transform, synthesize
  shared/              Shared TypeScript types
```

## Quick Start

### Backend

```bash
# From monorepo root
cd packages/products/new-loom

# Install dependencies
pnpm install

# Set environment variables
export OPENAI_API_KEY="sk-..."        # Required for Whisper transcription + GPT transform
export ELEVENLABS_API_KEY="..."       # Required for voice synthesis

# Run development server
pnpm dev
# → http://localhost:4200
```

### Chrome Extension

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/products/new-loom/chrome-extension/`
5. Click the New Loom icon in your toolbar

**Note:** Generate proper PNG icons by opening `chrome-extension/icons/generate-icons.html` in a browser.

### macOS App

```bash
cd packages/products/new-loom/macos-app/NewLoom
swift build
swift run
# Or open in Xcode and build
```

Requires macOS 13+ for ScreenCaptureKit.

## Workflow

1. **Record** — Capture screen + camera + audio (Chrome extension or macOS app)
2. **Process** — Upload video, extract and transcribe audio via Whisper
3. **Transform** — Apply BMA training modules (MECE, Pyramid Principle, SCR, vocabulary upgrade, filler removal, hedge strengthening, action orientation)
4. **Generate** — Synthesize transformed script with ElevenLabs voice cloning
5. **Share** — Get shareable link, download video/audio/script

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/upload` | Upload recorded video (multipart) |
| POST | `/api/transcribe` | Transcribe audio via Whisper |
| POST | `/api/transform` | Transform transcript with BMA modules |
| POST | `/api/synthesize` | Generate audio via ElevenLabs |
| GET | `/api/recordings` | List all recordings |
| GET | `/api/recordings/:id` | Get recording with all artifacts |
| DELETE | `/api/recordings/:id` | Delete recording |
| GET | `/api/voices` | List ElevenLabs voices |
| GET | `/api/training-modules` | List BMA training module rules |

## BMA Training Modules

- **Professional Vocabulary** — 46 casual → professional word mappings
- **Filler Removal** — 31 filler words/phrases automatically stripped
- **Hedge Strengthening** — 17 weak hedge → confident assertion mappings
- **MECE Framework** — Mutually Exclusive, Collectively Exhaustive structuring
- **Pyramid Principle** — Lead with the answer, then supporting arguments
- **SCR Structure** — Situation → Complication → Resolution
- **Action Orientation** — Passive → active voice, add quantification

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for Whisper + GPT-4o |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key for voice synthesis |
| `PORT` | No | Server port (default: 4200) |
| `UPLOAD_DIR` | No | Video upload directory |
| `AUDIO_OUTPUT_DIR` | No | Synthesized audio output directory |
