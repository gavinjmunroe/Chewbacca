# Tizzy System Architecture Overview

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Audience:** Technical team, investors, strategic partners

---

## Executive Summary

Tizzy is an always-wearable conversation coach that transforms continuous audio capture into personalized conversational skill development for autistic individuals. The system architecture is designed around three core principles:

1. **Privacy-First:** On-device processing minimizes cloud data transmission; user controls are features, not afterthoughts
2. **Autism-Specific Intelligence:** Proprietary models trained on autism communication patterns create the defensible moat
3. **Scalable Personalization:** System learns individual baselines and adapts coaching to user goals over time

This document provides a comprehensive system overview for technical stakeholders, covering architecture, data flow, technology choices, and strategic trade-offs.

---

## System Context and Market Position

### Problem Space

Autistic individuals often experience social communication challenges that are invisible to them in the moment. Traditional interventions (therapy, social skills training) suffer from three critical gaps:

1. **Clinic vs. Real-World Gap:** Skills practiced in therapy don't always generalize to actual social situations
2. **Invisible Feedback Loop:** Autistic individuals may miss social cues indicating confusion, annoyance, or engagement shifts
3. **Post-Hoc Reporting Bias:** Self-reporting or parent-reporting of social interactions is unreliable and incomplete

Tizzy bridges these gaps by providing in-the-moment awareness (haptics) and post-conversation insight (coaching) based on real-world audio capture.

### Competitive Landscape

| Product | Form Factor | Audio Capture | Coaching | Target Market |
|---------|-------------|---------------|----------|---------------|
| **Friend Pendant** | Necklace | Always-on | AI companion chat | General consumer (failed trust) |
| **Limitless Pendant** | Necklace | Always-on with LED | Transcription/summary | Business professionals |
| **Humane AI Pin** | Clip-on | Push-to-talk | General AI assistant | Early adopters (failed value prop) |
| **Therapeutic Apps** | Phone app | Manual recording | Generic social skills | Autism population (low engagement) |
| **Tizzy** | Necklace (V1) | Always-on, privacy-first | Autism-specific conversational coaching | Autism population |

**Tizzy's Differentiation:**
- Only product combining always-on audio with autism-specific coaching models
- Real-time haptic feedback (not just post-hoc analysis)
- Transparency and user control as core features (anti-creepiness)
- Explicit consent mechanisms for bystander protection

---

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                         TIZZY ECOSYSTEM                                │
└───────────────────────────────────────────────────────────────────────┘

                  ┌─────────────────────┐
                  │   USER & CONTEXT    │
                  │                     │
                  │  • Autistic User    │
                  │  • Conversation     │
                  │  • Environment      │
                  └──────────┬──────────┘
                             │
                             │ Audio Capture
                             ▼
           ┌─────────────────────────────────────┐
           │     EDGE LAYER (Wearable Device)    │
           │  ┌──────────────────────────────┐  │
           │  │ Audio Capture Manager        │  │
           │  │  • Dual-mic array            │  │
           │  │  • Circular buffer (30-120m) │  │
           │  │  • Hard mute control         │  │
           │  └──────────────┬───────────────┘  │
           │                 │                   │
           │  ┌──────────────▼───────────────┐  │
           │  │ Real-Time Processing         │  │
           │  │  • VAD (voice activity)      │  │
           │  │  • Speaker diarization       │  │
           │  │  • Acoustic features         │  │
           │  │  • On-device ML models       │  │
           │  └──────────────┬───────────────┘  │
           │                 │                   │
           │  ┌──────────────▼───────────────┐  │
           │  │ Haptic Feedback System       │  │
           │  │  • 3 patterns (V1)           │  │
           │  │  • <50ms latency             │  │
           │  └──────────────────────────────┘  │
           └─────────────┬───────────────────────┘
                         │
                         │ BLE Sync (Features + Metadata)
                         ▼
           ┌─────────────────────────────────────┐
           │   CLIENT LAYER (Mobile App)         │
           │  ┌──────────────────────────────┐  │
           │  │ Conversation Review UI       │  │
           │  │  • Timeline visualization    │  │
           │  │  • Annotated moments         │  │
           │  │  • Clip playback (opt-in)    │  │
           │  └──────────────┬───────────────┘  │
           │                 │                   │
           │  ┌──────────────▼───────────────┐  │
           │  │ Progress Dashboard           │  │
           │  │  • Weekly trends             │  │
           │  │  • Goal tracking             │  │
           │  │  • Skill area scores         │  │
           │  └──────────────┬───────────────┘  │
           │                 │                   │
           │  ┌──────────────▼───────────────┐  │
           │  │ Privacy Control Center       │  │
           │  │  • Consent management        │  │
           │  │  • Data audit log            │  │
           │  │  • Deletion controls         │  │
           │  └──────────────────────────────┘  │
           └─────────────┬───────────────────────┘
                         │
                         │ HTTPS API (Features + User Actions)
                         ▼
           ┌─────────────────────────────────────────┐
           │   SERVICE LAYER (Cloud Backend)         │
           │                                          │
           │  ┌────────────────────────────────────┐ │
           │  │ API Gateway & Authentication       │ │
           │  │  • JWT tokens                      │ │
           │  │  • Rate limiting                   │ │
           │  └───────────────┬────────────────────┘ │
           │                  │                       │
           │  ┌───────────────▼──────────────────┐   │
           │  │ Data Ingestion Service           │   │
           │  │  • Validation                    │   │
           │  │  • Time-series storage           │   │
           │  │  • Async processing queue        │   │
           │  └───────────────┬──────────────────┘   │
           │                  │                       │
           │  ┌───────────────▼──────────────────┐   │
           │  │ Understanding Service            │   │
           │  │  ┌───────────────────────────┐  │   │
           │  │  │ Modulate ELM (licensed)   │  │   │
           │  │  │  • Voice tone/intent      │  │   │
           │  │  └───────────────────────────┘  │   │
           │  │  ┌───────────────────────────┐  │   │
           │  │  │ Tizzy Autism Models       │  │   │
           │  │  │  • Confusion detection    │  │   │
           │  │  │  • Repair detection       │  │   │
           │  │  │  • Topic maintenance      │  │   │
           │  │  │  • ToM markers (V2)       │  │   │
           │  │  └───────────────────────────┘  │   │
           │  └───────────────┬──────────────────┘   │
           │                  │                       │
           │  ┌───────────────▼──────────────────┐   │
           │  │ Coaching Engine                  │   │
           │  │  • Personalization (baseline)    │   │
           │  │  • Insight generation (LLM)      │   │
           │  │  • Micro-goal creation           │   │
           │  │  • Progress tracking             │   │
           │  └───────────────┬──────────────────┘   │
           │                  │                       │
           │  ┌───────────────▼──────────────────┐   │
           │  │ Therapist Portal API             │   │
           │  │  • Cohort analytics              │   │
           │  │  • Goal management               │   │
           │  │  • Clinical notes                │   │
           │  └──────────────────────────────────┘   │
           └──────────────────────────────────────────┘
                         │
                         │ Access (with consent)
                         ▼
           ┌─────────────────────────────────────┐
           │   THERAPIST LAYER                   │
           │  • Speech-Language Pathologists     │
           │  • Autism specialists               │
           │  • View progress, set goals         │
           └─────────────────────────────────────┘
```

---

## Core System Components

### 1. Edge Layer: Wearable Device

**Hardware Platform:**
- Custom necklace pendant (30-40mm diameter)
- Dual MEMS microphone array
- ARM Cortex-M7 MCU + DSP
- 500-600mAh battery (24-48hr life)
- Linear Resonant Actuator for haptics
- BLE 5.0 radio

**Firmware Responsibilities:**
- Continuous 16kHz audio capture
- Voice activity detection (VAD)
- Speaker diarization (wearer vs. others)
- Acoustic feature extraction (prosody, timing, voice quality)
- Lightweight ML inference (pacing, reciprocity, escalation detectors)
- Haptic pattern generation
- Secure local storage with AES-256 encryption

**Design Philosophy:**
- **Privacy-First Processing:** Raw audio processed into features on-device; only features transmitted to cloud
- **Circular Buffer:** Raw audio overwritten every 30-120 minutes unless user marks for retention
- **Hard Mute:** Physical microphone cutoff, not software-only
- **Low Latency:** <500ms from audio event to haptic feedback

**Technology Stack:**
- **RTOS:** FreeRTOS or Zephyr
- **Audio DSP:** ARM CMSIS-DSP library
- **ML Framework:** TensorFlow Lite Micro
- **Connectivity:** Nordic nRF52840 or similar BLE SoC
- **Storage:** 4-8GB eMMC flash

### 2. Client Layer: Mobile Application

**Platform Support:**
- iOS 15+ and Android 10+ (cross-platform framework)

**Core Features:**

**2.1 Post-Conversation Review**
- Visual timeline of conversation with annotated moments
- "What went well" and "What to improve" insights
- Micro-goal for tomorrow
- Optional audio clip playback (requires explicit opt-in per session)

**2.2 Progress Dashboard**
- Weekly/monthly trends for conversational metrics
- Goal tracking and milestones
- Skill area scores (reciprocity, pacing, repair, etc.)
- Comparison to personal baseline (not population norms)

**2.3 Privacy Control Center**
- Toggle audio retention on/off (default: off)
- Set quiet hours (auto-disable capture)
- View audit log (who accessed what data, when)
- One-tap "Delete all my data" with confirmation

**2.4 Therapist Collaboration**
- Share weekly summaries with SLP/therapist (opt-in)
- Export PDF reports for clinical records
- View therapist notes and goal recommendations

**Technology Stack:**
- **Framework:** React Native or Flutter (TBD based on team expertise)
- **State Management:** Redux (React Native) or Provider (Flutter)
- **Local Storage:** SQLite with SQLCipher encryption
- **BLE Communication:** react-native-ble-plx or flutter_blue_plus
- **Visualization:** Recharts or FL Chart
- **Authentication:** Auth0 or Firebase Auth

### 3. Service Layer: Cloud Backend

**Infrastructure:**
- AWS or Google Cloud Platform (multi-region: US-East, US-West)
- Kubernetes for service orchestration
- PostgreSQL (primary database) + TimescaleDB (time-series features)
- Redis for caching and session management
- S3/GCS for encrypted audio blob storage (if retained)

**Microservices Architecture:**

**3.1 API Gateway**
- Kong or AWS API Gateway
- JWT authentication and authorization
- Rate limiting (100 req/min per user)
- Request validation

**3.2 Data Ingestion Service**
- Receives feature data from mobile app via REST API
- Schema validation (JSON Schema)
- Writes to TimescaleDB (time-series features)
- Enqueues sessions for deeper analysis (Kafka or AWS SQS)

**3.3 Understanding Service**
- **Modulate ELM Integration:** Licensed API for voice tone/intent/emotion analysis
- **Transcription:** OpenAI Whisper (self-hosted) or Deepgram API (opt-in only)
- **Tizzy Proprietary Models:**
  - Confusion moment detector
  - Repair detection model
  - Topic maintenance classifier
  - Theory of mind marker detector (V2)
- **Deployment:** TensorFlow Serving or PyTorch Serve
- **A/B Testing:** Ability to test new models with beta cohorts

**3.4 Coaching Engine**
- **Personalization Service:**
  - Establishes user baseline over first 7 days
  - Tracks goal progress
  - Adjusts coaching thresholds based on user feedback
- **Insight Generation:**
  - LLM-powered (GPT-4-turbo or Claude 3.5 Sonnet)
  - Generates natural language "what went well," "what to improve," "micro-goal"
  - Tone: supportive, clarity-focused, anti-conformity
- **Recommendation Engine:**
  - Suggests practice drills based on detected weaknesses
  - Links to educational content

**3.5 Therapist Portal API**
- Cohort-level analytics for clinics
- Individual client progress views (with consent)
- Goal setting and adjustment interface
- Clinical notes system (encrypted, audit-logged)

**3.6 Admin & Monitoring**
- Audit logging (immutable, append-only)
- Model performance dashboards (accuracy, user feedback scores)
- Security monitoring and alerting (Datadog or ELK stack)

**Technology Stack:**
- **API Services:** Node.js + Express or Python + FastAPI
- **ML Inference:** TensorFlow Serving, PyTorch Serve
- **Message Queue:** Kafka or AWS SQS
- **Monitoring:** Datadog, Prometheus, Grafana
- **Secrets Management:** AWS Secrets Manager or HashiCorp Vault

---

## Data Flow: End-to-End Example

### Scenario: 15-Minute School Cafeteria Conversation

**Phase 1: Real-Time Capture and Haptics (Device)**

1. **Audio Capture Starts (T+0:00)**
   - Dual microphones capture audio at 16kHz
   - VAD detects speech starts and stops
   - Circular buffer retains last 30 minutes of raw audio

2. **Speaker Diarization (Continuous)**
   - Device compares voice to wearer's enrolled voiceprint
   - Labels each turn as `WEARER`, `OTHER_SPEAKER`, or `UNCERTAIN`

3. **Feature Extraction (Per Turn)**
   - Prosody: pitch (mean, variance, range), speech rate, intensity
   - Timing: turn duration, inter-turn gaps, overlaps
   - Voice quality: jitter, shimmer, harmonic-to-noise ratio

4. **On-Device ML Inference (T+8:00)**
   - Reciprocity detector: "Wearer has spoken 5 turns in a row without listener response"
   - Classification: `ONE_SIDED_WEARER` with 0.84 confidence
   - **Action:** Trigger `DOUBLE_PULSE` haptic (200ms-100ms-200ms, 1.2G)
   - User feels vibration, interprets as "ask a question"

5. **User Button Press (T+12:00)**
   - User taps device button: "that was confusing"
   - System marks 10-second window around timestamp
   - If audio retention enabled, snippet saved to flash storage

6. **Conversation Ends (T+15:30)**
   - Session metadata created: duration, environment type, turn counts
   - Features, haptic events, and user marker stored locally
   - Raw audio in circular buffer (will overwrite unless marked)

**Phase 2: Sync and Cloud Analysis (App + Backend)**

7. **User Opens App (T+15:35)**
   - App connects to device via BLE
   - Device transfers: session metadata, 30 turn feature objects, 1 haptic event, 1 user marker
   - Transfer size: ~15KB compressed JSON
   - App caches locally and syncs to cloud

8. **Cloud Data Ingestion (T+15:36)**
   - API Gateway validates JWT token, rate limit
   - Data Ingestion Service validates schema, writes to TimescaleDB
   - Enqueues session for async analysis

9. **Understanding Service Analysis (T+15:37 - T+15:40)**
   - **Modulate ELM:** Analyzes acoustic features, adds emotion labels (`NEUTRAL`, `FRUSTRATED`) and intent (`STATEMENT`, `QUESTION`)
   - **Tizzy Confusion Detector:**
     - Detects long pause (3.2 sec) after wearer turn at T+12:00
     - Detects prosody mismatch (flat tone for emotional topic)
     - Classification: `LIKELY_CONFUSION` with 0.78 confidence
   - **Tizzy Repair Detector:**
     - No clarification attempt detected after confusion moment
     - Classification: `MISSED_REPAIR_OPPORTUNITY` with 0.81 confidence
   - **Topic Maintenance Classifier:**
     - Semantic analysis (if transcript enabled) shows abrupt topic shift at T+10:00
     - Classification: `ABRUPT_SHIFT` with 0.69 confidence

10. **Coaching Engine Generates Insights (T+15:40 - T+15:42)**
    - **Personalization Service:**
      - Compares session to user's 30-day baseline
      - Turn duration 20% longer than user's typical
      - Reciprocity score 0.68 (below user's 0.75 baseline)
    - **LLM Insight Generation (GPT-4-turbo):**
      - Input: Structured JSON with features, detected moments, user goals
      - Output:
        - "What went well": "You stayed engaged for 15 minutes—that's great focus!"
        - "To improve": "When your friend paused for 3 seconds after your explanation, they might have been confused. Try asking: 'Does that make sense?'"
        - "Micro-goal": "Tomorrow, after explaining something, pause and check: 'Should I explain differently?' or 'What do you think?'"
    - **Database Write:** CoachingSummary object saved, linked to session

**Phase 3: User Review and Feedback (App)**

11. **User Views Insights (T+15:45)**
    - App displays timeline with color-coded moments:
      - Green: Balanced turn-taking at T+5:00
      - Yellow: Long monologue at T+8:00 (where haptic triggered)
      - Red: Confusion detected at T+12:00 (user marker)
    - User taps on T+12:00 moment, sees detailed analysis:
      - "Your friend paused for 3 seconds and their tone changed. This often means confusion."
      - Coaching: "Next time, pause and ask if they're following."

12. **User Provides Feedback (T+15:50)**
    - User rates insight as "HELPFUL"
    - Feedback logged to database for model improvement
    - Personalization service updates: increase confidence in confusion detector for this user

**Phase 4: Therapist Collaboration (Optional)**

13. **Weekly Therapist Review (T+7 days)**
    - User has granted therapist access (consent logged in database)
    - Therapist logs into portal, views 7-day summary:
      - 23 total conversations, 6.8 hours
      - Reciprocity score improving (0.58 → 0.72)
      - Notable pattern: Performance drops in noisy environments
    - Therapist adds note: "Great progress on asking questions. Let's work on noticing confusion cues."
    - Therapist adjusts goal priority: Move "repair and clarification" to priority 1

14. **Next Day Coaching Adapts (T+8 days)**
    - App emphasizes repair opportunities in coaching
    - Haptic sensitivity for confusion moments increased slightly

---

## Technology Stack Summary

| Layer | Component | Technology | Rationale |
|-------|-----------|------------|-----------|
| **Edge** | Firmware | FreeRTOS / Zephyr | Lightweight, real-time, mature ecosystem |
| **Edge** | Audio DSP | ARM CMSIS-DSP | Optimized for ARM Cortex-M, proven |
| **Edge** | On-Device ML | TensorFlow Lite Micro | Industry standard, model zoo |
| **Edge** | Connectivity | Nordic nRF52840 BLE | Low power, robust, widely used |
| **Client** | Mobile Framework | React Native / Flutter | Cross-platform, fast iteration |
| **Client** | Local DB | SQLite + SQLCipher | Encrypted, embedded, no server |
| **Client** | State Management | Redux / Provider | Predictable state, debugging tools |
| **Backend** | API Framework | Node.js + Express / Python + FastAPI | High throughput, async-friendly |
| **Backend** | Primary DB | PostgreSQL | ACID compliance, mature, extensible |
| **Backend** | Time-Series DB | TimescaleDB | Optimized for feature data queries |
| **Backend** | Cache | Redis | Fast, persistent, pub/sub support |
| **Backend** | Blob Storage | AWS S3 / GCS | Scalable, encrypted, presigned URLs |
| **Backend** | ML Inference | TensorFlow Serving | High throughput, versioning, A/B test |
| **Backend** | Message Queue | Kafka / AWS SQS | Async processing, fault-tolerant |
| **Backend** | Authentication | Auth0 / Firebase Auth | OAuth, MFA, user management |
| **Backend** | Monitoring | Datadog / Prometheus | Real-time alerts, dashboards |
| **ML** | Voice Understanding | Modulate ELM (licensed) | Voice-first, cost-effective |
| **ML** | Transcription | Whisper (self-hosted) / Deepgram | Privacy control, high accuracy |
| **ML** | Insight Generation | GPT-4-turbo / Claude 3.5 Sonnet | Natural language quality |

---

## Architectural Principles and Trade-Offs

### 1. Privacy-First vs. Feature-Rich

**Trade-Off:**
- More on-device processing = better privacy, but limited by edge compute power
- More cloud processing = richer insights, but higher data transmission and privacy risk

**Tizzy's Decision:**
- Real-time haptics: on-device (latency + privacy)
- Deeper analysis (topic, emotion): cloud (complexity)
- Raw audio: never leaves device by default

**Rationale:** User trust is existential. Privacy-first is non-negotiable.

### 2. General-Purpose vs. Autism-Specific

**Trade-Off:**
- General coaching system = larger addressable market, easier to build
- Autism-specific system = smaller initial market, requires specialized dataset

**Tizzy's Decision:** Autism-first wedge

**Rationale:**
- Autism population underserved by existing tools
- Specific coaching taxonomy (reciprocity, repair, prosody) is learnable and measurable
- Dataset moat: autism conversational data is scarce and valuable
- Long-term: expand to speech therapy, leadership coaching, etc. (proven models transfer)

### 3. Real-Time Haptics vs. Post-Hoc Coaching Only

**Trade-Off:**
- Haptics add hardware complexity (actuator, latency requirements, power)
- Haptics can be annoying if inaccurate (harm risk)
- Haptics provide in-moment awareness (unique value)

**Tizzy's Decision:** Include haptics in V1, but limit to 3 patterns

**Rationale:**
- Real-time feedback is differentiated value (competitors only do post-hoc)
- Limit patterns to avoid cognitive overload
- User can disable if unhelpful (personalization)

### 4. Modulate Partnership vs. Build In-House

**Trade-Off:**
- Licensing Modulate ELM = faster time to market, proven voice understanding
- Building in-house = full control, no vendor lock-in, but slower and costlier

**Tizzy's Decision:** License Modulate for V1, structure contract to avoid lock-in

**Rationale:**
- Time to market critical (competitive landscape heating up)
- Modulate optimized for voice-first understanding (better than general LLMs for prosody)
- Contract boundaries protect Tizzy's autism dataset (no training rights to Modulate)
- System architecture allows swapping Modulate later if needed

### 5. Mobile-First vs. Web-First

**Trade-Off:**
- Mobile app = better device sync (BLE), push notifications, offline support
- Web app = easier development, cross-platform (desktop), no app store approval

**Tizzy's Decision:** Mobile-first (iOS and Android native)

**Rationale:**
- BLE sync requires native mobile app (web Bluetooth limited)
- Push notifications critical for daily engagement loop
- Therapist portal can be web-based (different use case)

### 6. Self-Hosted ML vs. Managed ML Services

**Trade-Off:**
- Self-hosted (TensorFlow Serving) = control, cost optimization at scale, privacy
- Managed (SageMaker, Vertex AI) = easier ops, faster iteration, higher cost

**Tizzy's Decision:** Self-hosted for V1, managed for experimentation

**Rationale:**
- Control over model versioning and rollback (safety-critical)
- Cost per inference matters at scale (goal: 10K+ users)
- Can use managed services for R&D and A/B testing

---

## Scalability and Performance

### Performance Targets

| Metric | V1 Target | V2 Target |
|--------|-----------|-----------|
| **Real-Time Haptic Latency** | <500ms | <300ms |
| **Device Battery Life** | 24hr min | 48hr |
| **BLE Sync Time (per session)** | <30 sec | <15 sec |
| **Cloud Analysis Latency** | <5 min | <2 min |
| **App Load Time** | <2 sec | <1 sec |
| **Insight Generation Time** | <10 sec | <5 sec |
| **Concurrent Users (Cloud)** | 1,000 | 100,000 |
| **Cost per User per Month** | <$2 | <$1 |

### Scalability Strategy

**Edge Scaling:**
- Modular firmware design allows rapid hardware iterations
- Over-the-air (OTA) updates for bug fixes and model improvements
- Hardware production scales with contract manufacturer (10K → 100K units)

**Client Scaling:**
- Cross-platform framework reduces development burden (1 codebase, 2 platforms)
- Local-first architecture: app functions offline, syncs when connected
- CDN for static assets (images, videos, educational content)

**Backend Scaling:**
- Stateless API services: horizontal scaling with load balancer
- Database read replicas for therapist portal queries
- Time-series data partitioned by user and time (efficient queries)
- Async processing for non-urgent analysis (spot instances, cost savings)
- Caching layer (Redis) for frequent queries (user baselines, recent sessions)

**ML Scaling:**
- Model inference batching (process multiple sessions together)
- Tiered model complexity: lightweight models for most users, deep models for edge cases
- A/B testing framework to validate model improvements before rollout

### Cost Optimization

**V1 Cost Breakdown (per user, per month):**
- Cloud storage (features): $0.05
- Blob storage (audio, rarely retained): $0.20
- Modulate API: $0.50 (20 sessions × $0.025)
- LLM API (insights): $0.30 (GPT-4-turbo, 20 calls)
- Transcription (opt-in): $0.10
- ML inference: $0.15
- API gateway & bandwidth: $0.10
- Monitoring: $0.05
- **Total: ~$1.45/user/month**

**Revenue Sustainability:**
- Subscription: $20/month → $18.55 margin after COGS
- At 10,000 users: $200K monthly revenue, $185K contribution margin
- Enough to cover R&D, support, and scale infrastructure

---

## Security Architecture

### Threat Model

**High-Priority Threats:**
1. Unauthorized access to user conversations (most critical)
2. Bystander voice exfiltration without consent
3. Device theft leading to audio exposure
4. Man-in-the-middle (MITM) attacks on BLE or API
5. Cloud data breach (database or blob storage)
6. Insider threat (employee accessing user data)

### Security Controls

**1. Encryption Everywhere**
- **Data at Rest:**
  - Device: AES-256 encryption, key derived from device hardware ID + user PIN
  - Cloud: AES-256 via AWS KMS or GCP Cloud KMS
- **Data in Transit:**
  - BLE: Encrypted pairing with PIN or biometric
  - API: TLS 1.3 with certificate pinning

**2. Minimal Data Retention**
- Raw audio: circular buffer, overwritten by default
- Features: 90 days, then aggregated to monthly summaries
- Audit logs: 7 years (compliance requirement)

**3. Access Controls**
- **User Data Isolation:** Row-level security in PostgreSQL (user can only query their own data)
- **Therapist Access:** Requires explicit user consent, logged in audit trail, time-limited (6 months default)
- **Admin Access:** Requires MFA, logs all actions, no access to raw audio without legal requirement

**4. Bystander Protection**
- Speaker diarization separates wearer from others
- Default mode: only wearer's features retained
- If bystander voice needed for coaching, requires explicit consent or anonymization

**5. Device Security**
- Secure boot prevents firmware tampering
- Device tied to single user account (factory reset required to transfer)
- Remote wipe capability via app (lost device)

**6. API Security**
- JWT tokens with short expiration (1 hour)
- Refresh tokens stored securely (encrypted, HTTP-only cookies)
- Rate limiting per user and per IP
- Input validation on all endpoints (JSON Schema)

**7. Monitoring and Incident Response**
- Real-time alerts for anomalous access patterns (Datadog)
- Quarterly security audits
- Bug bounty program for responsible disclosure
- Incident response plan (data breach notification within 72 hours)

---

## Compliance and Governance

### Regulatory Landscape

**COPPA (Children's Online Privacy Protection Act):**
- Applies if users under 13 and data collected via "online service"
- FTC guidance: voice recordings require verifiable parental consent
- **Tizzy Approach:** No users under 13 in V1 (college/adult wedge); V2 requires parental consent flow

**State Recording Laws:**
- 12 states require all-party consent for recording conversations
- **Tizzy Approach:** Design for strictest standard (all-party consent or audible indicator)

**FERPA (Family Educational Rights and Privacy Act):**
- Applies if Tizzy used in schools
- Requires written agreements with schools, direct control by schools over data
- **Tizzy Approach:** V1 excludes schools; V3+ has separate compliance track for education

**HIPAA:**
- Not applicable in V1 (Tizzy is not a covered entity, not providing healthcare)
- If future clinical decision support, must architect for HIPAA compliance

**FTC Health Breach Notification Rule:**
- Applies to consumer health apps storing sensitive health data
- Requires breach notification even if not HIPAA-covered
- **Tizzy Approach:** Incident response plan includes breach notification to users + FTC

**GDPR (if expanding to Europe):**
- Stricter consent requirements (opt-in, not opt-out)
- Right to erasure, data portability, automated decision-making transparency
- **Tizzy Approach:** Architecture supports GDPR (user-controlled deletion, audit logs, explainable ML)

### Governance Framework

**Data Governance Committee:**
- Cross-functional: engineering, legal, clinical advisor, user advocate
- Quarterly review of data policies, model accuracy, user complaints
- Approve changes to data retention, consent flows, model deployment

**Clinical Advisory Board:**
- Speech-language pathologists, autism researchers, autistic self-advocates
- Review coaching taxonomy, ensure anti-ableist framing
- Approve new coaching features before release

**User Privacy Council (Future):**
- Select users + parents as representatives
- Input on privacy features, consent mechanisms
- Transparency reports published quarterly

---

## Open Architecture Questions

### 1. Should we support multi-device per user?

**Use Case:** User has necklace + earring, or wants to use phone as backup device

**Complexity:** Device sync, merging audio streams, cost

**V1 Decision:** Single device per user; revisit in V2

### 2. How should we handle multi-language support?

**Challenge:** ML models trained on English; prosody differs across languages

**Options:**
- Language detection + route to language-specific models
- Focus on English + Spanish (largest US need)
- Universal prosody features (language-agnostic)

**V1 Decision:** English only; Spanish in V2

### 3. Should on-device ML models be user-specific?

**Benefit:** Highly personalized, more accurate

**Challenge:** Model training on-device (power, compute), model update complexity

**V1 Decision:** Shared models with personalized thresholds; explore federated learning in V3

### 4. What is the right balance of automation vs. user control?

**Example:** Should system auto-enable audio retention for "important" moments?

**Tension:** Convenience vs. privacy

**V1 Decision:** User control > convenience (explicit opt-in for all audio retention)

### 5. How do we handle model uncertainty in coaching?

**Problem:** Low-confidence predictions can lead to false or unhelpful coaching

**Options:**
- Hide low-confidence insights (miss potential learning)
- Show with confidence score ("We're 65% sure...")
- Ask user to clarify post-conversation (active learning)

**V1 Decision:** Show medium confidence (>0.5) with caveats; ask for feedback

---

## Evolution Roadmap

### V1 (Months 0-6): Prove Core Value

**Goal:** Demonstrate that always-wearable audio + autism-specific coaching improves conversational outcomes

**Deliverables:**
- Necklace hardware (500-2,000 units for beta)
- Mobile app with post-conversation review and trends
- Cloud backend with Modulate integration and basic coaching engine
- 20-50 adult autistic users (college transition cohort)

**Success Metrics:**
- 30-day user retention >70%
- Measurable improvement in 1-2 target skills (e.g., reciprocity, repair)
- User feedback: "helpful" rating >60%

### V1.5 (Months 6-12): Scale and Harden

**Goal:** Production-ready system for 1,000+ users

**Deliverables:**
- Improved battery life (24hr → 48hr)
- Therapist portal MVP
- Personalization engine (baseline learning, adaptive thresholds)
- A/B testing framework for models
- Cost optimization (cloud spend <$1.50/user/month)

**Success Metrics:**
- 1,000 active users
- 90-day retention >50%
- NPS (Net Promoter Score) >40
- Therapist adoption: 10+ SLPs using portal

### V2 (Months 12-24): Expand Capabilities

**Goal:** Best-in-class conversational coaching for autism

**Deliverables:**
- Advanced autism models (theory of mind, literal interpretation)
- Multi-language support (Spanish)
- Practice drills and roleplay simulations
- Alternative form factors (earring prototype)
- Clinical validation study (measure outcomes vs. control group)

**Success Metrics:**
- 10,000 active users
- Peer-reviewed publication (efficacy study)
- Institutional partnerships (5+ clinics/programs)

### V3+ (Months 24+): Generalize and Scale

**Goal:** Expand beyond autism to broader conversational coaching market

**Deliverables:**
- Generalized coaching models (leadership, interviewing, public speaking)
- Video integration (nonverbal cue detection, opt-in)
- Real-time therapist view (with consent)
- FDA approval track for clinical claims (parallel effort)
- Enterprise sales (corporate training, schools)

**Success Metrics:**
- 100,000 active users (10% non-autism)
- Profitability (revenue > costs)
- Category leader in conversational AI coaching

---

## Conclusion

Tizzy's system architecture is designed to be privacy-first, autism-specific, and scalable. The three-layer design (edge, client, service) ensures that:

1. **User trust is earned through transparency:** Privacy controls are features, not legal fine print
2. **Core value is defensible:** Proprietary autism models + dataset create moat, not dependency on vendors
3. **System can scale:** From 100 beta users to 100,000 customers without fundamental redesign

The architecture balances pragmatism (leverage Modulate, LLMs) with strategic control (own autism coaching logic, personalization, hardware). V1 is deliberately scoped to prove value with a small cohort, while the foundation supports the long-term vision of becoming the default platform for conversational growth.

**Critical Success Factors:**
- On-device ML must be accurate and low-power (haptics that help, not annoy)
- Cloud cost must stay below $2/user/month (unit economics)
- User feedback loop must be tight (coaching improves based on what users find helpful)
- Privacy posture must be bulletproof (one breach kills the company)

**Next Steps:**
1. Finalize technology stack decisions (React Native vs. Flutter, AWS vs. GCP)
2. Build prototype firmware on Nordic dev kit
3. Design API specifications for all service interfaces
4. Negotiate Modulate partnership contract
5. Recruit beta cohort (20-50 college students with autism)
