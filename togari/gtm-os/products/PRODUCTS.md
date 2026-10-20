# Togari GTM — Products

Two GTM products shipping under `products/` in the togari-gtm monorepo. These are tools that directly serve BMA's go-to-market — recording, transcription, meeting intelligence, and content transformation.

> **Note:** iPad Virtual Display has been moved to its own repo: [amber-organization/amber-visionOS](https://github.com/amber-organization/amber-visionOS). It's a spatial computing product, not a GTM tool.

**Deadline: May 1, 2026** — both products shippable.

**Priority order:**
1. **New Loom** — Chrome extension, video output with BMA transform
2. **New Fireflies** — Chrome extension (reuse Loom patterns), meeting intelligence

---

## 1. New Loom (`products/new-loom/`)

**What:** Loom replacement that records video and transforms your raw audio into McKinsey-caliber dialogue using BMA training modules, then re-synthesizes with your cloned voice via ElevenLabs.

**Status:** Scaffolded — Chrome extension (Manifest V3), macOS app (ScreenCaptureKit + SwiftUI), Express backend (port 4200). BMA training modules built with vocabulary mappings, filler removal, hedge replacements, and framework injection.

### Decisions (locked in 2026-03-28)
- **Output format:** Video (ffmpeg mux new audio onto original video track)
- **Primary client:** Chrome extension first (macOS app later)
- **Voice cloning:** Deferred — v1 must work and be testable without voice clone (use stock ElevenLabs voice or skip synthesis for testing)
- **Storage:** BigQuery (consistent with rest of togari-gtm data lake)
- **Auth:** Single-user MVP, no multi-user auth for v1
- **Extension patterns:** Build reusable — New Fireflies will share Chrome extension architecture

**Architecture:**
- Chrome extension: Manifest V3 + MediaRecorder API, background service worker + content script
- Backend: Express/TypeScript, Zod schemas, BigQuery persistence
- Transform: GPT-4o LLM path with regex-based local fallback
- Voice: ElevenLabs synthesis (stock voice for v1, clone later)
- Video assembly: ffmpeg mux transformed audio onto original video

**Next milestones:**
- [ ] Chrome extension: MediaRecorder capture + upload to backend
- [ ] End-to-end recording → transcription → transform flow working (no synthesis)
- [ ] ffmpeg video assembly (new audio track onto original video)
- [ ] BigQuery persistence (replace in-memory store)
- [ ] ElevenLabs synthesis integration (stock voice, testable without clone)
- [ ] Sharing/link generation (Loom-style share links)
- [ ] Billing/monetization layer

---

## 2. New Fireflies (`products/new-fireflies/` — TO BE CREATED)

**What:** A Chrome extension that records meetings, transcribes, and produces deal-linked call logs with structured debriefs, buying committee mapping, and auto-generated next actions. Recordings stored in Google Drive. Outputs to a Fireflies-style dashboard and a Slack channel.

**Status:** Agent logic exists as `mof_fireflies_process` tool in the MOF agent layer. No standalone product scaffolding yet.

### Decisions (locked in 2026-03-28)
- **Form factor:** Chrome extension (reuse New Loom's extension architecture — same Manifest V3 + MediaRecorder patterns)
- **Recording storage:** Google Drive (not BigQuery blob storage)
- **Intelligence storage:** BigQuery (call logs, deal links, debriefs — consistent with togari-gtm data lake)
- **Scope:** BMA-only for v1 (hardcoded team members, pipelines). No multi-tenant.
- **Output channels:** (1) Fireflies-style web dashboard for browsing meetings + debriefs, (2) Slack channel for real-time call debrief posts
- **Owns the recording:** Yes — this is a Fireflies *replacement*, not a wrapper. Chrome extension captures meeting audio/video directly.

### Chrome Extension Reuse from New Loom
Both products share:
- Manifest V3 structure
- MediaRecorder API capture
- Background service worker + content script pattern
- Upload pipeline to Express backend
- Build these patterns as shared/reusable from the start

**Existing logic (from fireflies-agent.ts):**
- 6-step processing pipeline: Identify Account → Extract Deal Intelligence → Normalize Call-Log → Link to Deal → Generate Debrief → Next Action Recommendations
- Buying committee role extraction: champion, economic buyer, technical evaluator, blocker, influencer
- Objection capture with verbatim quotes
- Competitor detection, timeline/urgency signals, budget signal parsing
- Relationship temperature scoring (cold/warm/advocate)
- Deal linking via BigQuery (create or update)
- Next-action generation with owner assignment (Kevin/Mike/Maggie/Gwen) and Karthik/Gwen flags

**Next milestones:**
- [ ] Create `products/new-fireflies/` directory with CLAUDE.md
- [ ] Chrome extension: meeting recording (reuse Loom extension patterns)
- [ ] Google Drive upload integration (store raw recordings)
- [ ] Extract/refactor agent logic from `src/agents/middle-of-funnel/fireflies-agent.ts`
- [ ] Transcription pipeline (Whisper)
- [ ] Deal intelligence extraction (the 6-step pipeline)
- [ ] BigQuery persistence for call logs + debriefs
- [ ] Web dashboard (meeting list, debrief viewer, action item tracker)
- [ ] Slack channel integration (auto-post debriefs after meetings)
- [ ] Speaker diarization + auto-identification

---

## Cross-Product Notes

**Deadline:** May 1, 2026 — both products shippable.

**Shared infra:** Both products use BMA's BigQuery data lake (`togari_data_lake`) and can leverage the existing 58+ MCP tools in the togari-gtm server.

**Chrome extension reuse:** New Loom and New Fireflies share the same Chrome extension architecture (Manifest V3, MediaRecorder, background worker, content script, upload pipeline). Build these patterns reusable from the start in New Loom so New Fireflies can fork/extend.

**Build pattern:** Each product gets its own `products/<name>/` directory with a CLAUDE.md for independent Claude Code sessions, while sharing the monorepo's infra (pnpm, esbuild, TypeScript config).

**Sequencing plan (May 1 deadline):**
1. **Weeks 1-3 (Mar 30 – Apr 18):** New Loom Chrome extension — record, transcribe, transform, ffmpeg mux → working E2E
2. **Weeks 3-4 (Apr 14 – Apr 25):** New Fireflies Chrome extension — fork Loom patterns, Google Drive upload, intelligence extraction, Slack output
3. **Week 5 (Apr 25 – May 1):** Polish, dashboards, testing
