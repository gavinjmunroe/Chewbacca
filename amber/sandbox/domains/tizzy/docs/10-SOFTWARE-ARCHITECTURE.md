# Software Architecture

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** V1 System Design

---

## Executive Summary

Tizzy's software architecture is designed as a three-layer system that transforms continuous audio capture into personalized conversational coaching. The architecture prioritizes privacy-by-design, on-device processing where feasible, and modular components that enable rapid iteration. The true moat is not infrastructure—it's the autism-specific models, personalization engine, and dataset that powers accurate coaching.

---

## Architectural Principles

### 1. Privacy-First Architecture
- **Local Processing Default:** Raw audio processed on-device to features; cloud receives only metadata
- **Data Minimization:** Retain only what's necessary for coaching; circular buffer overwrites by default
- **User Control as Feature:** Every data flow is auditable and configurable by user
- **Encryption Everywhere:** Data at rest and in transit always encrypted

### 2. Modular and Swappable
- **Vendor Independence:** Core value (autism coaching) not locked to any single ML vendor
- **Component Isolation:** Can replace Modulate, transcription engine, or hosting without rewriting coaching logic
- **API-First Design:** Internal services communicate via well-defined APIs

### 3. Personalization Over Time
- **Adaptive Baselines:** System learns user's conversational norms; coaching relative to individual, not population
- **Goal-Driven Coaching:** User or parent sets focus areas; system prioritizes those patterns
- **Uncertainty Handling:** Model expresses confidence; low confidence triggers clarifying questions rather than false coaching

### 4. Scalable from 100 to 100,000 Users
- **Cost-Effective Processing:** Leverage edge compute to minimize cloud costs
- **Tiered Storage:** Hot (recent sessions), warm (last 30 days), cold (long-term trends)
- **Async Processing:** Non-urgent analysis in batch jobs; real-time only for in-moment haptics

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       TIZZY SYSTEM ARCHITECTURE                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│                  │         │                  │         │                  │
│  WEARABLE DEVICE │◄───────►│  MOBILE APP      │◄───────►│  CLOUD BACKEND   │
│  (Edge Layer)    │  BLE    │  (Client Layer)  │  HTTPS  │  (Service Layer) │
│                  │         │                  │         │                  │
└──────────────────┘         └──────────────────┘         └──────────────────┘
        │                            │                            │
        │                            │                            │
    [Layer 1]                    [Layer 2]                    [Layer 3]
  Capture Pipeline            User Interface              Understanding &
  Feature Extraction        Visualization                   Coaching Engine
  Real-Time Haptics         Data Sync                      Personalization
                            Local Storage                   Therapist Portal
```

---

## Layer 1: Capture and Feature Pipeline (On-Device)

### Responsibilities
- Continuous audio capture with privacy controls
- Voice activity detection and segmentation
- Speaker diarization preprocessing
- Acoustic feature extraction
- Lightweight real-time classification for haptics
- Local encryption and secure storage

### Components

#### 1.1 Audio Capture Manager

**Function:** Raw audio acquisition from dual-microphone array

**Implementation:**
- Continuous 16kHz, 16-bit PCM capture
- Dual-channel recording (left/right mics)
- Circular buffer: 30-120 minute rolling window in RAM
- Overwrite policy: FIFO unless explicitly marked for retention

**Interfaces:**
```
AudioCaptureManager:
  - start_capture(mode: CaptureMode) -> Result
  - stop_capture() -> Result
  - mark_segment(timestamp: Timestamp, label: String) -> Result
  - get_buffer_status() -> BufferInfo
  - set_hard_mute(enabled: bool) -> Result
```

**Capture Modes:**
- `SELF_ONLY`: Wearer voice isolation priority
- `CONVERSATION`: Multi-speaker capture and diarization
- `AMBIENT`: Environmental audio context (low priority processing)
- `MUTED`: Microphones powered off

#### 1.2 Voice Activity Detection (VAD)

**Function:** Identify speech segments vs. silence/noise

**Algorithm Options:**
- WebRTC VAD (lightweight, proven)
- Silero VAD (higher accuracy, slightly more compute)
- Custom trained on autism dataset (future)

**Performance Targets:**
- Latency: <50ms
- False positive rate: <5%
- Power consumption: <2mA average

**Output:**
```json
{
  "segment_id": "seg_1234",
  "start_time": 1644770400.123,
  "end_time": 1644770405.678,
  "confidence": 0.92,
  "speech_energy": 0.65
}
```

#### 1.3 Speaker Diarization Preprocessor

**Function:** Distinguish wearer voice from other speakers

**Approach:**
- **Phase 1 (V1):** Acoustic fingerprinting of wearer voice during onboarding
- **Phase 2 (V1.5):** Clustering-based separation for multi-speaker conversations
- **Phase 3 (V2):** Transformer-based diarization (Pyannote.audio or custom)

**Wearer Voice Enrollment (Onboarding):**
- User reads 2-3 minutes of scripted text
- Extract speaker embedding (e.g., x-vectors, d-vectors)
- Store embedding securely on device

**Real-Time Classification:**
- Compare incoming speech to wearer embedding
- Label each turn as: `WEARER`, `OTHER_SPEAKER`, `MULTIPLE`, `UNCERTAIN`

**Output:**
```json
{
  "turn_id": "turn_5678",
  "speaker": "WEARER",
  "confidence": 0.88,
  "segment_start": 1644770401.0,
  "segment_end": 1644770404.5
}
```

#### 1.4 Acoustic Feature Extractor

**Function:** Transform raw audio into coaching-relevant features

**Features Extracted (Per Turn):**

**Prosody Features:**
- Mean pitch (F0), pitch variance, pitch range
- Speech rate (syllables per second)
- Intensity (volume) mean and variance
- Pause duration distribution
- Voiced vs. unvoiced ratio

**Timing Features:**
- Turn duration
- Inter-turn gap (response latency)
- Overlap duration (interruption metric)
- Silence ratio within turn

**Voice Quality Features:**
- Jitter (pitch perturbation)
- Shimmer (amplitude perturbation)
- Harmonic-to-noise ratio (voice strain indicator)

**Emotional Acoustic Features:**
- Arousal proxy (high frequency energy)
- Tension markers (spectral centroid shift)
- Stress indicators (combined prosody patterns)

**Feature Representation:**
```json
{
  "turn_id": "turn_5678",
  "features": {
    "prosody": {
      "mean_pitch_hz": 145.3,
      "pitch_variance": 22.1,
      "speech_rate_sps": 4.8,
      "mean_intensity_db": -18.5,
      "intensity_variance_db": 8.2
    },
    "timing": {
      "duration_sec": 3.5,
      "pause_count": 2,
      "mean_pause_sec": 0.4,
      "overlap_with_other": false
    },
    "voice_quality": {
      "jitter_percent": 0.8,
      "shimmer_db": 0.3,
      "hnr_db": 18.5
    }
  }
}
```

#### 1.5 Lightweight On-Device ML

**Function:** Real-time classification for haptic feedback triggers

**Models Deployed on Device:**

**Model 1: Pacing Detector**
- Input: Speech rate, pitch variance, turn duration
- Output: "TOO_FAST", "TOO_SLOW", "OPTIMAL"
- Trigger: Single pulse haptic when outside personalized range

**Model 2: Reciprocity Detector**
- Input: Turn lengths, turn-taking gaps, speaker ratios
- Output: "ONE_SIDED_WEARER", "ONE_SIDED_OTHER", "BALANCED"
- Trigger: Double pulse haptic when wearer monologuing

**Model 3: Escalation Detector**
- Input: Intensity variance, pitch variance, overlap events, HNR
- Output: "CALM", "ELEVATED", "ESCALATING"
- Trigger: Long pulse haptic when escalation detected

**Model Architecture:**
- Tiny feedforward networks or decision trees (not deep learning)
- <100KB model size per classifier
- Inference time: <10ms per turn
- Framework: TensorFlow Lite Micro or scikit-learn exported to C

**Personalization:**
- Models calibrated during first 7 days (baseline learning)
- Thresholds adjusted based on user's conversational norms
- Can be further tuned by therapist via app

#### 1.6 Haptic Controller

**Function:** Translate model outputs to vibration patterns

**Pattern Mapping:**
```
MODEL OUTPUT            → HAPTIC PATTERN
─────────────────────────────────────────
TOO_FAST / TOO_SLOW     → Single Pulse (200ms, 1.2G)
ONE_SIDED_WEARER        → Double Pulse (150ms-100ms-150ms, 1.2G)
ESCALATING              → Long Pulse (500ms, 1.8G)
```

**Haptic Rate Limiting:**
- Maximum 1 haptic per 30 seconds (avoid overwhelming user)
- Priority queue: escalation > reciprocity > pacing
- User can disable specific patterns via app

**Haptic Log:**
```json
{
  "haptic_id": "hap_9012",
  "timestamp": 1644770410.5,
  "pattern": "DOUBLE_PULSE",
  "trigger_reason": "ONE_SIDED_WEARER",
  "conversation_context": {
    "wearer_turn_count": 8,
    "other_turn_count": 1,
    "duration_sec": 120
  }
}
```

#### 1.7 Secure Storage Manager

**Function:** Encrypt and store data locally on device

**Storage Tiers:**

**Tier 1: Volatile (RAM Circular Buffer)**
- Raw audio: overwritten every 30-120 minutes
- Current session features: retained until sync

**Tier 2: Persistent (Flash Storage)**
- Daily acoustic feature summaries (non-audio)
- Haptic event logs
- User-marked "interesting moments" (audio snippets if enabled)
- Device settings and ML model weights

**Encryption:**
- AES-256 encryption for all persistent storage
- Key derived from device hardware ID + user PIN/biometric
- No cloud key escrow (user loses data if device lost and not backed up)

**Deletion Policies:**
- Marked segments: retained 30 days by default, user configurable
- Acoustic features: retained 90 days
- Haptic logs: retained 90 days
- Raw audio (if retained): deleted after 7 days unless user extends

---

## Layer 2: Mobile App (Client Layer)

### Responsibilities
- User interface for coaching insights and trends
- Bluetooth sync with wearable device
- Local data caching and visualization
- Cloud backend communication
- Privacy controls and consent management

### Key Features

#### 2.1 Post-Conversation Review

**Timeline View:**
- Visual timeline of conversation with annotated moments
- Color-coded segments: green (positive), yellow (opportunity), red (escalation)
- Tap segment to see: what happened, why it matters, what to try next

**Clip Playback (Optional, Requires Opt-In):**
- User can enable "save audio for select moments"
- Clips limited to 10-30 second snippets, not full conversations
- Requires re-confirmation of consent each session

**Insights Panel:**
- "What went well" (top 2 strengths in conversation)
- "What to improve" (top 2 patterns to work on)
- "One micro-goal for tomorrow"

#### 2.2 Trends and Progress Dashboard

**Weekly Summary:**
- Turn-taking balance (wearer vs. others over time)
- Conversation length trends
- Haptic feedback frequency (declining = learning)
- Reciprocity score trend

**Focus Area Tracking:**
- User/parent selects 1-2 skills to prioritize (e.g., "ask more questions", "notice confusion cues")
- System highlights progress on those specific skills
- Celebratory milestones ("7-day streak of balanced conversations!")

**Visual Design:**
- Simple line graphs, bar charts (not overwhelming data dumps)
- Colorblind-friendly palette
- Annotations explaining what each metric means

#### 2.3 Privacy Control Center

**User-Facing Controls:**
- Toggle: "Save audio for review" (default OFF)
- Toggle: "Share with therapist" (default OFF)
- Button: "Delete all my data" (immediate, irreversible)
- View: "What data exists about me" (audit log)

**Consent Receipts:**
- Log of every conversation with capture mode and consent status
- Exportable consent history for compliance or legal needs

**Quiet Hours:**
- User sets times when capture auto-disables (e.g., 10pm-7am)
- Override available if needed

#### 2.4 Therapist Collaboration (Opt-In)

**Export Options:**
- Generate PDF summary of week/month insights (no raw audio)
- Share annotated timeline with therapist (feature data only)
- Optional: share select audio clips with explicit per-clip consent

**Therapist View (Separate Portal Access):**
- Aggregate progress across sessions
- Goal adjustment interface (therapist suggests focus areas)
- Notes and recommendations back to user/parent

#### 2.5 Onboarding and Calibration

**First-Time Setup:**
1. Voice enrollment (wearer records sample)
2. Haptic calibration ("Do you feel this vibration?")
3. Goal setting (What do you want to improve?)
4. Privacy education (Video explaining what Tizzy does/doesn't do)

**Ongoing Calibration:**
- Weekly "check-in" to refine personalization
- Ability to report false haptics ("That buzz didn't make sense")

### Technology Stack (Mobile App)

**Cross-Platform Framework:**
- **React Native** or **Flutter** (single codebase for iOS/Android)
- Native modules for Bluetooth LE, secure storage, audio playback

**Local Database:**
- SQLite or Realm for caching conversation data locally
- Sync state management for offline operation

**Bluetooth Communication:**
- React Native BLE library (`react-native-ble-plx`) or Flutter equivalent
- Retry logic for dropped connections
- Background sync when app not in foreground (iOS limitations noted)

**Visualization:**
- Recharts (React Native) or FL Chart (Flutter) for graphs
- Custom timeline component for conversation playback

---

## Layer 3: Cloud Backend (Service Layer)

### Responsibilities
- Deeper conversation analysis using advanced ML models
- Personalization and coaching logic
- Therapist portal backend
- Data storage and security
- API endpoints for mobile app and device

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUD BACKEND SERVICES                    │
└─────────────────────────────────────────────────────────────┘

API Gateway (REST/GraphQL)
    │
    ├──► Authentication Service (Auth0 / Firebase Auth)
    │
    ├──► Data Ingestion Service
    │        ├─► Feature Store (TimescaleDB / InfluxDB)
    │        └─► Blob Storage (S3 / GCS) [encrypted audio if retained]
    │
    ├──► Understanding Service
    │        ├─► Modulate ELM API (licensed, external)
    │        ├─► Transcription Service (Whisper / Deepgram)
    │        └─► Tizzy Autism Models (proprietary)
    │
    ├──► Coaching Engine
    │        ├─► Personalization Service (user baselines, goal tracking)
    │        ├─► Insight Generation (GPT-4 or Claude for natural language summaries)
    │        └─► Recommendation Engine
    │
    ├──► Therapist Portal API
    │        ├─► Cohort Analytics
    │        └─► Goal Management
    │
    └──► Admin & Monitoring
             ├─► Audit Logs (Datadog / ELK Stack)
             ├─► Model Performance Monitoring
             └─► User Consent Management
```

### Service Specifications

#### 3.1 Data Ingestion Service

**Function:** Receive feature data from mobile app, validate, store

**API Endpoint:**
```
POST /api/v1/sessions
Authorization: Bearer <user_jwt>

Request Body:
{
  "session_id": "sess_abc123",
  "device_id": "dev_xyz789",
  "start_time": "2026-02-13T10:00:00Z",
  "end_time": "2026-02-13T10:15:00Z",
  "environment": "school",
  "consent_mode": "CONVERSATION",
  "turns": [ /* turn-level feature data */ ],
  "haptic_events": [ /* haptic log */ ],
  "user_markers": [ /* manual annotations */ ]
}

Response:
{
  "session_id": "sess_abc123",
  "status": "received",
  "next_analysis_eta": "2026-02-13T10:20:00Z"
}
```

**Processing:**
- Validate data schema and user permissions
- Store raw features in time-series database
- Enqueue session for deeper analysis (async)

#### 3.2 Understanding Service

**Function:** Apply advanced ML to extract conversational insights

**Sub-Service: Modulate ELM Integration**

**Purpose:** Voice tone and intent understanding beyond transcription

**API Call (Tizzy → Modulate):**
```
POST https://api.modulate.ai/v1/analyze
Authorization: Bearer <tizzy_api_key>

Request:
{
  "audio_url": "<presigned_s3_url>",  // Only if audio retained
  "features": { /* acoustic features */ },
  "context": "autism_coaching"
}

Response:
{
  "intent": "question",
  "emotion": "neutral",
  "prosody_analysis": {
    "pacing": "fast",
    "intensity": "elevated",
    "confidence": 0.87
  }
}
```

**Modulate Contract Boundaries:**
- **Licensing:** Inference-only, no training rights to Tizzy's autism dataset
- **Data Residency:** Modulate processes in their cloud; Tizzy ensures compliance
- **Fallback:** If Modulate API down, Tizzy falls back to on-device features only

**Sub-Service: Transcription Engine**

**Options:**
- OpenAI Whisper (self-hosted for privacy)
- Deepgram (API, cost-effective, fast)
- Google Speech-to-Text (fallback)

**Use Case:**
- Transcript generated ONLY when user opts in for "text review"
- Transcript used for topic analysis, literal interpretation detection
- NOT used for primary coaching (acoustic features more important)

**Sub-Service: Tizzy Autism-Specific Models**

**Proprietary Models (Tizzy's Moat):**

1. **Topic Maintenance Classifier**
   - Input: Turn sequence, speaker roles, semantic embeddings
   - Output: "ON_TOPIC", "DRIFT", "ABRUPT_SHIFT"
   - Training: Autism dataset with therapist labels

2. **Repair Detection Model**
   - Input: Turn pairs, prosody changes, clarification phrases
   - Output: "REPAIR_ATTEMPTED", "REPAIR_SUCCESSFUL", "MISSED_REPAIR_OPPORTUNITY"
   - Training: SLP-annotated autism conversations

3. **Confusion Moment Detector**
   - Input: Long pauses, overlapping speech, tone mismatch, silence after question
   - Output: "LIKELY_CONFUSION", confidence score
   - Training: Self-reported + parent-reported confusion moments

4. **Theory of Mind Marker Detector** (V2)
   - Input: Transcript, prosody, context
   - Output: "LITERAL_INTERPRETATION", "MISSED_SARCASM", "IMPLIED_MEANING_MISSED"
   - Training: ASHA social communication benchmarks

**Model Deployment:**
- TensorFlow Serving or PyTorch Serve
- A/B testing framework for model updates
- Rollback capability if model degrades performance

#### 3.3 Coaching Engine

**Function:** Transform understanding layer outputs into actionable coaching

**Sub-Service: Personalization Engine**

**User Baseline Modeling:**
- First 7 days: establish user's conversational norms
- Compare individual performance to their baseline, not population average
- Update baseline slowly over time (avoid overfitting to recent bad days)

**Data Structure:**
```json
{
  "user_id": "user_123",
  "baseline": {
    "mean_speech_rate": 4.2,
    "mean_turn_length": 12.5,
    "reciprocity_ratio": 0.65,
    "weekly_conversation_hours": 8.3
  },
  "goals": [
    {"skill": "ask_return_questions", "priority": 1, "progress": 0.42},
    {"skill": "notice_confusion_cues", "priority": 2, "progress": 0.18}
  ],
  "last_updated": "2026-02-13T10:00:00Z"
}
```

**Sub-Service: Insight Generation**

**Natural Language Summaries:**
- Use LLM (GPT-4-turbo or Claude 3.5 Sonnet) to generate human-readable insights
- Input: Structured coaching events, user goals, conversation features
- Output: "What went well", "What to improve", "Micro-goal"

**Prompt Template:**
```
You are a conversation coach for an autistic user. Given the following data:
- User's goals: {{goals}}
- Conversation summary: {{features}}
- Detected patterns: {{events}}

Generate:
1. Two specific things that went well (be encouraging, not patronizing).
2. Two specific improvement opportunities (be constructive, not critical).
3. One micro-goal for tomorrow (actionable, measurable, user-aligned).

Tone: Supportive, clarity-focused, never enforce conformity.
```

**Output Example:**
```json
{
  "session_id": "sess_abc123",
  "insights": {
    "went_well": [
      "You asked two follow-up questions during the lunch conversation, which kept the dialogue balanced.",
      "When your friend seemed confused, you paused and clarified your point—great repair skill!"
    ],
    "to_improve": [
      "There were three moments where you spoke for over a minute without checking if the listener was following. Try shorter turns tomorrow.",
      "You missed a chance to ask about your friend's weekend when they mentioned it. Practice asking return questions."
    ],
    "micro_goal": "Tomorrow, after speaking for 20-30 seconds, pause and ask: 'Does that make sense?' or 'What do you think?'"
  }
}
```

**Sub-Service: Recommendation Engine**

**Practice Drills:**
- Suggest roleplay scenarios based on detected weaknesses
- Example: "Practice ending a topic by saying, 'Anyway, I'm curious—how was your day?'"
- Link to library of video examples (future: interactive practice with voice AI)

#### 3.4 Therapist Portal API

**Function:** Enable SLPs and autism professionals to collaborate with users

**Portal Features:**
- View user progress (with consent)
- Set or adjust coaching goals
- Leave notes and recommendations
- Export progress reports for clinical records

**API Endpoints:**
```
GET /api/v1/therapist/clients
  → List clients who have granted access

GET /api/v1/therapist/clients/:user_id/progress
  → Aggregate progress data, no raw audio

POST /api/v1/therapist/clients/:user_id/goals
  → Suggest new coaching focus areas

POST /api/v1/therapist/clients/:user_id/notes
  → Add clinical notes (encrypted, audit-logged)
```

**Access Control:**
- User explicitly grants therapist access via app
- Access can be revoked at any time
- Audit log of all therapist views and actions

#### 3.5 Admin and Monitoring

**Audit Logging:**
- Every data access, deletion, and consent change logged
- Immutable append-only log (compliance requirement)
- User can view their own audit log via app

**Model Performance Monitoring:**
- Track model accuracy via user feedback ("Was this helpful?")
- A/B test new models with small cohorts before rollout
- Alert if model confidence drops below threshold

**Security:**
- SOC 2 Type II compliance (future milestone)
- Regular penetration testing
- Bug bounty program for responsible disclosure

### Technology Stack (Cloud Backend)

**Framework:**
- **Node.js + Express** or **Python + FastAPI** for API services
- **Go** for high-throughput data ingestion

**Database:**
- **PostgreSQL** (primary relational DB for users, sessions, goals)
- **TimescaleDB** extension for time-series feature data
- **Redis** for caching and session management

**Blob Storage:**
- **AWS S3** or **Google Cloud Storage** for encrypted audio (if retained)
- Pre-signed URLs for time-limited access

**ML Infrastructure:**
- **TensorFlow Serving** or **PyTorch Serve** for model inference
- **Kubeflow** or **SageMaker** for model training pipelines (future)

**Hosting:**
- **AWS** or **Google Cloud Platform**
- Multi-region deployment for latency (US-East, US-West initially)
- HIPAA-eligible infrastructure even though V1 not medical device (future-proofing)

**API Gateway:**
- **Kong** or **AWS API Gateway**
- Rate limiting, request validation, JWT authentication

**Authentication:**
- **Auth0** or **Firebase Authentication**
- Support for email/password, Google/Apple sign-in
- MFA for therapist accounts (required)

---

## Data Flow: End-to-End Example

### Scenario: User has a 10-minute conversation at school

**Step 1: Capture (Device Layer)**
- Microphones capture audio continuously
- VAD detects speech segments
- Diarization labels turns as WEARER or OTHER
- Acoustic features extracted per turn
- Reciprocity model detects "one-sided wearer" pattern
- Device triggers double-pulse haptic at minute 7

**Step 2: Storage (Device Layer)**
- Features, timestamps, and haptic events stored in encrypted flash
- Raw audio remains in circular buffer (will be overwritten unless user marks)
- User taps button to mark "interesting moment" at minute 9

**Step 3: Sync (Mobile App)**
- At end of day, user opens app
- App syncs via Bluetooth: features, events, marked moment
- Marked moment (audio snippet) uploaded to cloud with encryption

**Step 4: Cloud Analysis (Backend Layer)**
- Data ingestion service receives feature data
- Understanding service applies Tizzy autism models:
  - Topic maintenance: "DRIFT" detected twice
  - Confusion moment: "LIKELY_CONFUSION" at marked moment
  - Repair: "MISSED_REPAIR_OPPORTUNITY" after confusion
- Coaching engine generates insights using LLM
- Personalization engine compares to user baseline (conversation was 20% longer turns than usual)

**Step 5: Insights Delivered (Mobile App)**
- App displays post-conversation review:
  - Timeline with annotated moments
  - "What went well": "You stayed engaged for 10 minutes—that's focus!"
  - "To improve": "When your friend seemed confused, try asking, 'Should I explain differently?'"
  - "Micro-goal": "Tomorrow, pause every minute and check: 'Does that make sense?'"
- User reviews, marks insight as "helpful"
- Insight marked helpful → feedback logged for model improvement

**Step 6: Therapist View (Optional)**
- User has enabled therapist sharing
- Therapist logs into portal, sees weekly summary
- Therapist notes: "Great progress on conversation length. Let's focus on repair strategies."
- Therapist adjusts goal priority in system
- Next day, app coaching emphasizes repair opportunities

---

## API Specifications

### Device-to-App API (Bluetooth LE)

**BLE Service UUID:** `0000TIZZ-0000-1000-8000-00805F9B34FB`

**Characteristics:**

1. **Session Data Transfer (Write/Notify)**
   - UUID: `0001TIZZ...`
   - Format: JSON chunks, gzip-compressed
   - Max size per chunk: 512 bytes (BLE MTU limit)

2. **Device Status (Read/Notify)**
   - UUID: `0002TIZZ...`
   - Format: `{ "battery": 87, "mute": false, "recording": true }`

3. **Control Commands (Write)**
   - UUID: `0003TIZZ...`
   - Commands: `SYNC_NOW`, `SET_QUIET_HOURS`, `UPDATE_HAPTIC_CONFIG`

### App-to-Cloud API (REST)

**Base URL:** `https://api.tizzy.ai/v1`

**Authentication:** Bearer token (JWT) in `Authorization` header

**Key Endpoints:**

```
POST /sessions
  → Upload conversation session data

GET /sessions/:session_id/insights
  → Retrieve coaching insights for a session

GET /users/:user_id/trends
  → Retrieve weekly/monthly progress trends

POST /users/:user_id/goals
  → Update user coaching goals

DELETE /users/:user_id/data
  → Delete all user data (GDPR right to erasure)

GET /therapist/clients
  → List clients (therapist-scoped)

POST /feedback
  → Submit user feedback on coaching quality
```

**Rate Limiting:**
- 100 requests per minute per user
- 1000 requests per minute per therapist

---

## Personalization and Machine Learning

### ML Model Training Pipeline

**Dataset Collection:**
1. Users opt-in to contribute anonymized conversation features
2. Users/parents label moments: "I was confused here", "This was good", "I overshared"
3. Therapists annotate select sessions (high-quality labels)
4. Active learning: model flags uncertain moments, asks for clarification

**Training Workflow:**
```
Raw Data (Encrypted) → De-identification → Feature Engineering →
  Split (Train/Val/Test) → Model Training (AutoML or Custom) →
  Evaluation (Clinical Metrics) → Staging Deployment (Beta Users) →
  A/B Testing → Production Deployment
```

**Clinical Validation Metrics:**
- Not just accuracy—measure coaching helpfulness via user feedback
- Goal achievement rate (did user improve on target skill?)
- Therapist agreement rate (do SLPs concur with model outputs?)
- Harm avoidance (false positive rate for escalation alerts)

**Model Versioning:**
- All models tagged with version number
- User's coaching tied to specific model version (reproducibility)
- Can roll back if new model performs worse

### Personalization Algorithm

**Baseline Establishment (First 7 Days):**
```python
baseline = {
  "speech_rate": percentile(user_turns.speech_rate, 50),
  "turn_length": percentile(user_turns.duration, 50),
  "reciprocity": mean(wearer_turns / total_turns),
  "pause_duration": percentile(user_turns.pauses, 50)
}
```

**Ongoing Adjustment:**
- Exponentially weighted moving average (EWMA) to adapt baseline slowly
- Outlier detection: flag sessions >2 std dev from baseline (possible stress/atypical context)
- Goal-based weighting: features related to user's goals weighted higher in coaching

**Example: Personalized Haptic Threshold**
```python
if user_speech_rate > (baseline_speech_rate + personalized_threshold):
    trigger_haptic("SINGLE_PULSE", reason="TOO_FAST")

# Threshold adapts based on user feedback
if user_feedback == "HELPFUL":
    personalized_threshold *= 0.95  # Become more sensitive
elif user_feedback == "ANNOYING":
    personalized_threshold *= 1.1   # Become less sensitive
```

---

## Security and Privacy

### Threat Model

**Threats:**
1. Unauthorized access to user conversations (most critical)
2. Bystander voice exfiltration
3. Device theft or loss
4. Malicious app impersonation
5. Cloud data breach
6. Insider threat (Tizzy employee access)

**Mitigations:**

**1. Encryption Everywhere**
- Data at rest: AES-256 on device and cloud
- Data in transit: TLS 1.3, certificate pinning
- Key management: User-derived keys (device), AWS KMS (cloud)

**2. Minimal Data Retention**
- Raw audio: circular buffer, overwritten by default
- Features: 90 days, then aggregated summaries only
- Audit logs: 7 years (compliance requirement)

**3. Access Controls**
- User data accessible only to that user and explicitly consented therapists
- Admin access requires MFA + audit logging
- No Tizzy employee can access user data without explicit consent or legal requirement

**4. Bystander Protection**
- Speaker diarization separates wearer from others
- Bystander voice not retained by default
- If conversation shared with therapist, only wearer's turns included unless bystander consents

**5. Device Security**
- Secure boot to prevent firmware tampering
- Device paired to single user account (cannot be transferred without factory reset)
- Lost device: remote wipe via app

**6. Penetration Testing**
- Annual third-party security audit
- Bug bounty program for responsible disclosure

---

## Scalability and Cost

### Cost Model (Per User, Monthly)

| Component | Cost per User | Notes |
|-----------|---------------|-------|
| **Cloud Storage (Features)** | $0.05 | TimescaleDB storage |
| **Blob Storage (Audio, if retained)** | $0.20 | S3, user rarely retains audio |
| **Modulate API Calls** | $0.50 | ~20 sessions/month, $0.025/session |
| **LLM API (Insight Generation)** | $0.30 | GPT-4-turbo, ~20 calls/month |
| **Transcription (if opted in)** | $0.10 | Deepgram, ~5 hours/month |
| **Compute (ML Inference)** | $0.15 | TensorFlow Serving |
| **API Gateway + Bandwidth** | $0.10 | |
| **Monitoring & Logs** | $0.05 | Datadog |
| **TOTAL** | **~$1.45/user/month** | |

**Revenue Requirement:**
- If subscription is $20/month, ~$1.50 COGS leaves $18.50 for ops, support, R&D
- At 10,000 users: $145K/month cloud costs, $200K/month revenue → sustainable

**Scaling Strategy:**
- Edge processing (device-side) reduces cloud compute costs
- Batch processing for non-urgent analysis (spot instances, cheaper)
- Caching frequent queries (Redis)
- Multi-tenancy for therapist portal (shared infrastructure)

---

## Open Architecture Questions

1. **Should transcription be on by default?**
   - Pro: Better topic analysis, more coaching signals
   - Con: Privacy risk, higher cost, slower processing
   - **V1 Decision:** Opt-in only, disabled by default

2. **How much model interpretability is required?**
   - Users/therapists may ask "Why did you say that?"
   - Need to log: which features triggered which coaching, confidence scores

3. **Offline mode robustness?**
   - Device must function for days without phone sync
   - How much on-device storage for unsync'd sessions?

4. **Real-time vs. batch analysis tradeoff?**
   - Real-time: expensive, low latency
   - Batch: cheaper, insights delayed by hours
   - **V1 Decision:** Haptics real-time on-device, deeper insights batch-processed

5. **Multi-language support timeline?**
   - V1: English only
   - V2: Spanish (large US population, autism underserved in Spanish)
   - V3+: Additional languages based on demand

---

## Software Roadmap

### V1 (Months 0-6)
- Device firmware: VAD, diarization, feature extraction, haptics
- Mobile app: post-conversation review, trends, privacy controls
- Cloud: data ingestion, Modulate integration, basic coaching engine
- **Deliverable:** Working prototype with 20-50 beta users

### V1.5 (Months 6-12)
- Personalization engine (baseline learning, adaptive thresholds)
- Therapist portal MVP
- Transcription opt-in feature
- A/B testing framework for models
- **Deliverable:** Production-ready for 1,000+ users

### V2 (Months 12-24)
- Advanced autism models (theory of mind, literal interpretation)
- On-device ML acceleration (faster haptics, lower cloud costs)
- Practice drills and roleplay simulations
- Multi-language support (Spanish)
- **Deliverable:** Scale to 10,000+ users, institutional partnerships

### V3+ (24+ months)
- Real-time therapist view (with consent)
- Video integration for nonverbal cue detection (opt-in)
- Generalization to other populations (speech therapy, leadership coaching)
- Clinical validation studies for FDA approval (separate track)

---

## Conclusion

Tizzy's software architecture is designed to be privacy-first, modular, and scalable. The three-layer design ensures that core value (autism coaching) is not dependent on any single vendor, while the personalization engine and proprietary models create a defensible moat. The architecture supports the V1 goal of proving value with 20-50 users, while being robust enough to scale to 100,000+ users without fundamental redesign.

**Critical Success Factors:**
1. On-device processing quality (haptics must be accurate, not annoying)
2. Cloud cost control (cannot spend $10/user/month and charge $20)
3. Model accuracy and helpfulness (measured by user feedback, not just technical metrics)
4. Privacy and trust (architecture must support auditable, user-controlled data flows)

**Next Steps:**
1. Prototype firmware on Nordic dev kit (VAD + feature extraction)
2. Build mobile app MVP (React Native, BLE sync, timeline view)
3. Set up cloud backend (AWS, PostgreSQL, TensorFlow Serving)
4. Modulate partnership contract negotiation (inference-only, data boundaries)
5. Pilot study with 20 adult autistic users (college transition cohort)
