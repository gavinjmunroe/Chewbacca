# USER_ACTIONS.md: Implementation Checklist for Tizzy Team

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Audience:** Development team, product managers, operations leads
**Status:** Phase 0 Pre-Launch Planning

---

## Overview

This document outlines all actionable tasks the team must complete to launch Tizzy MVP (v1.0). It is organized by functional domain with clear ownership, dependencies, and deadlines.

**Critical Path:** Backend API + Hardware Firmware + Mobile App + Legal/Compliance → Beta Launch (Month 6)

---

## 1. Backend API Setup (Weeks 1-6)

### 1.1 Development Environment

**Status:** ⬜ Not Started
**Owner:** Backend Lead
**Deadline:** Week 1

- [ ] **Set up infrastructure repository**
  - Create separate GitHub repo for backend (e.g., `tizzy-backend`)
  - Git structure: `/src`, `/tests`, `/deployment`, `/docs`
  - CI/CD pipeline with GitHub Actions

- [ ] **Choose cloud provider**
  - [ ] AWS (ECS/Fargate, RDS, S3, Lambda, KMS) – **Recommended** (familiar, cost calculator built)
  - [ ] Google Cloud Platform (Cloud Run, Cloud SQL, GCS, Secret Manager)
  - [ ] Set up cross-region strategy (US-East primary, US-West failover)
  - [ ] Create separate AWS accounts: dev, staging, production

- [ ] **Initialize infrastructure-as-code**
  - [ ] Use Terraform or CloudFormation
  - [ ] Store sensitive config in AWS Secrets Manager (never hardcode)
  - [ ] Document all infrastructure decisions in `/deployment/INFRASTRUCTURE.md`

- [ ] **Set up local development**
  - [ ] Docker for local Postgres, Redis, S3 (using LocalStack)
  - [ ] `.env.example` file (no secrets) in repo root
  - [ ] Development README with: `docker compose up`, environment variables, database seed script

---

### 1.2 Database Schema

**Status:** ⬜ Not Started
**Owner:** Backend Lead + Database Admin
**Deadline:** Week 2

- [ ] **Design PostgreSQL schema**
  - [ ] Users table (id, email, created_at, deleted_at, consent_version)
  - [ ] Devices table (device_id, user_id, paired_at, firmware_version, last_sync)
  - [ ] Sessions table (session_id, user_id, start_time, end_time, duration_seconds, metadata)
  - [ ] Features table (feature_id, session_id, turn_index, timestamp, acoustic_features_json, speaker_label)
  - [ ] HapticEvents table (event_id, session_id, timestamp, pattern_name, user_rating)
  - [ ] CoachingSummaries table (summary_id, session_id, insights_json, micro_goal, confidence_score)
  - [ ] UserMarkers table (marker_id, session_id, timestamp, marker_type, user_context)
  - [ ] TherapistAccess table (access_id, user_id, therapist_id, consent_date, expiry_date, audit_log)
  - [ ] AuditLogs table (log_id, user_id, action, resource, timestamp, ip_address, status) – **immutable**

- [ ] **Set up TimescaleDB for time-series**
  - [ ] Configure continuous aggregation for daily/weekly trends
  - [ ] Retention policy: raw features 90 days → monthly summaries 3 years
  - [ ] Query examples for trends dashboard

- [ ] **Implement encryption at rest**
  - [ ] AWS KMS encryption for sensitive columns (audio metadata, user markers)
  - [ ] SQLCipher for local development database
  - [ ] Document key rotation policy

- [ ] **Create migration infrastructure**
  - [ ] Use Flyway or Alembic for schema versioning
  - [ ] Every schema change = new numbered migration file
  - [ ] Test migrations: `migrate up`, `migrate down`, `migrate up` (idempotency)
  - [ ] Backward compatibility checks (can old API clients work with new schema?)

- [ ] **Build test database fixtures**
  - [ ] Seed script with 100 test users, 500 test sessions
  - [ ] Includes edge cases: users with therapists, users with audio retention enabled, deleted users
  - [ ] Re-runnable without duplication

---

### 1.3 API Framework & Authentication

**Status:** ⬜ Not Started
**Owner:** Backend Lead
**Deadline:** Week 2-3

- [ ] **Initialize API server**
  - [ ] Node.js + Express.js **OR** Python + FastAPI (team preference?)
  - [ ] TypeScript for Node.js (strict mode)
  - [ ] Project structure: `/routes`, `/controllers`, `/services`, `/middleware`, `/models`

- [ ] **Implement authentication**
  - [ ] OAuth 2.0 with Auth0 (handles MFA, user management, compliance)
  - [ ] **OR** Firebase Authentication (simpler, less flexible)
  - [ ] JWT token strategy: 1-hour access token + 7-day refresh token
  - [ ] Refresh token rotation (issue new refresh on use)
  - [ ] Middleware: verify JWT, extract user context, attach to request

- [ ] **Set up API Gateway**
  - [ ] AWS API Gateway (if AWS) with authorization, throttling
  - [ ] Rate limiting: 100 req/min per user, 1000 req/min per IP
  - [ ] HTTPS only, TLS 1.3 minimum
  - [ ] Certificate pinning for mobile clients (prevent MITM)
  - [ ] CORS policy: only allow mobile app domains

- [ ] **Build request/response validation**
  - [ ] JSON Schema validation middleware
  - [ ] Custom validators for: device IDs, session timestamps, feature arrays
  - [ ] Error responses: clear messages, no stack traces in production
  - [ ] Input sanitization: prevent SQL injection, XSS

---

### 1.4 Core API Endpoints

**Status:** ⬜ Not Started
**Owner:** Backend Team
**Deadline:** Week 3-5

#### 1.4.1 User Management

- [ ] **POST /v1/auth/register**
  - Input: email, consent_version, age_confirmation
  - Output: user_id, jwt_token, refresh_token
  - Validation: email format, age >= 13 (COPPA)
  - Log: user registration in audit log

- [ ] **POST /v1/auth/login**
  - Input: email, password (OAuth or SSO)
  - Output: jwt_token, refresh_token
  - Rate limit: 5 attempts per IP per 15 min

- [ ] **POST /v1/auth/refresh**
  - Input: refresh_token
  - Output: new access_token, new refresh_token
  - Log: token refresh in security log

- [ ] **GET /v1/users/me**
  - Returns: user profile, device pairings, consent status, preferences
  - Requires: valid JWT token

- [ ] **POST /v1/users/me/delete**
  - Soft-delete user and all data
  - Trigger async deletion: remove from cache, anonymize in audit logs
  - Return: confirmation code + 30-day grace period

#### 1.4.2 Device Management

- [ ] **POST /v1/devices/pair**
  - Input: device_id, user_confirmation_code (from hardware)
  - Output: device_secret (for future pairing)
  - Lock: one device per user, one user per device

- [ ] **GET /v1/devices/:device_id/status**
  - Returns: battery_level, firmware_version, last_sync, storage_used
  - Requires: device_secret or user JWT

- [ ] **POST /v1/devices/:device_id/update-firmware**
  - Input: firmware_version
  - Returns: download URL (S3 presigned), checksum, size_bytes
  - Rate limit: 1 per device per day (prevent spam)

- [ ] **POST /v1/devices/:device_id/mute**
  - Input: mute_duration_seconds (0 = until unmute, max 3600)
  - Effect: device firmware receives mute command via BLE
  - Log: mute event with timestamp, duration, reason (optional)

#### 1.4.3 Session & Feature Ingestion

- [ ] **POST /v1/sessions/sync**
  - Input: { session_metadata, feature_objects[], haptic_events[], user_markers[] }
  - Process: validate schema, write to TimescaleDB, enqueue for async analysis
  - Output: { session_id, analysis_status: "queued" }
  - Return immediately (within 100ms)
  - Log: session ingestion (count, size, anomalies)

- [ ] **GET /v1/sessions**
  - Query params: limit=50, offset=0, date_from, date_to
  - Returns: list of sessions with metadata, summary stats
  - Row-level security: user can only see own sessions

- [ ] **GET /v1/sessions/:session_id**
  - Returns: full session details including features, haptic events, coaching summary
  - Check: user authorization, consent for audio access

- [ ] **POST /v1/sessions/:session_id/mark**
  - Input: timestamp, marker_type (confusing, awkward, successful), context (optional)
  - Effect: store in UserMarkers table
  - Log: user feedback for model improvement

#### 1.4.4 Coaching & Insights

- [ ] **GET /v1/sessions/:session_id/coaching**
  - Returns: { insights_text, micro_goal, what_went_well, to_improve, confidence_score, detected_moments[] }
  - Wait if not yet generated: return 202 Accepted with retry-after header
  - Cache result: same coaching summary for 24 hours

- [ ] **POST /v1/sessions/:session_id/coaching/feedback**
  - Input: helpful (true/false), feedback_text (optional)
  - Effect: store for model training feedback
  - Log: feedback for coaching model improvement

- [ ] **GET /v1/dashboard/trends**
  - Query params: start_date, end_date, metrics=["reciprocity", "pacing", "repair_rate"]
  - Returns: time-series data for each metric
  - Group: by day or week (smart grouping)
  - Compare: to user's 30-day baseline

#### 1.4.5 Privacy & Consent

- [ ] **GET /v1/privacy/consent-status**
  - Returns: { audio_retention_enabled, therapist_access[], data_sharing[], consent_version }

- [ ] **POST /v1/privacy/set-audio-retention**
  - Input: enabled (true/false)
  - Effect: update user settings, trigger device sync via BLE
  - Log: privacy setting change in audit log

- [ ] **POST /v1/privacy/therapist-access**
  - Input: therapist_email, access_duration_days (default 180)
  - Validation: therapist must exist in system + confirm via email
  - Effect: create TherapistAccess record with expiration
  - Output: share link (one-time use by therapist to accept)
  - Log: access grant in audit log

- [ ] **GET /v1/privacy/audit-log**
  - Returns: list of all data access events (who, what, when, IP)
  - Pagination: last 100 events
  - Filterable by: date, access_type, user

- [ ] **POST /v1/privacy/delete-all-data**
  - Input: confirmation_code (2FA)
  - Effect: mark all user data for deletion (async process)
  - Return: deletion_ticket_id for status tracking
  - Timeline: complete within 30 days

#### 1.4.6 Therapist Portal API (Separate)

- [ ] **POST /v1/therapist/login**
  - Input: email, password
  - Validation: therapist role in system
  - Output: therapist_jwt_token

- [ ] **GET /v1/therapist/clients**
  - Returns: list of clients (user has granted therapist access)
  - Pagination, filtering by: goal, progress status, last active

- [ ] **GET /v1/therapist/clients/:client_id/progress**
  - Returns: 7-day summary { total_sessions, hours, skill_scores, trend_direction, notable_patterns }
  - Check: valid access grant + not expired

- [ ] **POST /v1/therapist/clients/:client_id/goals**
  - Input: goal_text, priority (1-5), deadline (optional)
  - Effect: create Goal record, link to user's coaching engine
  - Notify: user of new therapist goal (push notification)
  - Log: therapist action in audit log

- [ ] **POST /v1/therapist/clients/:client_id/notes**
  - Input: note_text (encrypted)
  - Effect: store in encrypted database field
  - Return: note_id, timestamp
  - Log: note creation in audit log

---

### 1.5 External Service Integrations

**Status:** ⬜ Not Started
**Owner:** Backend Lead + Integrations Engineer
**Deadline:** Week 5-6

#### 1.5.1 Modulate ELM Integration

- [ ] **Evaluate Modulate API**
  - [ ] Request API access from Modulate sales
  - [ ] Review documentation: input specs (audio features, embeddings), output (intent, tone, emotion)
  - [ ] Understand pricing model: $/API call, volume discounts, SLA
  - [ ] Negotiate contract: data privacy (no training on Tizzy data), exclusivity

- [ ] **Design Modulate service**
  - [ ] Service class: `ModulateAnalysisService`
  - [ ] Input: feature vectors, acoustic embeddings from session
  - [ ] Output: intent labels, emotion labels, confidence scores
  - [ ] Error handling: what if Modulate API fails?
  - [ ] Caching: cache results by feature hash (avoid duplicate API calls)
  - [ ] Rate limiting: respect Modulate's rate limits (queue excess requests)

- [ ] **Implement feature extraction pipeline**
  - [ ] Extract acoustic features from raw features table
  - [ ] Feature set: pitch (mean, variance, range), speech rate, intensity, jitter, shimmer, HNR
  - [ ] Standardize to Modulate input format (may require conversion)
  - [ ] Store Modulate output in separate table for audit trail

- [ ] **Build cost monitoring**
  - [ ] Log every Modulate API call with timestamp, cost
  - [ ] Daily/weekly cost report
  - [ ] Alert if cost exceeds budget (e.g., $500/month)

#### 1.5.2 Transcription Service (Optional V1)

- [ ] **Evaluate transcription options**
  - [ ] OpenAI Whisper: self-hosted (privacy), cost, accuracy
  - [ ] Deepgram API: managed, lower latency, no local control
  - [ ] Google Cloud Speech-to-Text: integrated, expensive
  - [ ] Decision: recommend Whisper self-hosted (privacy-first) or Deepgram (fast iteration)

- [ ] **Design transcription service**
  - [ ] Service class: `TranscriptionService`
  - [ ] Trigger: only if user explicitly enables audio retention + transcript
  - [ ] Input: audio clips from session (max 30 seconds per clip)
  - [ ] Output: transcript text + timestamps + confidence scores
  - [ ] Async processing: queue transcription jobs, webhook callback when complete
  - [ ] Error handling: retry on failure, cap retries at 3

- [ ] **Implement optional workflow**
  - [ ] Default: transcription disabled
  - [ ] User opt-in: explicit consent screen + privacy explanation
  - [ ] Transient storage: delete transcripts after 7 days (only coaching insights retained)
  - [ ] Log: transcription requests in audit log

#### 1.5.3 LLM Integration for Coaching Insights

- [ ] **Evaluate LLM providers**
  - [ ] OpenAI GPT-4 Turbo: best quality, higher cost (~$0.03/insight)
  - [ ] Anthropic Claude 3.5 Sonnet: strong reasoning, better privacy posture
  - [ ] AWS Bedrock: managed, multi-model, easier compliance
  - [ ] Decision: recommend Claude 3.5 Sonnet (alignment with values)

- [ ] **Design LLM service**
  - [ ] Service class: `CoachingInsightService`
  - [ ] Input: structured JSON { session_metrics, detected_moments, user_goals, baseline_comparison }
  - [ ] Prompt template: anti-ableist framing, focus on clarity/understanding, no masking pressure
  - [ ] Output: 3-part insight { what_went_well, to_improve, micro_goal }
  - [ ] Cost tracking: log every API call (cost, latency, tokens)

- [ ] **Build LLM prompt engineering**
  - [ ] Base prompt: defines Tizzy's coaching philosophy
  - [ ] Personalization: adapt tone based on user profile (age, communication style)
  - [ ] A/B testing framework: ability to test different prompts with user cohorts
  - [ ] Example prompts: `/deployment/llm-prompts/base-coaching.txt`
  - [ ] Testing: QA 50+ coaching outputs manually before production

- [ ] **Implement caching & cost optimization**
  - [ ] Cache identical coaching inputs (unlikely, but possible)
  - [ ] Batch insights generation (if latency allows)
  - [ ] Cost alert: if LLM spend exceeds 30% of session features cost, optimize prompts

---

### 1.6 Monitoring & Operations

**Status:** ⬜ Not Started
**Owner:** DevOps / Backend Lead
**Deadline:** Week 5-6

- [ ] **Set up logging**
  - [ ] Centralized logging: AWS CloudWatch or ELK (Elasticsearch, Logstash, Kibana)
  - [ ] Log all API requests: method, path, status, latency, user_id (anonymized hash)
  - [ ] Log external API calls: Modulate, LLM, transcription (cost, latency, success/failure)
  - [ ] Structured logging (JSON): timestamp, service, level, message, context
  - [ ] Log retention: 30 days for debug logs, 1 year for security logs

- [ ] **Set up metrics & monitoring**
  - [ ] Prometheus + Grafana for metrics
  - [ ] Key metrics: API request rate, error rate, latency (p50, p95, p99)
  - [ ] Database metrics: connection pool, query latency, replication lag
  - [ ] External service metrics: Modulate API success rate, LLM latency, cost per session
  - [ ] Create dashboard for on-call engineer

- [ ] **Set up alerting**
  - [ ] Alert channels: Slack (team), PagerDuty (on-call)
  - [ ] Critical alerts: API error rate > 1%, database replication lag > 5s, external API down
  - [ ] Warning alerts: API latency p95 > 1s, database connections > 80% pool
  - [ ] Budget alerts: cloud spend exceeds 110% of monthly forecast

- [ ] **Build deployment pipeline**
  - [ ] GitHub Actions: run tests on every commit, deploy on merge to main
  - [ ] Environments: dev (auto-deploy), staging (manual approval), production (manual approval + rollback plan)
  - [ ] Health check: POST /health endpoint returns { status: "ok", timestamp, version }
  - [ ] Gradual rollout: canary deployment (1% traffic) → 10% → 100% (detect issues early)

- [ ] **Document runbooks**
  - [ ] What to do if API is down: incident response steps
  - [ ] What to do if database is slow: query optimization, scaling steps
  - [ ] What to do if Modulate API fails: fallback behavior, customer communication
  - [ ] Recovery procedures: backup restoration, data consistency checks

---

## 2. Hardware Integration & Firmware (Weeks 2-8)

### 2.1 Hardware Specification

**Status:** ⬜ Not Started
**Owner:** Hardware Lead
**Deadline:** Week 2

- [ ] **Finalize form factor**
  - [ ] Necklace pendant (30-40mm diameter) – **V1 target**
  - [ ] Teardown analysis: existing products (Friend Pendant, Limitless)
  - [ ] PCB layout: size, connector type (USB-C vs. magnetic pogo)
  - [ ] Material: aluminum or plastic casing (durability, weight, cost)
  - [ ] Design for manufacturing (DFM) review

- [ ] **Select core components**
  - [ ] Microcontroller: Nordic nRF52840 (BLE 5.0, Cortex-M4, 1MB SRAM)
  - [ ] Microphones: dual MEMS array (e.g., Knowles SPM0204UD5) for directionality
  - [ ] Audio codec: PDM to PCM converter (e.g., NXP PCA9640)
  - [ ] Haptic actuator: Linear Resonant Actuator (LRA), 200-300 mA draw
  - [ ] Battery: 500-600mAh LiPo (Panasonic, Sony), target 48hr life (V1: 24hr)
  - [ ] Power management IC: TPS63000 (buck-boost for battery voltage)
  - [ ] Storage: 4-8GB eMMC flash (for circular buffer + ML models)

- [ ] **Design power budget**
  - [ ] CPU active: 50mW, sleep: 5µW
  - [ ] BLE radio: 20mW (active), 1µW (idle)
  - [ ] Microphones: 5mW (always on)
  - [ ] Haptic: 400mW (peak, 50ms pulses)
  - [ ] Total idle: ~5mW → 100-120 hours on 500mAh (CPU/BLE in low-power)
  - [ ] Total active (audio capture): ~60mW → 8-10 hours on 500mAh (24hr target requires optimization)

- [ ] **Plan connectors & mechanical**
  - [ ] Charging: USB-C or magnetic pogo connector (pogo recommended for durability)
  - [ ] Mute button: physical + tactile feedback
  - [ ] Status LED: indicates battery, mute, pairing status
  - [ ] Strap attachment: 2-3 anchor points for secure wear

- [ ] **Material & safety review**
  - [ ] Skin contact materials: hypoallergenic, no BPA
  - [ ] FCC certification prep (RF emissions, antenna design)
  - [ ] Thermal review: max surface temp <45°C during continuous use
  - [ ] Drop test: survive 1.5m drop onto concrete
  - [ ] Water resistance: IPX4 (splash-proof, not submersible)

---

### 2.2 Firmware Architecture

**Status:** ⬜ Not Started
**Owner:** Firmware Lead
**Deadline:** Week 3-4

- [ ] **Select RTOS**
  - [ ] FreeRTOS: lightweight, proven, large community
  - [ ] Zephyr: modern, modular, strong IoT support
  - [ ] Choice: FreeRTOS for V1 (team familiarity)

- [ ] **Design firmware architecture**
  - [ ] Tasks: ADC reader, audio processor, BLE handler, storage manager, haptics controller
  - [ ] Message queues: ADC → Feature extractor → ML inference → Haptics
  - [ ] State machine: IDLE → RECORDING → ANALYZING → HAPTICS → TRANSMIT
  - [ ] Watchdog timer: reset if any task hangs > 30 seconds

- [ ] **Implement audio capture pipeline**
  - [ ] PDM microphones: 16-bit @ 16kHz (mono or stereo)
  - [ ] Circular buffer: store last 30-120 minutes (configurable)
  - [ ] VAD (voice activity detection): simple energy-based + frequency analysis
  - [ ] Speaker diarization: compare speaker voice to enrolled voiceprint (DTW or cosine distance)
  - [ ] Buffer management: compress old segments with Opus codec or discard

- [ ] **Implement feature extraction**
  - [ ] Real-time acoustic feature extraction (using ARM CMSIS-DSP)
  - [ ] Features per turn: pitch (mean, variance, min, max), speech rate, intensity, jitter, shimmer, HNR
  - [ ] Turn detection: silence > 500ms marks turn boundary
  - [ ] Serialization: compact binary format (~200 bytes per turn of features)
  - [ ] Time-sync: ensure timestamps are accurate (NTP via BLE from phone)

- [ ] **Implement on-device ML inference**
  - [ ] TensorFlow Lite Micro for lightweight models
  - [ ] Model 1: Reciprocity detector (5 turn weaver monologue → alert)
  - [ ] Model 2: Escalation detector (rising pitch + intensity + rate → alert)
  - [ ] Model 3: Turn-taking pause analyzer (wearer waits >3s for response → alert)
  - [ ] Model quantization: INT8 for speed, memory efficiency
  - [ ] Latency target: <100ms inference time per turn

- [ ] **Implement haptic feedback**
  - [ ] 3 patterns: SINGLE_PULSE (attention), DOUBLE_PULSE (question cue), TRIPLE_PULSE (correction)
  - [ ] Intensity levels: 1.0G, 1.2G, 1.5G (user configurable)
  - [ ] Duration: 50-200ms (tuned for perception, not annoyance)
  - [ ] Cooldown: >5 seconds between haptics (prevent overstimulation)
  - [ ] User button press: marks "confusing moment" + optional 10-second audio retention

- [ ] **Implement secure storage**
  - [ ] AES-256 encryption with key derived from device ID + user PIN
  - [ ] Feature data stored in plaintext (efficient queries)
  - [ ] Audio segments (if retained): stored encrypted on flash
  - [ ] Secure boot: verify firmware signature on startup

- [ ] **Implement BLE communication**
  - [ ] Service UUID: custom (0000TIZZ...)
  - [ ] 5 characteristics: device status, commands, feature stream, audio clips, settings
  - [ ] Data sync: batched JSON payloads (gzipped if >500 bytes)
  - [ ] Pairing: PIN or NFC tap (exchange device_secret)
  - [ ] Connection params: connection interval 20ms, MTU 247 bytes for faster sync

---

### 2.3 Firmware Testing

**Status:** ⬜ Not Started
**Owner:** Firmware Lead + QA
**Deadline:** Week 6-7

- [ ] **Unit testing**
  - [ ] Test audio feature extraction: compare to reference output (MATLAB/Python)
  - [ ] Test VAD accuracy: synthetic audio samples with known speech/silence
  - [ ] Test speaker diarization: pre-recorded voices of >5 people
  - [ ] Test ML inference: synthetic feature vectors with known labels
  - [ ] Test circular buffer: write, read, overflow behavior

- [ ] **Integration testing**
  - [ ] End-to-end capture + feature extraction + inference pipeline
  - [ ] BLE data sync: transfer 100 sessions, verify no data loss
  - [ ] Firmware update: OTA update process, fallback to previous if checksum fails
  - [ ] Power transitions: switch to low-power mode, resume full operation

- [ ] **Hardware testing**
  - [ ] Microphone directionality: test beam-forming with multiple speakers
  - [ ] Haptic feedback: user perception study (annoying? subtle? clear?)
  - [ ] Battery life: continuous capture for 24 hours, measure actual vs. estimated
  - [ ] BLE range: test connectivity from 30m away
  - [ ] Temperature stress: operate at 0°C and 40°C, verify accuracy
  - [ ] Water resistance: IPX4 test (20L/min spray from 2.5m distance)

- [ ] **User acceptance testing (beta)**
  - [ ] Recruit 10-15 internal testers + autism community partners
  - [ ] 1-week wear test: feedback on comfort, battery life, haptic intrusiveness
  - [ ] Audio quality: ask users if audio capture captures what they hear
  - [ ] Pairing experience: is Bluetooth pairing intuitive?
  - [ ] Mute button: is it easy to find without looking?

---

### 2.4 Manufacturing & Supply Chain

**Status:** ⬜ Not Started
**Owner:** Operations / Hardware Lead
**Deadline:** Week 7-8

- [ ] **Find contract manufacturer (CM)**
  - [ ] Request for quotation (RFQ): specify volume targets (100, 500, 2,000 units)
  - [ ] Lead time: typical 8-12 weeks (plan accordingly)
  - [ ] Cost per unit: target <$120 (retail $299)
  - [ ] Quality certifications: ISO 9001, ESD, RoHS compliance
  - [ ] References: interview 2-3 past customers

- [ ] **Design for manufacturing (DFM)**
  - [ ] Component sourcing: verify all components in stock or available
  - [ ] PCB routing: minimize high-speed traces, shield analog audio paths
  - [ ] Assembly: design for pick-and-place automation
  - [ ] Testing plan: 100% board test, sample rate testing, environmental stress screening
  - [ ] Cost review: identify high-cost components for optimization

- [ ] **Firmware provisioning**
  - [ ] Bootloader: QR code on each device for pairing
  - [ ] Factory reset: return to pairing mode when user holds button 10+ seconds
  - [ ] Device ID: unique hardware serial number programmed during manufacturing
  - [ ] Certificate: device signed with manufacturer cert for OTA update verification

- [ ] **Supply chain documentation**
  - [ ] Bill of materials (BoM): component names, part numbers, suppliers, costs
  - [ ] Manufacturing specification (e.g., "Assemble to revision 2.1, test per checklist X")
  - [ ] Storage & handling: proper ESD protection, temperature/humidity constraints
  - [ ] Warranty process: define what qualifies for warranty replacement

---

## 3. Mobile App Development (Weeks 2-8)

### 3.1 Development Environment

**Status:** ✅ Mostly Complete
**Owner:** Mobile Lead
**Deadline:** Week 1

Current Status: React Native + Expo SDK 52, TypeScript, new architecture enabled

- [ ] **Verify dev environment**
  - [ ] Install Node.js 18+, Expo CLI latest
  - [ ] iOS: Xcode 15+, iOS SDK 15+
  - [ ] Android: Android Studio, SDK API 28+
  - [ ] Test build: `npm install --legacy-peer-deps && npx expo run:ios` succeeds

- [ ] **Confirm dependency versions**
  - [x] React 19.1.0
  - [x] React Native 0.81.5
  - [x] Expo SDK 52+
  - [x] TypeScript 5.9.2
  - [ ] Verify all peer dependencies resolved (no warnings)

- [ ] **Set up local development**
  - [ ] `.env.local` file with: API_BASE_URL, Sentry DSN, analytics key
  - [ ] Mock API server (for testing without backend): simple Node.js app returning test data
  - [ ] Expo config: ensure bundleIdentifier matches App Store (com.calebsnewton.tizzy)
  - [ ] App.json: configured for iOS 15+, Android 10+

---

### 3.2 Core Screens & Navigation

**Status:** ⬜ Partially Started
**Owner:** Mobile Team
**Deadline:** Week 3-6

#### 3.2.1 Authentication Flow

- [ ] **Login / Sign-Up Screen**
  - [ ] Email input, OAuth button (Apple Sign-In for iOS)
  - [ ] Terms of Service + Privacy Policy links (required for COPPA compliance)
  - [ ] Age confirmation: "I confirm I am 13 or older"
  - [ ] Error states: invalid email, weak password, network error
  - [ ] Loading state: disable button, show spinner during auth

- [ ] **Onboarding Flow**
  - [ ] Screen 1: "Welcome to Tizzy" (video: how it works)
  - [ ] Screen 2: "Privacy first" (explain data handling)
  - [ ] Screen 3: "Pair your device" (scan QR code or manual entry)
  - [ ] Screen 4: "Set your goals" (select 1-3 focus areas: reciprocity, pacing, repair, etc.)
  - [ ] Skip option: users can skip pairing (app-only mode for now)

#### 3.2.2 Home / Dashboard Screen

- [ ] **Session list**
  - [ ] Card layout: date, duration, # turns, coaching status (analyzing, ready, no coaching)
  - [ ] Swipe actions: delete, share (if implemented)
  - [ ] Pull-to-refresh: sync latest sessions from device
  - [ ] Empty state: show if no sessions > 1 week (invite to wear device more)

- [ ] **Quick stats**
  - [ ] Today: sessions completed, minutes of conversation, mood (0-5 scale optional)
  - [ ] This week: improvement in key metric (e.g., reciprocity +8%)
  - [ ] Next goal: micro-goal from most recent session

- [ ] **Quick actions**
  - [ ] Button: "Sync Device" (fetch latest sessions via BLE)
  - [ ] Button: "View Trends" (go to analytics dashboard)
  - [ ] Button: "Privacy Controls" (consent, audio retention, data deletion)

#### 3.2.3 Conversation Review Screen

- [ ] **Timeline visualization**
  - [ ] Horizontal timeline: 0-30 min duration (1 pixel = ~10 seconds)
  - [ ] Color coding: green (good turn-taking), yellow (long turn), red (detected moment)
  - [ ] Tap to expand: show turn details (speaker, duration, detected patterns)
  - [ ] Haptic events: marked with icon (user can see what triggered each haptic)

- [ ] **Moment details**
  - [ ] Show: speaker label, prosody (pitch, rate), detected patterns (confusion, repair opportunity)
  - [ ] Coaching call-out: "Your friend paused for 3 seconds after you spoke"
  - [ ] Recommendation: "Try asking: 'Does that make sense?'"
  - [ ] Audio clip playback (if user enabled retention + opted into playback for this session)

- [ ] **Coaching insights**
  - [ ] Section 1: "What went well" (highlighted positive behaviors)
  - [ ] Section 2: "To improve" (specific, actionable next time)
  - [ ] Section 3: "Micro-goal" (tomorrow's focus)
  - [ ] Feedback: thumbs up/down + optional comment ("this was helpful / not helpful")

#### 3.2.4 Trends Dashboard

- [ ] **Metric selection**
  - [ ] Tab view: Reciprocity, Pacing, Repair, Topic Maintenance
  - [ ] Each tab shows: line chart (30-day or 90-day view)
  - [ ] Baseline: gray shaded area (user's typical range)
  - [ ] Trend direction: ↑ (improving) or ↓ (declining) with % change

- [ ] **Detailed view**
  - [ ] Tap metric → expanded view with: daily values, outliers flagged, week-over-week comparison
  - [ ] Export: button to save chart as image

- [ ] **Goal tracking**
  - [ ] Goal cards: title, target date, progress bar
  - [ ] Session contributions: how recent sessions helped progress toward goal
  - [ ] Micro-goals from coaching: track completion (user marks as done)

#### 3.2.5 Privacy Control Center

- [ ] **Consent status**
  - [ ] List all consent decisions: audio retention, transcript, therapist access, analytics
  - [ ] Toggle: enable/disable audio retention (default: OFF)
  - [ ] Timestamp: when each setting was changed

- [ ] **Therapist access management**
  - [ ] List: active therapist access grants (email, grant date, expiration)
  - [ ] Button: revoke access (immediate effect)
  - [ ] Button: add therapist (enter email, set duration, system sends invite)
  - [ ] Share link: one-time URL for therapist to join (expires in 7 days)

- [ ] **Audit log viewer**
  - [ ] List: recent access events (who, what, when, IP if available)
  - [ ] 100 most recent events shown
  - [ ] Filter: by type (login, data access, deletion), date range
  - [ ] Export: download full audit log as CSV

- [ ] **Data deletion**
  - [ ] Button: "Delete All My Data" (warning modal)
  - [ ] Confirmation: user must enter email + confirm via SMS/email link
  - [ ] Timeframe: explain 30-day deletion window (irreversible)
  - [ ] Status: after deletion request, show "Deletion in progress..." with estimated date

#### 3.2.6 Device Management

- [ ] **Device status**
  - [ ] Display: device name, firmware version, battery level, last sync time
  - [ ] Button: "Pair Device" (if not yet paired)
  - [ ] Button: "Unpair Device" (with confirmation modal)

- [ ] **Device controls**
  - [ ] Mute button: tap to mute for 15 min, 1 hour, or until unmute
  - [ ] Settings: haptic intensity slider, quiet hours (time range auto-disable)
  - [ ] Test haptics: button to trigger test pattern (user feels vibration)

- [ ] **Firmware updates**
  - [ ] Auto-check: once daily, notify user if update available
  - [ ] Manual check: button "Check for Updates"
  - [ ] Install flow: download (show progress), verify checksum, apply (may require restart)
  - [ ] Rollback: if update fails, auto-rollback to previous (show notification)

---

### 3.3 BLE Integration

**Status:** ⬜ Not Started
**Owner:** Mobile Lead + Native Developer
**Deadline:** Week 4-5

- [ ] **Set up react-native-ble-plx**
  - [ ] Install latest version (3.5.0+)
  - [ ] Configure iOS: add Entitlements.plist with NSBluetoothAlwaysUsageDescription
  - [ ] Configure Android: add permissions in AndroidManifest.xml (ACCESS_FINE_LOCATION, BLUETOOTH, etc.)
  - [ ] Test: pairing with a sample BLE device (e.g., Raspberry Pi with BlueZ)

- [ ] **Implement BLE communication layer**
  - [ ] Service: `BluetoothService` class with methods for all device operations
  - [ ] Discovery: scan for Tizzy devices (UUID 0000TIZZ...) with timeout
  - [ ] Connection: establish secure connection, handle disconnection/reconnection
  - [ ] Pairing: PIN exchange (user enters device PIN from hardware LED)

- [ ] **Implement data sync protocol**
  - [ ] Fetch device status: battery, storage, firmware version (every 10 seconds when app open)
  - [ ] Fetch session data: async streaming of feature objects, haptic events, user markers
  - [ ] Chunked transfer: max 247 bytes per BLE packet (MTU), reconstruct full JSON on client
  - [ ] Compression: gzip if payload >500 bytes
  - [ ] Retry logic: exponential backoff on timeout, max 3 retries

- [ ] **Implement command sending**
  - [ ] Mute command: write to device via BLE, confirm receipt
  - [ ] Settings sync: send haptic intensity, quiet hours, audio retention preference
  - [ ] Firmware update: initiate update, track progress
  - [ ] Error handling: clear user feedback if BLE command fails

- [ ] **BLE offline resilience**
  - [ ] Queue commands: if device disconnected, queue and retry when reconnected
  - [ ] Cached data: show cached coaching insights if fresh data not available
  - [ ] Notification: inform user when data is stale ("synced 3 hours ago")

---

### 3.4 Data Management & Caching

**Status:** ⬜ Not Started
**Owner:** Mobile Lead
**Deadline:** Week 4-5

- [ ] **Local SQLite database**
  - [ ] Schema: User, Device, Session, Features, HapticEvent, Coaching, AuditLog
  - [ ] Encryption: use SQLCipher (add react-native-sqlite-storage)
  - [ ] Migrations: versioned schema with rollback support
  - [ ] Cleanup: auto-delete sessions older than 6 months (or user-set retention)

- [ ] **State management (Zustand)**
  - [ ] Store: user, device status, current session, coaching summary, preferences
  - [ ] Persistence: save to SQLite on state changes (async, debounced)
  - [ ] Sync: merge cloud changes with local state (conflict resolution: cloud wins)
  - [ ] Example stores: `useAuthStore`, `useDeviceStore`, `useSessionStore`

- [ ] **API client**
  - [ ] Axios instance: base URL, token injection, error handling
  - [ ] Interceptors: add JWT token to all requests, refresh token on 401
  - [ ] Error handling: extract error message, show user-friendly toast notification
  - [ ] Request retry: exponential backoff for 5xx errors
  - [ ] Timeout: 30 seconds per request

- [ ] **Data sync orchestration**
  - [ ] On app launch: fetch user profile, sync device status
  - [ ] On session creation (device syncs): merge local + cloud coaching
  - [ ] On logout: clear cache, delete encrypted SQLite file
  - [ ] Conflict resolution: cloud data is source of truth (local is cache)

---

### 3.5 Analytics & Error Monitoring

**Status:** ⬜ Not Started
**Owner:** Mobile Lead
**Deadline:** Week 6-7

- [ ] **Sentry integration**
  - [ ] Install @sentry/react-native
  - [ ] Configure: DSN, environment (dev/staging/production), release version
  - [ ] Error reporting: all uncaught exceptions automatically sent to Sentry
  - [ ] Session replay: enable for debuggability (toggle for privacy-sensitive users)
  - [ ] Source maps: upload to Sentry for readable stack traces

- [ ] **Custom error boundaries**
  - [ ] Component: `<ErrorBoundary>` wraps entire app
  - [ ] Fallback UI: show error message + "Send Report" button
  - [ ] Sentry integration: capture error context (screen, user, state)

- [ ] **Analytics (optional V1, required V2)**
  - [ ] If implementing: Amplitude or custom event logging (not GA for privacy)
  - [ ] Events: session_reviewed, goal_set, coaching_feedback_given, micro_goal_completed
  - [ ] Avoid: detailed user behavior patterns (privacy-first)
  - [ ] Dashboard: track: daily active users, session review rate, retention cohorts

- [ ] **Performance monitoring (Sentry)**
  - [ ] Track: app startup time, screen load time, BLE sync duration
  - [ ] Identify slow operations: optimize if >1 second

---

### 3.6 iOS Specific

**Status:** ⬜ Not Started
**Owner:** iOS Developer
**Deadline:** Week 6-7

- [ ] **Push notifications**
  - [ ] Request user permission: first app launch
  - [ ] Certificate: generate APNs certificate in Apple Developer account
  - [ ] Payload: coaching digest ("Great progress this week! Review insights")
  - [ ] Timing: send 1x per week (avoid notification fatigue)

- [ ] **App Store metadata**
  - [ ] App name: "Tizzy - Conversation Coach"
  - [ ] Description: clear, non-medical language
  - [ ] Keywords: autism, coaching, conversation, communication, wearable
  - [ ] Screenshot: show key screens (device pairing, coaching insights, trends)
  - [ ] Category: Health & Fitness or Productivity
  - [ ] Privacy policy URL: publicly hosted on tizzy.com/privacy
  - [ ] Age rating: 4+ (COPPA compliance)

- [ ] **App Store Review preparation**
  - [ ] Privacy policy: review for App Store compliance (explain data collection, storage, deletion)
  - [ ] Terms of Service: review for App Store (no prohibited activities)
  - [ ] Test on physical iPhone (iOS 15+) and iPad
  - [ ] Build & archive: `eas build --platform ios` (Expo managed workflow)

---

### 3.7 Android Specific

**Status:** ⬜ Not Started
**Owner:** Android Developer
**Deadline:** Week 6-7

- [ ] **Push notifications**
  - [ ] Firebase Cloud Messaging (FCM) integration
  - [ ] Request permissions: android.permission.POST_NOTIFICATIONS
  - [ ] Payload: same as iOS coaching digest
  - [ ] Testing: send test notification via Firebase Console

- [ ] **Play Store metadata**
  - [ ] App name, description, keywords (same as iOS)
  - [ ] Screenshot, feature graphic (1024x500px)
  - [ ] Privacy policy URL, content rating
  - [ ] Category: Health & Fitness
  - [ ] Target SDK: 34+ (current Google Play requirement)

- [ ] **Play Store Review preparation**
  - [ ] Data Safety form: declare data collection (location, contacts, sensitive audio data)
  - [ ] Privacy policy: detailed explanation of audio capture & storage
  - [ ] Secure design: SSL/TLS for API, encryption at rest
  - [ ] Build & sign: `eas build --platform android` (generate release APK)
  - [ ] Test on physical Android device (Android 10+)

---

## 4. External Services Configuration (Weeks 3-6)

### 4.1 Modulate.ai Setup

**Status:** ⬜ Not Started
**Owner:** Backend Lead / Partnerships
**Deadline:** Week 3

- [ ] **Request API access**
  - [ ] Contact: partnerships@modulate.ai
  - [ ] Share: Tizzy pitch, use case (autism conversational coaching)
  - [ ] Request: developer API access, pricing information, SLA

- [ ] **Review documentation**
  - [ ] API endpoints: what inputs (features, audio, embeddings)?
  - [ ] Output format: intent labels, emotion labels, confidence scores
  - [ ] Rate limits: requests per second, monthly quota
  - [ ] Latency targets: SLA (e.g., <500ms per request)
  - [ ] Data retention: does Modulate retain/use our data? (answer: NO in contract)

- [ ] **Negotiate contract**
  - [ ] Data privacy: Modulate cannot train models on Tizzy user data
  - [ ] Pricing: volume discounts for 1K+, 10K+ users
  - [ ] Exclusivity: can we use Modulate for autism-specific coaching? (answer: yes)
  - [ ] Exit clause: can we switch to alternative if service degrades?
  - [ ] SLA: uptime guarantee, outage credits

- [ ] **Set up API key management**
  - [ ] Store API key in AWS Secrets Manager (never in code)
  - [ ] Rotate quarterly
  - [ ] Log all usage for cost tracking

---

### 4.2 Sentry.io Setup

**Status:** ⬜ Not Started
**Owner:** DevOps / Mobile Lead
**Deadline:** Week 4

- [ ] **Create Sentry project**
  - [ ] Team: tizzy
  - [ ] Projects: tizzy-mobile (React Native), tizzy-backend (Node.js)
  - [ ] Slack integration: send critical errors to #incidents channel

- [ ] **Mobile app integration**
  - [ ] Copy DSN from Sentry (project settings)
  - [ ] Add to app.json or environment config
  - [ ] Test: trigger exception in dev build, verify appears in Sentry

- [ ] **Backend integration**
  - [ ] Copy DSN for backend
  - [ ] Middleware: wrap all express routes with Sentry
  - [ ] Configure breadcrumbs: database queries, API calls, important events

- [ ] **Alert rules**
  - [ ] Alert: new error type detected (email)
  - [ ] Alert: error rate >5% in 5 min window (Slack)
  - [ ] Alert: release health: >10% crash rate (Slack)

---

### 4.3 Authentication Provider (Auth0 or Firebase)

**Status:** ⬜ Not Started
**Owner:** Backend Lead / Mobile Lead
**Deadline:** Week 3

#### Option A: Auth0

- [ ] **Create Auth0 tenant**
  - [ ] Tenant name: `tizzy`
  - [ ] Region: US-East (match app region)
  - [ ] Enable: passwordless (email magic link) + social login (Apple, Google)

- [ ] **Create applications**
  - [ ] Mobile app: type "Native"
  - [ ] Backend API: type "Machine-to-Machine"
  - [ ] Copy Client ID, Client Secret (store in Secrets Manager)

- [ ] **Configure application settings**
  - [ ] Allowed callback URL: `com.calebsnewton.tizzy://auth0.com/android/com.calebsnewton.tizzy/callback` (Android), `tizzy://callback` (iOS)
  - [ ] Allowed logout URL: `com.calebsnewton.tizzy://`
  - [ ] CORS allowed origins: `https://api.tizzy.com`

- [ ] **Enable rules (if needed for compliance)**
  - [ ] Rule: block users < 13 years old (COPPA)
  - [ ] Rule: require email verification (child accounts require parent email)

#### Option B: Firebase Auth

- [ ] **Create Firebase project**
  - [ ] Go to firebase.google.com, create project
  - [ ] Link to backend infrastructure
  - [ ] Enable: Email/Password, Apple Sign-In, Google Sign-In

- [ ] **Configure authentication methods**
  - [ ] Email verification required
  - [ ] Custom claims: add "age_verified" claim for COPPA
  - [ ] Session persistence: 14 days (token expiry)

- [ ] **Set up email templates**
  - [ ] Welcome email, password reset, email verification
  - [ ] Custom branding: Tizzy logo, colors

---

### 4.4 Analytics Platform (Optional V1, Required V2)

**Status:** ⬜ Not Started
**Owner:** Product / Analytics
**Deadline:** Week 6 (defer to V1.5 if time-constrained)

**Recommended:** Amplitude (privacy-friendly, event-based) or Mixpanel

- [ ] **Set up analytics account**
  - [ ] Create project: Tizzy Mobile App
  - [ ] Install SDK: `@react-native-firebase/analytics` (if using Firebase) or Amplitude SDK
  - [ ] Configure: environment, release version, session timeout (30 min idle)

- [ ] **Define events**
  - [ ] Session reviewed, coaching feedback given, goal set, micro-goal completed
  - [ ] Device paired, mute activated, audio retention toggled
  - [ ] Therapist access granted, data deletion requested
  - [ ] Avoid: keystroke, detailed location, behavioral patterns

- [ ] **Privacy compliance**
  - [ ] Disable Google Analytics (not privacy-friendly)
  - [ ] GDPR: implement consent mechanism (EU users must opt-in)
  - [ ] Anonymization: hash user IDs, don't track IP

---

### 4.5 Push Notification Service

**Status:** ⬜ Not Started
**Owner:** Backend Lead
**Deadline:** Week 5

**iOS:** Apple Push Notification (APN)
**Android:** Firebase Cloud Messaging (FCM)

#### iOS (APN)

- [ ] **Generate APNs certificate**
  - [ ] Go to Apple Developer account → Certificates
  - [ ] Create new cert: "Apple Push Notification service SSL"
  - [ ] Download .cer file, convert to .p8 format (private key)
  - [ ] Store in Secrets Manager (never in code)

- [ ] **Configure backend**
  - [ ] Library: `apn` or `node-apn` (Node.js)
  - [ ] Provider token: use .p8 private key
  - [ ] Test: send test notification to dev device

#### Android (FCM)

- [ ] **Get Firebase credentials**
  - [ ] Go to Firebase Console → Project settings → Service Accounts
  - [ ] Generate new private key (JSON)
  - [ ] Store in Secrets Manager

- [ ] **Configure backend**
  - [ ] Library: `firebase-admin` (Node.js)
  - [ ] Initialize with service account key
  - [ ] Test: send test notification to dev device

#### Backend Implementation

- [ ] **Notification service class**
  - [ ] Method: `sendDailyCoachingDigest(user_id)` → query weekly summary, compose message, send via APN/FCM
  - [ ] Scheduling: daily at user's preferred time (stored in preferences)
  - [ ] Retry: exponential backoff if delivery fails
  - [ ] Opt-out: respect user's notification preference (default: ON)

- [ ] **Notification payload**
  - [ ] Title: "Your weekly Tizzy coaching summary"
  - [ ] Body: "Great progress on reciprocity! Review this week's insights."
  - [ ] Deep link: `tizzy://dashboard?filter=week` (opens app to relevant screen)

---

## 5. Legal & Compliance (Weeks 1-8)

### 5.1 Privacy & Data Protection

**Status:** ⬜ Partially Started
**Owner:** Legal / Compliance
**Deadline:** Week 6

- [ ] **Privacy impact assessment**
  - [ ] Document all data: user profile, audio features, coaching insights, audit logs
  - [ ] Identify sensitive data: audio (primary), user goals (secondary)
  - [ ] Risk assessment: what if breached? (impact on users)
  - [ ] Mitigation: encryption, access controls, incident response
  - [ ] Document: `/legal/PRIVACY-IMPACT-ASSESSMENT.md`

- [ ] **Privacy policy**
  - [ ] Sections: what data we collect, why, how we store it, how long, who has access
  - [ ] Clear language: no legalese, explain in plain English
  - [ ] Age-specific: include COPPA explanation (V1: 13+, V2: support younger with parental consent)
  - [ ] Audio retention: default OFF, explain that enabling means audio processed by external services
  - [ ] Deletion rights: explain "delete all data" process
  - [ ] Modulate partnership: disclose that Modulate processes features (not raw audio)
  - [ ] Version control: date of last update, notify users of material changes
  - [ ] Host on website: `https://tizzy.com/privacy` (publicly accessible)

- [ ] **Terms of service**
  - [ ] Sections: user eligibility (13+), account responsibilities, prohibited uses, disclaimers
  - [ ] Disclaimers: NOT medical diagnosis/treatment, not a replacement for therapy
  - [ ] Limitation of liability: Tizzy not liable for social outcomes
  - [ ] Indemnification: users agree not to blame Tizzy for coaching advice
  - [ ] Host on website: `https://tizzy.com/terms`

- [ ] **Data retention policy**
  - [ ] Features: 90 days (auto-delete), then aggregate to monthly summaries (3 years)
  - [ ] Raw audio (if retained): delete after 7 days unless marked for retention
  - [ ] Coaching insights: retain for user's reference (3 years typical)
  - [ ] Audit logs: 7 years (compliance requirement)
  - [ ] User metadata: kept until account deletion, then anonymized
  - [ ] Document: `/legal/DATA-RETENTION-POLICY.md`

- [ ] **Data deletion mechanism**
  - [ ] Implement: soft-delete user + anonymize in audit logs
  - [ ] Timeline: immediate revocation of access, physical deletion within 30 days
  - [ ] Exceptions: keep anonymized aggregate stats (no PII), keep legal holds
  - [ ] Test: verify all user data removed except anonymized aggregates
  - [ ] Notification: confirmation email when deletion complete

---

### 5.2 COPPA Compliance (if adding <13 users in future)

**Status:** ⬜ Not Started (defer to V2)
**Owner:** Legal
**Deadline:** Before expanding to <13 users

- [ ] **Age verification**
  - [ ] Collect: age at signup (online collection)
  - [ ] Implement: age gate on signup (confirm 13+)
  - [ ] For <13 users (V2): collect verified parental email

- [ ] **Parental consent (V2)**
  - [ ] Mechanism: send email to parent, parent clicks link to confirm
  - [ ] Documentation: keep record of parental consent
  - [ ] Data limits: restrict what data can be shared/sold
  - [ ] Right to deletion: parent can request deletion of child's data anytime

- [ ] **COPPA compliance checklist**
  - [ ] Collect only necessary info (email, age, goals)
  - [ ] Don't use personal info for behavioral targeting
  - [ ] Don't sell/share data with third parties (except Modulate for analysis)
  - [ ] Clear, honest privacy policy (written for parents, not lawyers)
  - [ ] Safe harbor: follow industry guidelines (FTC Safe Harbor certification)

---

### 5.3 Recording Consent Laws

**Status:** ⬜ Not Started
**Owner:** Legal
**Deadline:** Week 4

- [ ] **Research state laws**
  - [ ] All-party consent states: CA, FL, IL, MD, MA, MI, MT, NH, PA, WA
  - [ ] Two-party consent states: most others (one party is sufficient = user)
  - [ ] Strategy: design for all-party consent (strictest standard)

- [ ] **Implement bystander notification**
  - [ ] Hardware: LED indicator when recording (visual notification)
  - [ ] OR: announce "conversation is being recorded"
  - [ ] Consent: ask users to inform conversation partners they're wearing recording device
  - [ ] Document: user acknowledges responsibility in onboarding

- [ ] **Legal review**
  - [ ] Consult lawyer in target states (if different from HQ location)
  - [ ] Confirm: compliant with state recording laws
  - [ ] Document legal opinion: `/legal/RECORDING-CONSENT-ANALYSIS.md`

---

### 5.4 Healthcare Liability (if needed for V1)

**Status:** ⬜ Not Started
**Owner:** Legal
**Deadline:** Week 6

- [ ] **FDA classification decision**
  - [ ] Is Tizzy a "medical device"? (does it diagnose, treat, prevent disease?)
  - [ ] V1 positioning: "conversation coach" (not medical device)
  - [ ] Disclaimers: "not a replacement for therapy, not medical diagnosis"
  - [ ] Document decision: `/legal/FDA-CLASSIFICATION.md`

- [ ] **Liability insurance**
  - [ ] General liability: $2M minimum (covers bodily injury, property damage)
  - [ ] Product liability: $1M minimum (covers defective product claims)
  - [ ] Cyber liability: $1M minimum (covers data breach, privacy claims)
  - [ ] Professional liability: $1M (if offering coaching/expertise)
  - [ ] Get quotes: 2-3 insurance brokers

- [ ] **Informed consent**
  - [ ] Tone: users understand Tizzy is an assistant, not therapist
  - [ ] In-app disclosure: "Tizzy provides suggestions, not diagnoses"
  - [ ] Therapist collaboration: not a replacement for professional support
  - [ ] Crisis resources: if user indicates distress, show crisis hotline

---

### 5.5 Accessibility & ADA Compliance

**Status:** ⬜ Partially Started
**Owner:** Product / Design
**Deadline:** Week 7

- [ ] **WCAG 2.1 AA compliance**
  - [ ] Typography: minimum 14pt font, good contrast (4.5:1 text/background)
  - [ ] Buttons: minimum 48x48pt (touch targets)
  - [ ] Colors: don't rely on color alone (use labels, icons)
  - [ ] Navigation: keyboard navigation, screen reader support
  - [ ] Forms: clear labels, error messages, required field indicators
  - [ ] Animations: no flashing > 3x per second (seizure risk)

- [ ] **Screen reader testing**
  - [ ] iOS: use VoiceOver
  - [ ] Android: use TalkBack
  - [ ] Test key flows: login, session review, coaching insights
  - [ ] Label all interactive elements: buttons, form fields, images

- [ ] **Autism-inclusive design**
  - [ ] Sensory: optional haptics, no loud sounds by default
  - [ ] Cognitive: clear language, simple navigation, no overwhelming visuals
  - [ ] Timing: no strict time limits (allow users to take breaks)
  - [ ] Testing: with autistic users (co-design preferred)

---

## 6. Hardware Integration & Device Pairing (Weeks 5-8)

### 6.1 BLE Pairing Flow (Device-to-App)

**Status:** ⬜ Not Started
**Owner:** Hardware + Mobile Leads
**Deadline:** Week 6

- [ ] **QR code pairing**
  - [ ] Hardware: unique QR code printed on necklace pendant (or on packaging)
  - [ ] QR format: `tizzy://pair?device_id=UUID&secret=KEY`
  - [ ] Mobile: scan QR via built-in camera or in-app scanner
  - [ ] Pairing: initiate BLE connection, verify device secret, save to device

- [ ] **PIN pairing (fallback)**
  - [ ] Hardware: display 4-digit PIN on LED or in manual documentation
  - [ ] Mobile: user enters PIN in app
  - [ ] Verification: device confirms PIN matches
  - [ ] Security: PIN changes every 1 hour (or after use)

- [ ] **Pairing confirmation**
  - [ ] Device vibrates: user confirms they initiated pairing
  - [ ] App shows: "Device successfully paired: Tizzy Necklace [MAC address]"
  - [ ] Storage: device secret saved in secure storage (Keychain on iOS, Keystore on Android)

- [ ] **Unpair flow**
  - [ ] User: open device settings, tap "Unpair Device"
  - [ ] Confirmation: "Are you sure? Device will return to pairing mode"
  - [ ] Effect: app forgets device, device goes to pairing mode (ready for new user)

---

### 6.2 Firmware Update Over-the-Air (OTA)

**Status:** ⬜ Not Started
**Owner:** Firmware + Mobile Leads
**Deadline:** Week 7

- [ ] **Firmware versioning**
  - [ ] Semantic versioning: v1.0.0 (major.minor.patch)
  - [ ] Release notes: document changes, bug fixes, known issues
  - [ ] Minimum supported: ensure older app versions can still pair + sync with new firmware

- [ ] **Build & distribution**
  - [ ] Compile firmware to binary file (.bin)
  - [ ] Sign: ECDSA signature (verify authenticity, prevent tampering)
  - [ ] Upload: store in S3 with metadata (version, size, checksum)
  - [ ] Check: device verifies firmware signature before installing

- [ ] **Update flow**
  - [ ] Check: app queries backend once daily for updates (or on user request)
  - [ ] Download: if new version available, download via BLE (streamed, resumable)
  - [ ] Verify: checksum validation (SHA256)
  - [ ] Install: device firmware restarts in bootloader mode, writes new firmware, verifies
  - [ ] Rollback: if checksum fails, revert to previous version (stored as backup)
  - [ ] Confirm: app shows "Update successful!" or error message

- [ ] **Testing**
  - [ ] Test update: from v1.0.0 → v1.0.1 (happy path)
  - [ ] Test rollback: kill power during update, verify device recovers
  - [ ] Test signature verification: reject firmware with invalid signature
  - [ ] Test connectivity: resume interrupted download if BLE drops

---

### 6.3 Hardware-Firmware Integration Testing

**Status:** ⬜ Not Started
**Owner:** Hardware + Firmware Leads
**Deadline:** Week 7-8

- [ ] **Integration test suite**
  - [ ] Audio capture: record 5 min, verify circularBuffer operation
  - [ ] Feature extraction: verify features match reference (e.g., MATLAB)
  - [ ] VAD accuracy: test with known speech/silence audio
  - [ ] Speaker diarization: multi-person test
  - [ ] ML inference: verify on-device models produce reasonable outputs
  - [ ] Haptic feedback: user perception (annoying? clear? subtle?)
  - [ ] Battery consumption: measure actual vs. model

- [ ] **User acceptance testing (beta cohort)**
  - [ ] Recruit 10-20 beta testers (autism community + internal team)
  - [ ] 1-week continuous wear test
  - [ ] Feedback: comfort, battery life, haptic intrusiveness, data sync quality
  - [ ] Iterate: adjust haptic intensity, battery optimization based on feedback

---

## 7. Testing & QA (Weeks 6-8)

### 7.1 Manual Testing Checklist

**Status:** ⬜ Not Started
**Owner:** QA Lead
**Deadline:** Week 7-8

#### Core Flows

- [ ] **User registration**
  - [ ] Register with email, verify email sent
  - [ ] Login, logout, password reset
  - [ ] Age verification (must be 13+)
  - [ ] Privacy policy acceptance (required checkbox)

- [ ] **Device pairing**
  - [ ] Scan QR code (or enter PIN), pair successfully
  - [ ] Device appears in app with correct status
  - [ ] Unpair device, pair again
  - [ ] Error case: try to pair with invalid code → clear error message

- [ ] **Session capture & review**
  - [ ] Wear device for 5-10 min conversation
  - [ ] Device records session, shows session ID
  - [ ] App syncs: BLE connection, download session data
  - [ ] Session appears in app with correct timestamp, duration
  - [ ] Tap session → view coaching insights (should appear within 1 min of sync)

- [ ] **Coaching insights**
  - [ ] Insights appear in 3 sections: "What went well", "To improve", "Micro-goal"
  - [ ] Insights are specific (e.g., "You asked 3 questions" not "good job")
  - [ ] Language is clear, supportive, not ableist
  - [ ] Feedback button: rate insight as helpful or not
  - [ ] Test multiple sessions: insights vary (not copy-paste)

- [ ] **Trends dashboard**
  - [ ] Dashboard shows 4 metrics: reciprocity, pacing, repair, topic maintenance
  - [ ] Graph shows 30-day data with baseline shaded area
  - [ ] Tap metric → expanded view with daily values
  - [ ] No data: show "Wear your device for 7 days to see trends"

- [ ] **Privacy controls**
  - [ ] Audio retention toggle: OFF by default, can enable
  - [ ] Therapist access: add email, grant access, revoke
  - [ ] Audit log: shows past access events
  - [ ] Delete all data: request deletion, confirm via email link

- [ ] **Device controls**
  - [ ] Mute device: app mute command reaches device within 1 second
  - [ ] Test haptics: tap button, feel vibration
  - [ ] Settings sync: adjust haptic intensity, restart device, verify persists

#### Error Handling

- [ ] **No network**
  - [ ] App offline: show cached coaching insights
  - [ ] App reconnects: auto-sync sessions (should merge without duplicates)
  - [ ] BLE disconnect: show "Device offline", retry sync when reconnect

- [ ] **Backend errors**
  - [ ] Coaching analysis fails: show "Analysis in progress, check back soon"
  - [ ] API returns 500: show "Server error, try again later"
  - [ ] Rate limiting (429): show "Too many requests, wait 1 min before retrying"

- [ ] **Invalid user actions**
  - [ ] Try to delete account twice: show "Deletion already in progress"
  - [ ] Try to revoke therapist access twice: no effect, no error (idempotent)
  - [ ] Try to pair with invalid QR code: clear error message, option to retry

#### Performance

- [ ] **App startup**
  - [ ] Cold start: <3 seconds (from app icon to home screen)
  - [ ] Hot start: <1 second (app already in memory)
  - [ ] No janky animations or freezes

- [ ] **Session review load**
  - [ ] Load session: <2 seconds (cached on device)
  - [ ] Scroll timeline: smooth (60 FPS), no lag

- [ ] **BLE sync**
  - [ ] Sync 50 sessions: <30 seconds
  - [ ] Sync 1 GB of features: parallel transfer, resume on disconnect

---

### 7.2 Automated Testing

**Status:** ⬜ Not Started
**Owner:** Backend + Mobile Leads
**Deadline:** Week 7

#### Backend Tests

- [ ] **Unit tests**
  - [ ] Cover all business logic: coaching score calculations, baseline computation, threshold logic
  - [ ] Target: 80%+ code coverage
  - [ ] Tools: Jest (Node.js) or pytest (Python)

- [ ] **Integration tests**
  - [ ] Test full API flows: register → pair device → sync session → get coaching
  - [ ] Test external integrations: Modulate API, LLM API calls
  - [ ] Test database: create users, sessions, coaching summaries (end-to-end)
  - [ ] Test error cases: invalid input, missing fields, unauthorized access

- [ ] **Security tests**
  - [ ] SQL injection: try to inject SQL in API inputs
  - [ ] XSS: try to inject JavaScript in user input
  - [ ] CSRF: verify tokens required for state-changing operations
  - [ ] Authentication: verify JWT validation, token expiration

#### Mobile Tests

- [ ] **Unit tests**
  - [ ] State management: Zustand store actions + selectors
  - [ ] Utility functions: date formatting, metric calculations
  - [ ] Target: 60%+ code coverage

- [ ] **Integration tests**
  - [ ] API client: mock axios, verify requests are formatted correctly
  - [ ] BLE service: mock react-native-ble-plx, test pairing + data sync
  - [ ] Screen flows: user login → onboarding → home → session review

- [ ] **E2E tests (Detox)**
  - [ ] Full user flow: register → pair device → review session → check trends
  - [ ] Error cases: network error during sync, invalid session data
  - [ ] Test on real device (iOS simulator or Android emulator)

---

### 7.3 Beta Testing Program

**Status:** ⬜ Not Started
**Owner:** Product / Ops
**Deadline:** Week 6-8

- [ ] **Recruit beta users**
  - [ ] Target: 20-50 autistic adults (college/young professional transition)
  - [ ] Sources: autism communities (r/autisticadults, Autistic Women and Nonbinary Network), therapist partners, university programs
  - [ ] Selection: prioritize diversity (race, gender, severity, background)
  - [ ] Incentive: free device + subscription (value ~$300)

- [ ] **Beta program structure**
  - [ ] Duration: 4 weeks of active use + feedback
  - [ ] Weekly surveys: "How helpful is the coaching?", "Any bugs or issues?", "What would you change?"
  - [ ] Group calls (bi-weekly): discuss learnings, answer questions, gather feedback
  - [ ] Close-out: exit interview, how would you recommend to a friend (NPS)?

- [ ] **Feedback collection**
  - [ ] Quantitative: NPS (0-10), coaching helpfulness (1-5 scale), device comfort (1-5)
  - [ ] Qualitative: open-ended feedback on each section
  - [ ] Bugs: error logs, unusual behavior, crashes
  - [ ] Feature requests: compilation of desired future features

- [ ] **Iteration based on feedback**
  - [ ] Document findings: `/docs/BETA-FEEDBACK-SYNTHESIS.md`
  - [ ] Prioritize issues: critical bugs → fixes within 1 week, feature requests → roadmap
  - [ ] Communicate back: "Your feedback led to these improvements in v1.1"

---

## 8. Pre-Launch Preparation (Weeks 7-8)

### 8.1 App Store & Play Store Preparation

**Status:** ⬜ Not Started
**Owner:** Mobile Lead / Ops
**Deadline:** Week 7

#### App Store (iOS)

- [ ] **Developer account**
  - [ ] Register: Apple Developer Program ($99/year)
  - [ ] Complete: developer profile, legal agreements

- [ ] **App submission**
  - [ ] Bundle ID: `com.calebsnewton.tizzy` (already set in app.json)
  - [ ] Privacy policy URL: `https://tizzy.com/privacy`
  - [ ] Screenshots: 5-7 screens (English + optional localization)
  - [ ] App preview video: 30 sec demo of key features (optional)
  - [ ] Support URL: `https://tizzy.com/support` or support@tizzy.com
  - [ ] Content rating: health & fitness, no medical claims
  - [ ] Category: Health & Fitness
  - [ ] Keywords: autism, conversation, coaching, wearable, communication

- [ ] **TestFlight beta**
  - [ ] Internal testing: invite team members
  - [ ] External testing: invite beta users (up to 100 external testers)
  - [ ] Collect feedback: crashes, bugs, performance
  - [ ] Iterate: fix issues before public launch

#### Play Store (Android)

- [ ] **Developer account**
  - [ ] Register: Google Play Developer ($25 one-time)
  - [ ] Complete: company account, payment method

- [ ] **App submission**
  - [ ] Package name: `com.calebsnewton.tizzy`
  - [ ] App signing: use Google Play App Signing (auto-managed)
  - [ ] Privacy policy: required (link to `https://tizzy.com/privacy`)
  - [ ] Data safety questionnaire: declare data collection
    - [ ] Audio data: what's collected, how encrypted, how long retained
    - [ ] User location: NO (we don't collect)
    - [ ] Personal info: email only (for account management)
  - [ ] Screenshots: 2-8 images, multiple orientations
  - [ ] Short description: <80 characters
  - [ ] Full description: <4000 characters
  - [ ] Content rating: Self-certification questionnaire
  - [ ] Category: Health & Fitness
  - [ ] Permissions: BLUETOOTH, RECORD_AUDIO, INTERNET, etc.

- [ ] **Internal testing**
  - [ ] Test on Android 10, 11, 12, 13, 14 devices
  - [ ] Pre-launch report: Google Play generates report (potential issues)

---

### 8.2 Environment Variable & Secrets Management

**Status:** ⬜ Not Started
**Owner:** DevOps / Backend Lead
**Deadline:** Week 7

- [ ] **Backend secrets**
  - [ ] Database password: store in AWS Secrets Manager
  - [ ] Auth0 client secret: AWS Secrets Manager
  - [ ] Modulate API key: AWS Secrets Manager
  - [ ] LLM API key (OpenAI/Anthropic): AWS Secrets Manager
  - [ ] JWT signing key: AWS Secrets Manager
  - [ ] APNs certificate: AWS Secrets Manager
  - [ ] Firebase service account: AWS Secrets Manager
  - [ ] Rotation: every 90 days, automatic if possible

- [ ] **Mobile app environment variables**
  - [ ] API_BASE_URL: `https://api.tizzy.com` (production), `http://localhost:3000` (dev)
  - [ ] Sentry DSN: unique per app (iOS vs Android)
  - [ ] Auth0 domain: `tizzy.auth0.com`
  - [ ] Firebase config: download from Firebase Console (JSON)
  - [ ] Build: use Expo's EAS (managed build service) or GitHub Actions

- [ ] **Configuration management**
  - [ ] `.env.example`: template with no secrets (checked into git)
  - [ ] `.env.local`: local overrides (ignored by git)
  - [ ] `.env.production`: production overrides (only for CI/CD, secrets injected at runtime)
  - [ ] Verification: run `npm start` without .env → clear error message (helps catch config issues)

---

### 8.3 Privacy Policy & Terms Hosting

**Status:** ⬜ Not Started
**Owner:** Legal / Ops
**Deadline:** Week 6

- [ ] **Host on website**
  - [ ] Create `/privacy` and `/terms` pages on tizzy.com
  - [ ] Markdown or HTML version
  - [ ] Link from app: About → Privacy Policy / Terms of Service

- [ ] **Version control**
  - [ ] Each update: save dated backup (e.g., `privacy-2026-02-13.md`)
  - [ ] Changelog: document what changed in each version
  - [ ] Notification: if material changes, notify users in-app + email

- [ ] **Compliance**
  - [ ] Review: legal counsel final review before launch
  - [ ] Translation: if supporting non-English users, translate policy
  - [ ] Accessibility: ensure policy pages meet WCAG 2.1 AA

---

### 8.4 Incident Response & Crisis Plan

**Status:** ⬜ Not Started
**Owner:** Legal / Ops / Leadership
**Deadline:** Week 8

- [ ] **Data breach response**
  - [ ] Escalation: who to contact (CEO, legal, security lead)
  - [ ] Notification: inform affected users within 72 hours (FTC requirement)
  - [ ] Investigation: forensic analysis, root cause, remediation
  - [ ] Communication: transparent public statement on Tizzy blog
  - [ ] Prevention: improve security measures to prevent recurrence

- [ ] **Harmful coaching incident**
  - [ ] If user reports harmful coaching insight: take seriously
  - [ ] Investigation: review coaching generation (model, LLM prompt, user context)
  - [ ] Remediation: apologize, explain what happened, iterate model
  - [ ] Prevention: add guardrails to coaching LLM (no harmful suggestions)

- [ ] **Service outage**
  - [ ] Monitoring: alert on-call engineer immediately
  - [ ] Triage: assess severity (API down? Database slow? BLE broken?)
  - [ ] Communication: status page (status.tizzy.com) + user notification
  - [ ] Resolution: fix issue, restore service, post-mortem
  - [ ] Target RTO: <30 min for critical services, <2 hours for non-critical

- [ ] **Contact list**
  - [ ] CEO: [name] [phone]
  - [ ] Legal: [lawyer] [phone]
  - [ ] Security lead: [name] [phone]
  - [ ] On-call engineer: [rotation schedule]
  - [ ] Public comms: [PR/comms person]

---

### 8.5 Pre-Launch Checklist

**Status:** ⬜ Not Started
**Owner:** Product Lead / CTO
**Deadline:** Week 8 (24 hours before launch)

- [ ] **Code & deployment**
  - [ ] All tests passing: unit, integration, E2E
  - [ ] No critical or high-priority bugs in backlog
  - [ ] Code review: all PRs reviewed + approved
  - [ ] Staging env: tested end-to-end, matches production config
  - [ ] Production env: health checks passing, monitoring active

- [ ] **Legal & compliance**
  - [ ] Privacy policy + Terms of Service reviewed by lawyer
  - [ ] COPPA compliance: age verification working (13+ only)
  - [ ] Recording consent: LED indicator or consent acknowledgement
  - [ ] Data deletion: mechanism tested end-to-end
  - [ ] Insurance: liability + cyber insurance policies active

- [ ] **Security**
  - [ ] API security scan: OWASP Top 10 checklist passed
  - [ ] Database encryption: enabled, keys secured
  - [ ] Authentication: JWT tokens, refresh token rotation working
  - [ ] Rate limiting: active on all endpoints
  - [ ] SSL/TLS: certificate valid, pinning configured for mobile
  - [ ] Secrets: no hardcoded secrets, all in Secrets Manager

- [ ] **Mobile & hardware**
  - [ ] iOS: TestFlight build stable, ready for App Store submission
  - [ ] Android: Google Play internal testing build stable
  - [ ] Device pairing: tested on 3+ physical devices
  - [ ] BLE sync: 50+ sessions sync without data loss
  - [ ] Battery life: meets 24+ hour target
  - [ ] Haptics: tested and approved by autistic testers

- [ ] **Operations**
  - [ ] On-call rotation: schedule in place, escalation paths defined
  - [ ] Monitoring dashboards: up, alerts configured
  - [ ] Status page: live and monitoring
  - [ ] Support email: staffed, response time <4 hours
  - [ ] Documentation: runbooks, API docs, user guides reviewed

- [ ] **Product**
  - [ ] Beta feedback: incorporated into final build
  - [ ] Known issues: documented on help page
  - [ ] Getting started guide: written + tested with new user
  - [ ] FAQ: addresses common questions
  - [ ] Success metrics: baseline established for first 30 days

---

## 9. Post-Launch (First 30 Days)

### 9.1 Monitoring & Observability

- [ ] **Daily health checks**
  - [ ] API uptime: 99.5%+ target
  - [ ] Database performance: query latency p95 < 1 second
  - [ ] Error rate: < 1% of requests
  - [ ] External services: Modulate, LLM, Sentry all functional
  - [ ] User feedback: review Sentry errors, app store reviews

- [ ] **Weekly metrics review**
  - [ ] Daily active users (DAU)
  - [ ] Session completion rate (% of sessions that get coaching)
  - [ ] Coaching helpfulness: avg rating of 4+ on 5-point scale
  - [ ] BLE sync success rate: >99%
  - [ ] Retention: % still using app after 7, 14, 30 days

### 9.2 User Support

- [ ] **Support channels**
  - [ ] Email: support@tizzy.com (24-hour response target)
  - [ ] In-app help: FAQ, troubleshooting guides
  - [ ] Twitter/community: monitor social media for feedback

- [ ] **Common issues to anticipate**
  - [ ] BLE pairing problems → troubleshooting guide
  - [ ] Battery drain → firmware optimization
  - [ ] Coaching insights seem off → explain how coaching works
  - [ ] Delete account request → process within 30 days

### 9.3 Iteration Based on Real Data

- [ ] **Coaching quality**
  - [ ] Sample insights daily: are they accurate, helpful, non-harmful?
  - [ ] Low confidence insights: suppress if <0.6 confidence
  - [ ] Common issues: adjust LLM prompt or models
  - [ ] User feedback: incorporate into model training

- [ ] **Hardware reliability**
  - [ ] Track crash rates: any firmware instability?
  - [ ] Battery data: compare actual to projections
  - [ ] BLE issues: reliability, range, sync time
  - [ ] Hardware quality: any physical defects reported?

- [ ] **User engagement**
  - [ ] Daily active users: goal 10%+ of beta cohort
  - [ ] Session review rate: goal 80%+ of captured sessions
  - [ ] Feature usage: which screens used most? (optimize those)
  - [ ] Churn: why do users stop using? (exit survey)

---

## Priority Matrix

### Critical Path to MVP Launch
1. **Backend API endpoints** (Weeks 1-5) – blocks everything
2. **Database schema + migrations** (Week 2) – blocks data storage
3. **Mobile app core screens** (Weeks 2-6) – user-facing
4. **Device pairing + BLE sync** (Weeks 4-6) – hardware integration
5. **Firmware basic audio capture** (Weeks 3-6) – hardware integration
6. **Authentication system** (Week 2-3) – security critical
7. **Coaching insights generation** (Weeks 4-5) – core value prop
8. **Legal review + COPPA** (Weeks 5-6) – compliance critical

### Nice-to-Haves (Defer to V1.1 if needed)
- Multi-language support
- Therapist portal (beta access in V1, full in V1.5)
- Transcription service (v1.5)
- Advanced ML models (V2)
- Video/nonverbal cues (V3)

---

## Success Criteria (30-Day Launch Target)

**If all items above are completed by Week 8:**
- ✅ MVP ready for beta launch
- ✅ 20-50 early users testing
- ✅ Privacy-first architecture proven
- ✅ Core value prop (coaching) validated
- ✅ Sustainable unit economics (<$2/user/month cost)

**Metrics for success:**
- NPS (Net Promoter Score) >30
- 30-day retention >70%
- Coaching helpfulness >4.0/5.0
- Zero critical security incidents
- App Store rating >4.5 stars

---

## Questions & Decisions Required

Before executing this plan, the team should decide:

1. **Cloud provider:** AWS (recommended), GCP, or multi-cloud?
2. **Mobile framework:** React Native (locked), confirm build tooling?
3. **Auth provider:** Auth0 or Firebase? (recommend Auth0 for flexibility)
4. **LLM for coaching:** OpenAI GPT-4 Turbo, Anthropic Claude, or other?
5. **Modulate contract status:** already in talks, or need to initiate?
6. **Beta cohort:** how to recruit 20-50 autism community members?
7. **Timeline:** 8 weeks realistic, or need more time for hardware manufacturing?

---

**Document Status:** Ready for team review and assignment
**Next Step:** Assign owners to each section, create sprint plan (2-week sprints recommended)
**Last Updated:** February 13, 2026
