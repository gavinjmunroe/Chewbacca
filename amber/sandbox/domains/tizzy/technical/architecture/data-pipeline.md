# Data Pipeline: From Capture to Coaching

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Audience:** ML Engineers, Backend Developers, Data Engineers

---

## Overview

This document describes Tizzy's complete data pipeline, from raw audio capture on the wearable device through feature extraction, model inference, coaching generation, and feedback loops. The pipeline is designed to be privacy-first (minimal raw audio transmission), real-time where necessary (haptics), and batch-optimized where possible (deep analysis).

---

## Pipeline Architecture Overview

```
RAW AUDIO → FEATURES → UNDERSTANDING → COACHING → USER → FEEDBACK
   (Device)    (Device)    (Cloud)       (Cloud)    (App)   (Loop)
```

### Key Design Principles

1. **Privacy-First Transformation:** Raw audio converted to features on-device; audio rarely leaves device
2. **Tiered Latency:** Real-time for haptics (<500ms), near-real-time for app sync (<5 min), batch for trends (hourly/daily)
3. **Explainability:** Every coaching action traceable to specific features and model decisions
4. **Feedback Integration:** User ratings improve models over time (active learning)
5. **Graceful Degradation:** Pipeline continues even if cloud services unavailable (offline mode)

---

## Stage 1: Audio Capture (Device)

### 1.1 Continuous Audio Recording

**Hardware:**
- Dual MEMS microphones (16kHz sampling rate, 16-bit depth)
- Circular buffer in RAM (30-120 minute capacity)

**Process:**
```
Microphones → ADC → Circular Buffer (RAM) → [Overwrite after N minutes]
                                         ↓
                                   [If marked: Save to Flash]
```

**Output:**
- Continuous PCM audio stream
- Buffer state: `{available_minutes: 47, oldest_timestamp: T-47min, recording: true}`

**Privacy Control:**
- Hard mute button physically disconnects microphones
- Quiet hours: auto-disable recording during sleep times
- User-initiated delete: immediate buffer wipe

### 1.2 Voice Activity Detection (VAD)

**Algorithm:** WebRTC VAD or Silero VAD (on-device inference)

**Process:**
```
Audio Stream → VAD Model → Speech/Silence Classification
                        ↓
                   Speech Segments (start_time, end_time, confidence)
```

**Parameters:**
- Frame size: 30ms
- Aggressiveness: Medium (balance false positives vs. false negatives)
- Minimum speech duration: 300ms (filter out coughs, background noises)

**Output (per segment):**
```json
{
  "segment_id": "seg_abc123",
  "start_time": 1707838920.123,
  "end_time": 1707838923.456,
  "duration_sec": 3.333,
  "confidence": 0.92
}
```

**Performance:**
- Latency: <50ms
- Power consumption: ~2mA average
- False positive rate: <5%

### 1.3 Speaker Diarization

**Goal:** Distinguish wearer's voice from other speakers

**Method:**

**Phase 1: Wearer Voice Enrollment (Onboarding)**
```
User Reads Script (2-3 min) → Extract Speaker Embedding (x-vector or d-vector)
                                            ↓
                                  Store Embedding on Device (encrypted)
```

**Phase 2: Real-Time Classification**
```
Speech Segment → Extract Embedding → Compare to Wearer Embedding
                                            ↓
                            Cosine Similarity > Threshold?
                                    ↓               ↓
                                 WEARER       OTHER_SPEAKER
```

**Embedding Model:**
- Pre-trained ResNet-based speaker encoder (e.g., SpeechBrain)
- Compressed to <500KB for on-device inference
- Inference time: <100ms per segment

**Output (per segment):**
```json
{
  "segment_id": "seg_abc123",
  "speaker": "WEARER",
  "confidence": 0.89,
  "similarity_score": 0.91
}
```

**Fallback for Low Confidence:**
- If similarity score 0.4-0.6: label as `UNCERTAIN`
- If multiple speakers detected simultaneously: label as `MULTIPLE`

---

## Stage 2: Feature Extraction (Device)

### 2.1 Prosody Feature Extraction

**Purpose:** Capture "how it was said" beyond transcript

**Features Extracted (per turn):**

**Pitch Features:**
- Mean F0 (fundamental frequency): average pitch in Hz
- F0 range: max - min pitch
- F0 variance: standard deviation of pitch
- Pitch contour: categorize as FLAT, RISING, FALLING, RISE_FALL, etc.

**Timing Features:**
- Speech rate: syllables per second (requires syllable counting or approximation via energy peaks)
- Articulation rate: speech rate excluding pauses
- Pause count and duration distribution
- Inter-turn gap: time between this turn and previous turn

**Intensity Features:**
- Mean intensity (volume) in dB
- Intensity variance: standard deviation
- Intensity trend: INCREASING, DECREASING, STABLE

**Voice Quality Features:**
- Jitter: pitch perturbation percentage (vocal strain indicator)
- Shimmer: amplitude perturbation in dB
- Harmonic-to-Noise Ratio (HNR): voice clarity measure

**Algorithm:**
```
Audio Segment → Pre-processing (noise reduction, normalization)
                    ↓
              Pitch Extraction (autocorrelation or RAPT algorithm)
                    ↓
              Energy Extraction (short-time energy)
                    ↓
              Voice Quality Analysis (Praat algorithms, ported to C)
                    ↓
              Feature Vector (30-50 dimensions per turn)
```

**Implementation:**
- **Library:** Custom DSP routines using ARM CMSIS-DSP
- **Latency:** <200ms per turn (parallel with VAD/diarization)
- **Storage:** ~500 bytes per turn (JSON serialized)

**Output (per turn):**
```json
{
  "turn_id": "turn_xyz789",
  "prosody": {
    "mean_pitch_hz": 185.3,
    "pitch_range_hz": 45.7,
    "pitch_variance": 22.1,
    "pitch_contour": "RISING",
    "speech_rate_sps": 4.8,
    "articulation_rate_sps": 5.2,
    "mean_intensity_db": -18.5,
    "intensity_variance_db": 8.2,
    "pause_count": 2,
    "mean_pause_sec": 0.4
  },
  "voice_quality": {
    "jitter_percent": 0.8,
    "shimmer_db": 0.3,
    "hnr_db": 18.5
  }
}
```

### 2.2 Conversational Timing Features

**Purpose:** Capture turn-taking dynamics

**Features:**
- Turn duration (seconds)
- Overlap duration (if speaker started before previous ended)
- Overlap position: START, MIDDLE, END
- Inter-turn gap (negative if overlap, positive if pause)
- Interruption flag (overlap > 500ms)

**Algorithm:**
```
Sequence of Turns → Compute Timing Relationships
                            ↓
        {turn_A_end: T1, turn_B_start: T2} → gap = T2 - T1
                            ↓
                    If gap < 0: overlap = |gap|
```

**Output (per turn):**
```json
{
  "turn_id": "turn_xyz789",
  "timing": {
    "duration_sec": 6.5,
    "inter_turn_gap_sec": -0.8,
    "overlap_duration_sec": 0.8,
    "overlap_position": "START",
    "interrupted_other": true
  }
}
```

### 2.3 Turn-Level Aggregation

**Purpose:** Combine prosody, timing, speaker identity into single turn object

**Data Structure:**
```json
{
  "turn_id": "turn_xyz789",
  "session_id": "sess_abc123",
  "turn_index": 5,
  "timestamp": 1707838923.456,
  "speaker": "WEARER",
  "prosody": { /* ... */ },
  "voice_quality": { /* ... */ },
  "timing": { /* ... */ }
}
```

**Storage:**
- Written to device flash (encrypted)
- Queued for BLE sync to mobile app

---

## Stage 3: On-Device ML Inference (Device)

### 3.1 Real-Time Coaching Models

**Purpose:** Detect patterns that require immediate haptic feedback

**Models Deployed:**

**Model 1: Pacing Detector**
- **Input:** `speech_rate_sps`, `pitch_variance`, `turn_duration_sec`
- **Algorithm:** Threshold-based with personalized baselines
  ```
  If speech_rate > (user_baseline * 1.3):
      classify as "TOO_FAST"
  Else if speech_rate < (user_baseline * 0.7):
      classify as "TOO_SLOW"
  Else:
      classify as "OPTIMAL"
  ```
- **Output:** `{label: "TOO_FAST", confidence: 0.82}`
- **Action:** Trigger `SINGLE_PULSE` haptic

**Model 2: Reciprocity Detector**
- **Input:** `wearer_turn_count_since_last_other`, `time_since_last_other_turn`, `conversation_duration`
- **Algorithm:** Rule-based with ML threshold tuning
  ```
  If wearer_turn_count >= 4 AND time_since_last_other > 60 sec:
      classify as "ONE_SIDED_WEARER"
  ```
- **Output:** `{label: "ONE_SIDED_WEARER", confidence: 0.84}`
- **Action:** Trigger `DOUBLE_PULSE` haptic

**Model 3: Escalation Detector**
- **Input:** `intensity_trend`, `intensity_variance`, `pitch_variance`, `overlap_events`, `hnr_db`
- **Algorithm:** Lightweight neural network (3-layer feedforward)
  - Input layer: 8 features
  - Hidden layer: 16 neurons, ReLU activation
  - Output layer: 3 classes (CALM, ELEVATED, ESCALATING), softmax
- **Training:** Trained on labeled autism dataset (stress/overload moments)
- **Output:** `{label: "ESCALATING", confidence: 0.78, probabilities: [0.05, 0.17, 0.78]}`
- **Action:** Trigger `LONG_PULSE` haptic

**Model Characteristics:**
- **Size:** <100KB per model (quantized, pruned)
- **Inference Time:** <10ms per turn
- **Framework:** TensorFlow Lite Micro (compiled to C)

### 3.2 Haptic Control Logic

**Rate Limiting:**
- Maximum 1 haptic per 30 seconds (avoid overwhelming user)
- Priority queue: ESCALATING > ONE_SIDED > TOO_FAST

**Personalization:**
- Models use user-specific thresholds learned during first 7 days
- Thresholds adjusted based on user feedback ("annoying" → increase threshold)

**Logging:**
```json
{
  "haptic_id": "hap_123",
  "timestamp": 1707838950.0,
  "pattern": "DOUBLE_PULSE",
  "trigger_reason": "ONE_SIDED_WEARER",
  "confidence": 0.84,
  "context": {
    "wearer_turn_count": 5,
    "time_since_last_other": 78
  }
}
```

---

## Stage 4: Data Sync (Device → App)

### 4.1 Bluetooth Low Energy (BLE) Transfer

**Trigger:**
- User opens app (automatic sync)
- Every 4 hours if app in background (iOS limitations noted)
- On-demand via app button

**Data Transmitted:**
```
Session Metadata (1 KB)
  ├─ Turn Features (30 turns × 0.5 KB = 15 KB)
  ├─ Haptic Events (5 events × 0.2 KB = 1 KB)
  └─ User Markers (2 markers × 0.3 KB = 0.6 KB)

Total per session: ~18 KB (compressed to ~8 KB with gzip)
```

**Protocol:**
- BLE GATT service with custom characteristics
- Chunked transfer (512-byte MTU limit)
- Checksum validation (CRC-32)
- Retry logic (up to 3 attempts)

**Sync State Management:**
```
Device maintains: last_synced_session_id
App maintains: last_received_session_id

On sync:
  1. Device queries: sessions newer than last_synced_session_id
  2. Device sends: batch of unsync'd sessions
  3. App acknowledges: update last_received_session_id
  4. Device updates: last_synced_session_id
```

### 4.2 Audio Snippet Transfer (Optional)

**Condition:** User explicitly marked moment or enabled audio retention

**Process:**
```
User Marks Moment → Device saves 10-30 sec snippet to flash
                            ↓
                    App requests snippet via BLE
                            ↓
                    Device encrypts snippet (AES-256)
                            ↓
                    Transfer encrypted blob (chunks)
                            ↓
                    App decrypts and caches locally
```

**Constraints:**
- Maximum 5 snippets per session (prevent abuse)
- Snippet auto-deletes from device after 7 days
- User can delete snippet anytime via app

---

## Stage 5: Cloud Data Ingestion (App → Backend)

### 5.1 API Upload

**Endpoint:** `POST /api/v1/sessions`

**Authentication:** JWT bearer token (user-scoped)

**Request Body:**
```json
{
  "session_id": "sess_abc123",
  "device_id": "dev_xyz789",
  "user_id": "user_123",
  "start_time": "2026-02-13T14:00:00.000Z",
  "end_time": "2026-02-13T14:15:30.500Z",
  "environment": "school_cafeteria",
  "consent_mode": "CONVERSATION",
  "turns": [ /* array of turn objects */ ],
  "haptic_events": [ /* array */ ],
  "user_markers": [ /* array */ ]
}
```

**Validation:**
- JSON Schema validation (structure correctness)
- User ID matches JWT token
- Session ID uniqueness (prevent duplicates)
- Timestamp sanity check (not in future)

**Response:**
```json
{
  "session_id": "sess_abc123",
  "status": "received",
  "next_analysis_eta": "2026-02-13T14:20:00Z"
}
```

### 5.2 Data Storage

**Time-Series Database (TimescaleDB):**
- Store turn-level features (prosody, timing, voice quality)
- Hypertables partitioned by user_id and timestamp
- Retention: 90 days full resolution, then downsampled to daily aggregates

**Relational Database (PostgreSQL):**
- Session metadata (duration, environment, consent_mode)
- User profiles (goals, baselines, preferences)
- Haptic events and user markers
- Coaching summaries

**Blob Storage (S3/GCS):**
- Encrypted audio snippets (if retained)
- Pre-signed URLs for time-limited access (expires in 7 days)

**Message Queue (Kafka/SQS):**
- Enqueue session for async analysis
- Message: `{session_id, user_id, priority: "normal"}`

---

## Stage 6: Understanding Service (Cloud)

### 6.1 Modulate ELM Integration

**Purpose:** Voice-first understanding of tone, emotion, intent

**API Call:**
```
POST https://api.modulate.ai/v1/analyze
Authorization: Bearer <tizzy_api_key>

Request:
{
  "turns": [
    {
      "turn_id": "turn_xyz789",
      "features": { /* acoustic features */ }
    }
  ]
}

Response:
{
  "turns": [
    {
      "turn_id": "turn_xyz789",
      "intent": "QUESTION",
      "emotion": "NEUTRAL",
      "prosody_analysis": {
        "pacing": "fast",
        "intensity": "elevated"
      },
      "confidence": 0.87
    }
  ]
}
```

**Rate Limiting:**
- Batch up to 50 turns per API call (efficiency)
- Retry with exponential backoff on failure

**Cost Tracking:**
- Log API usage per session for cost attribution
- Alert if cost exceeds $0.03 per session (budget threshold)

### 6.2 Transcription (Optional)

**Condition:** User opted into transcript feature

**Service:** OpenAI Whisper (self-hosted) or Deepgram API

**API Call (Whisper):**
```
POST https://tizzy-whisper.internal/v1/transcribe

Request:
{
  "audio_url": "<presigned_s3_url>",
  "language": "en"
}

Response:
{
  "turn_id": "turn_xyz789",
  "text": "So I was thinking we could go to the movies this weekend.",
  "confidence": 0.94,
  "words": [
    {"word": "So", "start": 0.0, "end": 0.2},
    {"word": "I", "start": 0.2, "end": 0.3},
    /* ... */
  ]
}
```

**Privacy Note:**
- Transcripts stored separately from audio (different retention policy)
- Transcripts can be deleted without deleting features
- Therapist access to transcripts requires elevated consent

### 6.3 Tizzy Autism-Specific Models

**Model 1: Confusion Moment Detector**

**Input Features:**
- `inter_turn_gap_sec` (long pause after wearer turn)
- `intensity_variance` (tone change in other speaker)
- `clarification_keywords` (if transcript available: "what?", "huh?", "I don't understand")
- `prosody_mismatch` (flat tone for emotional topic)

**Architecture:**
- Gradient Boosted Trees (XGBoost or LightGBM)
- 200 trees, max depth 6
- Trained on 5,000 labeled autism conversations (therapist + self-report)

**Output:**
```json
{
  "moment_id": "moment_abc",
  "type": "CONFUSION_DETECTED",
  "confidence": 0.78,
  "signals": [
    {"signal": "LONG_PAUSE_AFTER_WEARER", "value": 3.2, "weight": 0.6},
    {"signal": "PROSODY_MISMATCH", "value": true, "weight": 0.4}
  ]
}
```

**Model 2: Repair Detection Model**

**Input Features:**
- Turn sequence (wearer → other → wearer)
- `clarification_keywords` ("I mean", "let me explain", "sorry, what I meant was")
- `prosody_consistency` (did wearer change pacing/tone in clarification?)
- `other_speaker_response` (did confusion resolve? measured by subsequent turn length and prosody)

**Architecture:**
- LSTM sequence model (captures temporal patterns)
- 2 layers, 64 hidden units per layer
- Trained on 3,000 labeled repair attempts (SLP annotations)

**Output:**
```json
{
  "moment_id": "moment_def",
  "type": "REPAIR_ATTEMPTED",
  "success": true,
  "confidence": 0.81
}
```

**Model 3: Topic Maintenance Classifier**

**Input Features:**
- Semantic embeddings (if transcript available): sentence-BERT or similar
- Turn length sequence (abrupt short turns may indicate topic shift)
- Prosody shift (pitch/intensity change often accompanies topic change)

**Architecture:**
- Transformer-based sequence classifier (fine-tuned BERT or RoBERTa)
- Input: last 5 turns (concatenated)
- Output: ON_TOPIC, DRIFT, ABRUPT_SHIFT

**Output:**
```json
{
  "moment_id": "moment_ghi",
  "type": "TOPIC_DRIFT",
  "confidence": 0.69
}
```

### 6.4 Model Orchestration

**Pipeline Execution:**
```
Session Data → [Modulate ELM] → Emotion/Intent Tags
                    ↓
              [Transcription] → Text (if enabled)
                    ↓
         [Tizzy Model Ensemble] → Moments (confusion, repair, topic)
                    ↓
              [Aggregation] → Combined Understanding
                    ↓
              [Database Write] → Store moments + model outputs
```

**Parallelization:**
- Modulate and Transcription run in parallel (independent)
- Tizzy models run sequentially (some depend on Modulate outputs)

**Fault Tolerance:**
- If Modulate fails: fall back to on-device features only
- If transcription fails: run prosody-only models
- If Tizzy model fails: log error, continue with available outputs

---

## Stage 7: Coaching Engine (Cloud)

### 7.1 Personalization Service

**Baseline Establishment (First 7 Days):**

**Algorithm:**
```python
# Collect all turns from user's first 7 days (minimum 20 conversations)
user_turns = query_turns(user_id, days=7)

baseline = {
    "mean_speech_rate": percentile(user_turns.speech_rate, 50),
    "std_speech_rate": std_dev(user_turns.speech_rate),
    "mean_turn_length": percentile(user_turns.duration, 50),
    "mean_reciprocity": mean(wearer_turns / total_turns),
    "mean_pause_duration": percentile(user_turns.pauses, 50)
}

store_baseline(user_id, baseline)
```

**Ongoing Adaptation:**
```python
# Update baseline slowly with EWMA (exponential weighted moving average)
alpha = 0.05  # Low alpha = slow adaptation (avoid overfitting to bad days)

new_baseline = alpha * current_session_stats + (1 - alpha) * existing_baseline
```

**Personalized Thresholds:**
```python
# Haptic triggers use personalized thresholds
threshold_too_fast = baseline.mean_speech_rate + (1.5 * baseline.std_speech_rate)

if current_speech_rate > threshold_too_fast:
    trigger_haptic("TOO_FAST")
```

### 7.2 Insight Generation (LLM-Powered)

**Model:** GPT-4-turbo or Claude 3.5 Sonnet

**Prompt Template:**
```
You are a conversation coach for an autistic user. Your role is to provide supportive,
clarity-focused coaching without enforcing neurotypical conformity.

USER CONTEXT:
- Age: {age_range}
- Goals: {user_goals}
- Baseline: {user_baseline_summary}

SESSION DATA:
- Duration: {duration} minutes
- Environment: {environment}
- Reciprocity score: {reciprocity_score} (user baseline: {baseline_reciprocity})
- Detected moments: {moments_summary}
- Haptic events: {haptic_events_summary}

TASK:
Generate coaching insights in JSON format:
{
  "what_went_well": [
    "Specific positive observation 1 (encouraging, not patronizing)",
    "Specific positive observation 2"
  ],
  "what_to_improve": [
    "Specific improvement area 1 (constructive, actionable)",
    "Specific improvement area 2"
  ],
  "micro_goal": "One specific, measurable goal for tomorrow (action-oriented)"
}

TONE: Supportive, clear, respectful. Never suggest masking or hiding autistic traits.
Focus on clarity and mutual understanding, not neurotypical performance.
```

**API Call:**
```
POST https://api.openai.com/v1/chat/completions

Request:
{
  "model": "gpt-4-turbo",
  "messages": [
    {"role": "system", "content": "<coaching_system_prompt>"},
    {"role": "user", "content": "<session_data_formatted>"}
  ],
  "temperature": 0.7,
  "max_tokens": 500
}

Response:
{
  "choices": [
    {
      "message": {
        "content": "{\"what_went_well\": [...], \"what_to_improve\": [...], \"micro_goal\": \"...\"}"
      }
    }
  ]
}
```

**Post-Processing:**
- Parse JSON from LLM response
- Validate structure (2 items in each array, 1 micro-goal)
- Link insights to supporting moments (auditability)
- Store in `coaching_summary` table

### 7.3 Recommendation Engine

**Practice Drills:**
```python
# Based on detected weakness, suggest relevant drill
if "missed_repair_opportunity" in session_moments:
    recommend_drill({
        "title": "Checking Understanding Practice",
        "description": "Practice pausing after explanations and asking: 'Does that make sense?'",
        "estimated_time_minutes": 5,
        "link_to_video": "https://tizzy.ai/drills/checking-understanding"
    })
```

**Progress Milestones:**
```python
# Celebrate achievements
if user_reciprocity_score > 0.75 for 7 consecutive days:
    award_milestone({
        "title": "7-Day Balanced Conversation Streak!",
        "description": "You've maintained great turn-taking balance for a week.",
        "badge": "reciprocity_champion"
    })
```

---

## Stage 8: User Review and Feedback (App)

### 8.1 Insights Display

**UI Components:**
- **Timeline View:** Visual representation of conversation with color-coded moments
  - Green: Positive moments (good repair, balanced turn-taking)
  - Yellow: Opportunities (missed question, long monologue)
  - Red: Escalation or stress detected
- **Insight Cards:** Expandable cards for "What went well" and "What to improve"
- **Micro-Goal Widget:** Prominent display of tomorrow's focus

### 8.2 User Feedback Collection

**Feedback Mechanisms:**

**1. Insight Helpfulness Rating:**
```
User rates insight: [Helpful] [Neutral] [Not Helpful]
                         ↓
        Store feedback: {insight_id, rating, timestamp}
```

**2. Haptic Feedback:**
```
User reviews haptic events in timeline:
  "Was this buzz helpful?"
    [Yes] [No] [I didn't notice it]
        ↓
Store: {haptic_id, user_rating, timestamp}
```

**3. Moment Annotation:**
```
User taps on timeline moment:
  "Was this actually confusing?"
    [Yes, I was confused] [No, this was fine] [Not sure]
        ↓
Store: {moment_id, user_confirmed, timestamp}
```

### 8.3 Feedback Loop to Models

**Active Learning Pipeline:**
```
User Feedback → Label Correction → Model Retraining Queue
                                            ↓
                            Accumulate N corrected labels (N=500)
                                            ↓
                            Retrain model with new labels
                                            ↓
                            Validate on held-out test set
                                            ↓
                            Deploy to staging (beta users)
                                            ↓
                            A/B test: old model vs new model
                                            ↓
                        If new model better: promote to production
```

**Personalization Adjustment:**
```python
# If user says haptic was "annoying," increase threshold
if haptic_feedback == "ANNOYING":
    user_thresholds[pattern] *= 1.1  # Less sensitive

# If user says haptic was "helpful," decrease threshold
if haptic_feedback == "HELPFUL":
    user_thresholds[pattern] *= 0.95  # More sensitive
```

---

## Stage 9: Therapist Collaboration (Optional)

### 9.1 Data Aggregation for Therapist View

**Weekly Report Generation:**
```python
# Run batch job every Sunday night
for user in users_with_therapist_access:
    sessions = query_sessions(user.id, days=7)

    report = {
        "summary_stats": aggregate_conversation_metrics(sessions),
        "skill_progress": compute_skill_trends(sessions, user.goals),
        "notable_patterns": detect_context_dependent_patterns(sessions),
        "flagged_sessions": identify_high_stress_sessions(sessions)
    }

    store_therapist_report(user.id, report)
    notify_therapist(user.therapist_id, "New weekly report available")
```

**API Endpoint:**
```
GET /api/v1/therapist/clients/{user_id}/weekly-report

Response:
{
  "user_id": "user_123",
  "week_start": "2026-02-06",
  "summary_stats": { /* ... */ },
  "skill_progress": [ /* ... */ ],
  "notable_patterns": [ /* ... */ ]
}
```

### 9.2 Therapist Goal Adjustment

**Workflow:**
```
Therapist reviews user progress
    ↓
Therapist adjusts goal priority: "Focus more on repair strategies"
    ↓
API call: POST /api/v1/therapist/clients/{user_id}/goals
    ↓
Update user goal priorities in database
    ↓
Coaching engine picks up new priorities
    ↓
Next session: coaching emphasizes repair more heavily
```

---

## Stage 10: Model Training and Deployment Pipeline

### 10.1 Dataset Collection

**Data Sources:**
1. **Opt-In Users:** Contribute anonymized features + labels
2. **Self-Report Labels:** Users mark "I was confused," "I overshared," etc.
3. **Therapist Annotations:** SLPs label select sessions (high-quality ground truth)
4. **Active Learning:** Model flags uncertain moments, asks users for clarification

**De-Identification:**
```python
# Remove PII before adding to training dataset
anonymized_session = {
    "age_range": user.age_range,  # Not exact age
    "diagnosis": user.diagnosis,
    "session_features": session.turns,  # No user_id, no audio
    "labels": session.user_annotations + therapist_annotations
}
```

### 10.2 Training Pipeline

**Infrastructure:** Kubeflow or AWS SageMaker

**Steps:**
```
Raw Data (S3) → De-identification → Feature Engineering
                                            ↓
                            Train/Val/Test Split (70/15/15)
                                            ↓
                            Model Training (GPUs)
                                            ↓
                            Hyperparameter Tuning (AutoML)
                                            ↓
                            Evaluation (Accuracy, Precision, Recall, F1)
                                            ↓
                            Clinical Validation (SLP Review)
                                            ↓
                            Staging Deployment (Beta Users)
                                            ↓
                            A/B Testing (New vs Old Model)
                                            ↓
                            Production Deployment
```

**Metrics Tracked:**
- Technical: Accuracy, precision, recall, F1, AUC-ROC
- User-Facing: Helpful rating %, behavior change rate, NPS impact
- Clinical: Therapist agreement rate, goal achievement rate

### 10.3 A/B Testing Framework

**Design:**
```python
# Randomly assign users to cohorts
if hash(user_id) % 2 == 0:
    cohort = "CONTROL"  # Use model v1.2
else:
    cohort = "TREATMENT"  # Use model v1.3

# Track metrics per cohort
metrics[cohort].append({
    "user_id": user_id,
    "helpful_rating": session.feedback.helpful_count / session.feedback.total_count,
    "engagement": session.app_opens_per_week
})

# After N=500 users per cohort, statistical test
if t_test(metrics["TREATMENT"], metrics["CONTROL"]).p_value < 0.05:
    promote_to_production("model_v1.3")
```

### 10.4 Model Monitoring

**Production Monitoring:**
- **Prediction Distribution:** Alert if class distribution shifts dramatically (data drift)
- **Confidence Scores:** Alert if average confidence drops below 0.6 (model degradation)
- **User Feedback:** Alert if "not helpful" rate exceeds 40%
- **Latency:** Alert if inference time exceeds 500ms

**Incident Response:**
```
Alert Triggered → Auto-rollback to previous model version
                    ↓
            Engineer investigates root cause
                    ↓
            Fix deployed (retrain or hotfix)
                    ↓
            Re-deploy with monitoring
```

---

## Data Flow Diagram (Complete)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TIZZY DATA PIPELINE (END-TO-END)                  │
└─────────────────────────────────────────────────────────────────────────┘

[USER CONVERSATION]
        │
        ├─► Microphones (16kHz) → ADC → Circular Buffer (30-120 min RAM)
        │                                        │
        │                    ┌───────────────────┴──────────────┐
        │                    │                                   │
        ├─► VAD → Speech Segments                               │
        │         │                                              │
        ├─────────┴─► Speaker Diarization → WEARER / OTHER      │
        │                     │                                  │
        ├─────────────────────┴─► Feature Extraction            │
        │                             ├─► Prosody (pitch, rate, intensity)
        │                             ├─► Timing (turn length, gaps)
        │                             └─► Voice Quality (jitter, HNR)
        │                                        │
        ├─────────────────────────────────────► On-Device ML Models
        │                                         ├─► Pacing Detector
        │                                         ├─► Reciprocity Detector
        │                                         └─► Escalation Detector
        │                                                  │
        │                                        ┌─────────┴─────────┐
        │                                        │ Haptic Triggered? │
        │                                        └─────────┬─────────┘
        │                                                  │
        └──────────────────────────────► [USER FEELS VIBRATION]
                                                          │
        ┌─────────────────────────────────────────────────┘
        │
        │ [User opens app or 4hr auto-sync]
        │
        ├─► BLE Sync (Features + Metadata, ~8KB compressed)
        │             │
        │             └─► Mobile App (Local Cache + UI)
        │                         │
        │                         └─► HTTPS Upload to Cloud
        │                                     │
        │                    ┌────────────────┴───────────────┐
        │                    │                                │
        ├─► API Gateway → Validation → TimescaleDB (Features)
        │                                PostgreSQL (Metadata)
        │                                S3 (Audio snippets, if any)
        │                                        │
        │                                        └─► Message Queue (Async)
        │                                                  │
        ├─────────────────────────────────────────────────┴──► Understanding Service
        │                                                          ├─► Modulate ELM (Tone/Intent)
        │                                                          ├─► Transcription (Whisper/Deepgram)
        │                                                          └─► Tizzy Models (Confusion, Repair, Topic)
        │                                                                  │
        ├──────────────────────────────────────────────────────────────────┴──► Coaching Engine
        │                                                                          ├─► Personalization (Baseline)
        │                                                                          ├─► LLM Insight Generation
        │                                                                          └─► Recommendation Engine
        │                                                                                  │
        │                                                            ┌─────────────────────┴────────────┐
        │                                                            │ Coaching Summary Written to DB   │
        │                                                            └─────────────────┬────────────────┘
        │                                                                              │
        └─────────────────────────────────► [User Views Insights in App] ◄────────────┘
                                                          │
                                                          ├─► User Rates Insight (Helpful?)
                                                          ├─► User Annotates Moments (Correct?)
                                                          └─► Feedback Logged
                                                                  │
        ┌─────────────────────────────────────────────────────────┘
        │
        └─► Feedback Loop → Model Retraining Queue → A/B Testing → Production Deployment
```

---

## Performance Optimization Strategies

### 1. Edge Optimization
- **Feature Caching:** Pre-compute common features (e.g., baseline stats) on-device
- **Model Quantization:** INT8 quantization for on-device models (3-4x speedup, minimal accuracy loss)
- **Selective Processing:** Only run expensive models when confidence thresholds met

### 2. Network Optimization
- **Compression:** Gzip JSON payloads (50-70% size reduction)
- **Batching:** Batch multiple sessions in single API call when syncing after long offline period
- **Delta Sync:** Only send changed data (e.g., updated user preferences)

### 3. Cloud Optimization
- **Batch Processing:** Process non-urgent sessions in batch jobs (hourly) using spot instances
- **Caching:** Redis cache for frequently accessed data (user baselines, recent sessions)
- **Read Replicas:** Database read replicas for therapist portal queries (don't impact main DB)
- **CDN:** Static assets (app resources, educational videos) served from CDN

### 4. ML Optimization
- **Model Serving:** TensorFlow Serving with batching (process multiple sessions together)
- **GPU Sharing:** Multi-tenancy for GPU inference (cost-effective at scale)
- **Tiered Models:** Lightweight models for most sessions, deep models only for high-uncertainty cases

---

## Monitoring and Observability

### Key Metrics

**Device Metrics:**
- Battery life (actual vs. target)
- VAD false positive/negative rate
- Haptic trigger frequency per session
- BLE sync success rate

**Pipeline Metrics:**
- Feature extraction latency
- Model inference latency (per model)
- API response time (p50, p95, p99)
- Queue depth (async processing backlog)

**Quality Metrics:**
- Model confidence distribution (alert if drifting toward low confidence)
- User feedback: "helpful" rate per model output type
- Therapist agreement rate (sample-based audits)

**Business Metrics:**
- Daily active users (DAU)
- Session completion rate (user reviews insights)
- Goal achievement rate (user improves on target skill)
- NPS (Net Promoter Score)

### Alerting Strategy

**Critical Alerts (Page On-Call):**
- API down (>5 min outage)
- Database read/write failure
- Model serving crashed
- Security incident detected

**Warning Alerts (Slack Notification):**
- Model confidence drop >10% from baseline
- API latency p95 >2 seconds
- User feedback "not helpful" rate >40%
- Cost per user >$2.50 (budget overrun)

---

## Privacy and Security in Pipeline

### Data Minimization at Each Stage

| Stage | Data Collected | Data Retained | Retention Period |
|-------|----------------|---------------|------------------|
| **Device** | Raw audio | Circular buffer only | 30-120 min (overwrite) |
| **Device** | Features | Encrypted flash | Until synced, then deleted |
| **App** | Features + Metadata | Local cache | 30 days |
| **Cloud** | Features | TimescaleDB | 90 days full, then aggregated |
| **Cloud** | Audio snippets | S3 (encrypted) | 7 days (user can extend to 30 days) |
| **Cloud** | Coaching insights | PostgreSQL | 1 year |
| **Cloud** | Audit logs | Append-only log | 7 years (compliance) |

### Encryption at Rest and in Transit

**Device:**
- Flash storage: AES-256, key derived from device ID + user PIN
- No key escrow (if device lost without backup, data unrecoverable)

**App:**
- SQLite: SQLCipher (AES-256)
- Keychain (iOS) / Keystore (Android) for sensitive credentials

**Transit:**
- BLE: Encrypted pairing, AES-128 link encryption
- API: TLS 1.3, certificate pinning

**Cloud:**
- Database: Encrypted volumes (AWS RDS encryption, GCP encryption)
- Blob storage: Server-side encryption (SSE-KMS)

### Access Controls

**User Data:**
- Row-level security: User can only access their own data
- Therapist access: Requires explicit consent + time-limited access token

**Admin Access:**
- MFA required
- All access logged (immutable audit trail)
- No admin can view user audio without legal requirement + user notification

---

## Conclusion

Tizzy's data pipeline is designed to be privacy-first, real-time where necessary, and optimized for autism-specific coaching. The pipeline transforms raw audio into actionable insights while minimizing data retention and maximizing user control.

**Key Strengths:**
1. **Privacy:** Raw audio rarely leaves device; features-first architecture
2. **Real-Time:** <500ms latency for haptic feedback
3. **Personalization:** User baselines and adaptive thresholds
4. **Explainability:** Every coaching action traceable to features and model decisions
5. **Feedback Loops:** User ratings improve models over time

**Next Steps:**
1. Prototype device firmware (VAD + feature extraction + on-device ML)
2. Build mobile app with BLE sync and timeline visualization
3. Set up cloud infrastructure (AWS/GCP, TimescaleDB, model serving)
4. Train initial autism-specific models on pilot dataset
5. Integrate Modulate ELM API
6. Launch beta with 20-50 users and monitor pipeline performance
