# Machine Learning Models and Architecture

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Audience:** ML Engineers, Data Scientists, Research Team

---

## Overview

Tizzy's machine learning architecture combines licensed third-party voice understanding models (Modulate ELM) with proprietary autism-specific models trained on Tizzy's dataset. This document specifies the ML model architecture, training pipeline, deployment strategy, and performance requirements for V1 and beyond.

---

## ML Architecture Philosophy

### Core Principles

1. **Hybrid Approach:** Leverage Modulate for general voice understanding; build proprietary models for autism-specific patterns
2. **Moat is Data + Domain Models:** Tizzy's defensible advantage is the autism dataset and domain-specific coaching models
3. **Modular and Swappable:** Architecture allows replacing Modulate or other components without rewriting entire system
4. **Explainable by Design:** Every model output includes confidence scores and contributing features (trust + debugging)
5. **Personalization Over Population Norms:** Models adapt to individual baselines, not neurotypical averages

---

## Model Taxonomy

### Three Model Tiers

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 1: ON-DEVICE REAL-TIME MODELS (Edge/Device)           │
│  • Lightweight, <100KB, <10ms inference                     │
│  • Purpose: Trigger haptic feedback in real-time            │
│  • Examples: Pacing detector, reciprocity detector,         │
│              escalation detector                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  TIER 2: CLOUD UNDERSTANDING MODELS (Backend)               │
│  • Medium complexity, <5 min inference per session          │
│  • Purpose: Detect conversational moments for coaching      │
│  • Examples: Confusion detector, repair detector,           │
│              topic maintenance classifier                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  TIER 3: LICENSED EXTERNAL MODELS (Third-Party APIs)        │
│  • Black-box or semi-transparent                            │
│  • Purpose: General voice understanding and NLG             │
│  • Examples: Modulate ELM (voice tone/emotion),             │
│              GPT-4/Claude (insight generation)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Tier 1: On-Device Real-Time Models

### Purpose
Detect patterns requiring immediate haptic feedback (<500ms latency). Models must be tiny (<100KB), fast (<10ms inference), and power-efficient.

### Model 1: Pacing Detector

**Problem:** User speaking too fast or too slow relative to their baseline

**Architecture:** Threshold-based rule model with personalized thresholds

**Input Features:**
- `speech_rate_sps` (syllables per second): Current turn
- `baseline_speech_rate`: User's 7-day baseline (50th percentile)
- `baseline_std`: Standard deviation of user's speech rate

**Algorithm:**
```python
threshold_fast = baseline_speech_rate + (1.5 * baseline_std)
threshold_slow = baseline_speech_rate - (1.5 * baseline_std)

if speech_rate_sps > threshold_fast:
    output = "TOO_FAST"
    confidence = min(1.0, (speech_rate_sps - threshold_fast) / baseline_std)
elif speech_rate_sps < threshold_slow:
    output = "TOO_SLOW"
    confidence = min(1.0, (threshold_slow - speech_rate_sps) / baseline_std)
else:
    output = "OPTIMAL"
    confidence = 1.0
```

**Output:**
```json
{
  "label": "TOO_FAST",
  "confidence": 0.82,
  "action": "TRIGGER_HAPTIC_SINGLE_PULSE"
}
```

**Personalization:**
- Thresholds adapt based on user feedback ("Was this haptic helpful?")
- If user says "annoying," increase threshold (less sensitive)
- If user says "helpful," decrease threshold (more sensitive)

**Deployment:** Compiled C code, runs on MCU

---

### Model 2: Reciprocity Detector

**Problem:** Conversation becomes one-sided (wearer monologuing)

**Architecture:** Rule-based with ML threshold tuning

**Input Features:**
- `wearer_turn_count_since_last_other`: Number of consecutive wearer turns
- `time_since_last_other_turn_sec`: Seconds since listener last spoke
- `conversation_duration_sec`: Total duration so far

**Algorithm:**
```python
if wearer_turn_count >= 4 AND time_since_last_other > 60:
    output = "ONE_SIDED_WEARER"
    confidence = min(1.0, wearer_turn_count / 6)  # Saturates at 6 turns
elif time_since_last_other > 120:  # 2 minutes of monologue
    output = "ONE_SIDED_WEARER"
    confidence = 0.9
else:
    output = "BALANCED"
    confidence = 0.8
```

**Output:**
```json
{
  "label": "ONE_SIDED_WEARER",
  "confidence": 0.84,
  "action": "TRIGGER_HAPTIC_DOUBLE_PULSE"
}
```

**Personalization:**
- Thresholds adapt to conversation type (presentations allow longer monologues)
- Context detection: If `environment == "presentation"`, disable reciprocity haptics

**Deployment:** Compiled C code, runs on MCU

---

### Model 3: Escalation Detector

**Problem:** Conversation intensity increasing (volume, pitch, overlap) → risk of conflict or overload

**Architecture:** Lightweight feedforward neural network (3 layers)

**Input Features (8 dimensions):**
- `intensity_mean_db`: Current turn intensity
- `intensity_variance_db`: Variance within turn
- `intensity_trend`: INCREASING, DECREASING, STABLE (one-hot encoded)
- `pitch_variance`: Standard deviation of pitch
- `overlap_duration_sec`: Overlap with other speaker
- `hnr_db`: Harmonic-to-noise ratio (voice strain indicator)
- `wearer_intensity_delta`: Change from previous turn
- `baseline_intensity_mean`: User's typical intensity

**Architecture:**
```
Input Layer (8 features)
    ↓
Hidden Layer (16 neurons, ReLU activation)
    ↓
Hidden Layer (8 neurons, ReLU activation)
    ↓
Output Layer (3 classes: CALM, ELEVATED, ESCALATING, softmax)
```

**Training:**
- Dataset: 5,000 labeled autism conversations (SLP annotations + self-reports)
- Labels: "This felt stressful" (user), "Escalation detected" (therapist)
- Augmentation: Perturb features ±10% to increase robustness

**Output:**
```json
{
  "label": "ESCALATING",
  "confidence": 0.78,
  "probabilities": {
    "CALM": 0.05,
    "ELEVATED": 0.17,
    "ESCALATING": 0.78
  },
  "action": "TRIGGER_HAPTIC_LONG_PULSE"
}
```

**Model Size:** 87KB (quantized to INT8)
**Inference Time:** 8ms on ARM Cortex-M7

**Deployment:** TensorFlow Lite Micro model, compiled to C

---

## Tier 2: Cloud Understanding Models

### Purpose
Detect conversational patterns for post-conversation coaching. Run in cloud backend (not latency-critical).

### Model 4: Confusion Moment Detector

**Problem:** Detect when conversation partner is confused, but wearer doesn't notice

**Architecture:** Gradient Boosted Trees (XGBoost)

**Input Features (12 dimensions):**
- `inter_turn_gap_sec`: Pause after wearer turn (long pause = possible confusion)
- `other_speaker_pitch_variance`: Listener's pitch change (confusion often raises pitch)
- `other_speaker_intensity_variance`: Listener's volume change
- `clarification_keywords`: Boolean (transcript contains "what?", "huh?", "I don't understand")
- `wearer_turn_length_sec`: Very long turns often lead to confusion
- `wearer_topic_shift`: Did wearer shift topic abruptly?
- `prosody_mismatch`: Boolean (flat tone for emotional topic)
- `repetition_detected`: Listener repeats wearer's words (clarification attempt)
- `follow_up_question_missing`: Wearer didn't ask if listener understood
- `previous_confusion_proximity`: Time since last confusion moment (confusion clusters)
- `baseline_confusion_rate`: User's typical confusion rate (personalization)
- `conversation_context`: Environment type (school, home, therapy)

**Training:**
- **Dataset:** 10,000 labeled confusion moments
  - Source 1: User self-reports ("I was confused here")
  - Source 2: Therapist annotations (SLP-reviewed conversations)
  - Source 3: Active learning (model flags uncertain moments, asks users to confirm)
- **Algorithm:** XGBoost with 200 trees, max depth 6
- **Evaluation:** 70/15/15 train/val/test split

**Performance Metrics:**
- Precision: 0.73 (73% of predicted confusions are real)
- Recall: 0.68 (68% of actual confusions detected)
- F1 Score: 0.70
- Therapist Agreement: 78% (SLPs agree with model 78% of time)

**Output:**
```json
{
  "moment_id": "moment_abc123",
  "type": "CONFUSION_DETECTED",
  "confidence": 0.78,
  "signals": [
    {
      "signal": "LONG_PAUSE_AFTER_WEARER",
      "value": 3.2,
      "unit": "seconds",
      "weight": 0.6
    },
    {
      "signal": "PROSODY_MISMATCH",
      "value": true,
      "weight": 0.4
    }
  ],
  "coaching_recommendation": "When listener pauses >2 seconds, ask: 'Does that make sense?'"
}
```

**Deployment:** TensorFlow Serving (XGBoost model exported to ONNX or saved_model format)

---

### Model 5: Repair Detection Model

**Problem:** Detect when wearer attempts to repair miscommunication (clarifying, rephrasing, apologizing)

**Architecture:** LSTM sequence model (captures temporal patterns)

**Input Features (sequence of turns):**
- **Turn N-1 (Wearer):** `prosody_features`, `turn_length`, `topic_embedding`
- **Turn N (Other):** `confusion_signals` (pause, "huh?", repetition)
- **Turn N+1 (Wearer):** `repair_keywords` ("I mean", "let me explain", "sorry"), `prosody_change`, `turn_length_change`
- **Context:** `conversation_type`, `wearer_repair_skill_baseline`

**Architecture:**
```
Input Sequence (last 3 turns, 30 features per turn = 90 dimensions)
    ↓
LSTM Layer (64 hidden units)
    ↓
LSTM Layer (64 hidden units)
    ↓
Dense Layer (32 neurons, ReLU)
    ↓
Output Layer (2 classes: REPAIR_ATTEMPTED, NO_REPAIR, sigmoid)
```

**Training:**
- **Dataset:** 3,000 labeled repair sequences
  - Source: SLP annotations ("This is a good repair", "Missed repair opportunity")
- **Positive Class:** Wearer responded to confusion with clarification
- **Negative Class:** Wearer didn't respond or responded defensively

**Performance Metrics:**
- Precision: 0.81 (81% of predicted repairs are real repairs)
- Recall: 0.74 (74% of actual repairs detected)
- F1 Score: 0.77

**Output:**
```json
{
  "moment_id": "moment_def456",
  "type": "REPAIR_ATTEMPTED",
  "success": true,
  "confidence": 0.81,
  "repair_strategy": "REPHRASING",
  "coaching": "Great job rephrasing when your friend seemed confused!"
}
```

**Deployment:** TensorFlow Serving

---

### Model 6: Topic Maintenance Classifier

**Problem:** Detect topic drifts and abrupt topic shifts (common in autism)

**Architecture:** Transformer-based sequence classifier (fine-tuned BERT)

**Input Features:**
- **Transcript-Based:** Last 5 turns (concatenated), sentence embeddings (SBERT)
- **Prosody-Based:** Pitch/intensity shift often accompanies topic change
- **Turn Length:** Abrupt short turns may indicate topic shift

**Architecture:**
```
Input: Sequence of 5 turns (text + prosody features)
    ↓
BERT Encoder (pre-trained, fine-tuned on autism conversations)
    ↓
CLS Token Representation (768 dimensions)
    ↓
Dense Layer (128 neurons, ReLU)
    ↓
Output Layer (3 classes: ON_TOPIC, DRIFT, ABRUPT_SHIFT, softmax)
```

**Training:**
- **Dataset:** 5,000 conversational sequences
  - Labeled by therapists: "Topic maintained", "Gradual drift", "Abrupt shift"
- **Pre-training:** BERT base model (uncased)
- **Fine-tuning:** 5 epochs on autism conversation dataset

**Performance Metrics:**
- Accuracy: 72% (3-class classification)
- Precision (ABRUPT_SHIFT): 0.68
- Recall (ABRUPT_SHIFT): 0.71

**Output:**
```json
{
  "moment_id": "moment_ghi789",
  "type": "TOPIC_DRIFT",
  "confidence": 0.69,
  "from_topic": "weekend_plans",
  "to_topic": "video_games",
  "coaching": "You shifted topics without a transition. Try: 'Speaking of fun, what video games are you playing?'"
}
```

**Deployment:** TensorFlow Serving (BERT model exported to saved_model format)

**Note:** Requires transcription enabled (opt-in feature)

---

## Tier 3: Licensed External Models

### Model 7: Modulate ELM (Ensemble Listening Model)

**Provider:** Modulate.ai (licensed API)

**Purpose:** Voice-first understanding of tone, emotion, and intent beyond transcription

**Input:** Acoustic features (prosody, intensity, timing) OR raw audio snippet

**Output:**
```json
{
  "turn_id": "turn_xyz789",
  "intent": "QUESTION",
  "emotion": "NEUTRAL",
  "prosody_analysis": {
    "pacing": "fast",
    "intensity": "elevated",
    "formality": "casual"
  },
  "confidence": 0.87
}
```

**Integration:**
- **API Endpoint:** `POST https://api.modulate.ai/v1/analyze`
- **Batching:** Batch up to 50 turns per API call (cost optimization)
- **Cost:** ~$0.025 per session (20 turns)
- **Latency:** <3 seconds per batch

**Contract Boundaries:**
- **Inference-Only License:** Tizzy pays per API call; Modulate does NOT get training rights to Tizzy's autism dataset
- **Data Residency:** Modulate processes in their cloud; Tizzy ensures GDPR/COPPA compliance
- **Fallback:** If Modulate API down, Tizzy falls back to on-device features only (reduced coaching quality, but system continues)

---

### Model 8: Transcription Engine (OpenAI Whisper or Deepgram)

**Purpose:** Convert audio to text for topic analysis and literal interpretation detection

**Options:**

**Option A: OpenAI Whisper (Self-Hosted)**
- **Pros:** Privacy (on-premises), no per-API-call cost, high accuracy
- **Cons:** GPU infrastructure cost, maintenance burden
- **Model Size:** Whisper-medium (769M parameters)

**Option B: Deepgram API**
- **Pros:** Fast (real-time factor <0.1), cost-effective ($0.0125 per minute)
- **Cons:** Third-party API dependency

**V1 Decision:** Deepgram API (speed + cost); migrate to self-hosted Whisper in V2 if privacy concerns grow

**Output:**
```json
{
  "turn_id": "turn_xyz789",
  "text": "So I was thinking we could go to the movies this weekend.",
  "confidence": 0.94,
  "words": [
    {"word": "So", "start": 0.0, "end": 0.2},
    {"word": "I", "start": 0.2, "end": 0.3},
    ...
  ]
}
```

**Privacy Note:** Transcription is **opt-in only** (default: disabled)

---

### Model 9: LLM for Insight Generation (GPT-4-turbo or Claude 3.5 Sonnet)

**Purpose:** Generate natural language coaching insights ("What went well", "What to improve", "Micro-goal")

**Provider:** OpenAI or Anthropic (API)

**Prompt Template:**
```
You are a conversation coach for an autistic user. Your role is to provide supportive, clarity-focused coaching without enforcing neurotypical conformity.

USER CONTEXT:
- Age: 18-25
- Goals: Improve reciprocity, notice confusion cues
- Baseline: Speech rate 4.2 sps (typical), reciprocity 0.65 (below personal goal)

SESSION DATA:
- Duration: 15 minutes
- Environment: school_cafeteria
- Reciprocity score: 0.68 (up from baseline)
- Detected moments:
  1. Confusion detected at 12:00 (listener paused 3.2 sec)
  2. Missed repair opportunity at 12:05 (no clarification attempt)
  3. Good question asked at 5:00 (reciprocity improvement)

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
  "micro_goal": "One specific, measurable goal for tomorrow"
}

TONE: Supportive, clear, respectful. Never suggest masking or hiding autistic traits. Focus on clarity and mutual understanding.
```

**Output Example:**
```json
{
  "what_went_well": [
    "You asked a follow-up question at 5:00, which kept the conversation balanced.",
    "Your reciprocity score improved from 0.65 to 0.68—great progress!"
  ],
  "what_to_improve": [
    "When your friend paused for 3 seconds at 12:00, they might have been confused. Try asking: 'Does that make sense?'",
    "You spoke for 90 seconds without checking if they were following. Aim for shorter turns tomorrow."
  ],
  "micro_goal": "Tomorrow, after speaking for 30 seconds, pause and ask: 'What do you think?' or 'Should I explain differently?'"
}
```

**Cost:** ~$0.015 per session (GPT-4-turbo, ~500 tokens)

---

## ML Model Deployment Pipeline

### Training Pipeline

```
1. DATA COLLECTION
   ├─► User opt-in for data contribution
   ├─► Self-report labels ("I was confused here")
   ├─► Therapist annotations (SLP-reviewed sessions)
   └─► Active learning (model flags uncertain, asks user)

2. DATA PREPROCESSING
   ├─► De-identification (remove user_id, device_id)
   ├─► Anonymization (age range, not exact age)
   ├─► Feature engineering (prosody, timing, semantic)
   └─► Train/Val/Test split (70/15/15)

3. MODEL TRAINING
   ├─► Hyperparameter tuning (grid search or Bayesian optimization)
   ├─► Cross-validation (5-fold)
   ├─► Regularization (dropout, L2 penalty)
   └─► Early stopping (monitor validation loss)

4. MODEL EVALUATION
   ├─► Technical metrics (accuracy, precision, recall, F1, AUC-ROC)
   ├─► User-facing metrics (helpful rating, behavior change rate)
   └─► Clinical validation (therapist agreement, goal achievement)

5. STAGING DEPLOYMENT
   ├─► Deploy to staging environment
   ├─► A/B test with beta cohort (N=100)
   ├─► Monitor metrics for 2 weeks
   └─► Rollback if performance degrades

6. PRODUCTION DEPLOYMENT
   ├─► Gradual rollout (10% → 50% → 100%)
   ├─► Monitor model performance dashboards
   ├─► Collect user feedback
   └─► Queue for next training cycle
```

**Retraining Frequency:**
- Tier 1 (On-Device): Every 3 months (new user baseline data)
- Tier 2 (Cloud): Every month (active learning labels accumulate)
- Tier 3 (External): Not controlled by Tizzy (vendor updates)

---

### A/B Testing Framework

**Goal:** Validate new models improve outcomes before deploying to all users

**Design:**
```python
# Randomly assign users to cohorts
user_cohort = hash(user_id) % 2  # 0 = CONTROL, 1 = TREATMENT

if user_cohort == 0:
    model_version = "v1.2"  # Existing model
else:
    model_version = "v1.3"  # New model

# Track metrics per cohort
metrics[user_cohort].append({
    "helpful_rating": session.feedback.helpful / session.feedback.total,
    "behavior_change": did_user_improve(session),
    "goal_progress": user.goals.progress_delta
})

# After N=500 users per cohort, statistical significance test
if t_test(metrics[TREATMENT], metrics[CONTROL]).p_value < 0.05:
    if mean(metrics[TREATMENT]) > mean(metrics[CONTROL]):
        promote_to_production("v1.3")
    else:
        rollback("v1.3 not better than v1.2")
```

**Primary Metrics:**
- **Helpful Rating:** % of users who rate coaching as "helpful"
- **Behavior Change Rate:** % of haptics that lead to observable behavior change
- **Goal Achievement:** % of users who improve on target skills (reciprocity, repair, etc.)

**Secondary Metrics:**
- NPS (Net Promoter Score)
- Session completion rate (user reviews insights)
- App retention (7-day, 30-day)

---

## Model Monitoring and Observability

### Production Monitoring Dashboards

**Model Performance:**
- Prediction distribution (alert if shifts dramatically = data drift)
- Confidence score distribution (alert if drops below 0.6)
- Inference latency (alert if p95 > 100ms for cloud models)

**User Feedback:**
- "Helpful" rating per model output type (confusion detector, repair detector, etc.)
- "Not helpful" rate (alert if > 40%)
- User annotations (% of model predictions confirmed by users)

**Clinical Quality:**
- Therapist agreement rate (sample-based audits)
- Goal achievement rate (users improving on target skills)
- Adverse events (coaching that worsened user's experience)

### Incident Response

**Model Degradation:**
```
Alert: Confusion detector confidence dropped from 0.75 to 0.55 (data drift suspected)
    ↓
1. Auto-rollback to previous model version (v1.2 → v1.1)
    ↓
2. Engineer investigates:
   - Data drift? (input distribution changed)
   - Label noise? (recent user annotations incorrect)
   - Model bug? (code regression)
    ↓
3. Fix deployed:
   - Retrain model on recent data
   - Adjust feature normalization
   - Increase regularization
    ↓
4. Re-deploy with monitoring
    ↓
5. Post-mortem (document root cause, prevent recurrence)
```

---

## Model Ethics and Bias

### Ethical Concerns

**1. Reinforcing Neurotypical Norms:**
- **Risk:** Models trained on neurotypical conversation data may penalize autistic communication styles
- **Mitigation:** Train exclusively on autism dataset; explicitly include "autistic communication is valid, not broken" in prompts

**2. Overfitting to Masking:**
- **Risk:** Models may reward users for "masking" (hiding autistic traits)
- **Mitigation:** Coaching philosophy: "Clarity and understanding, not conformity." Therapist review of coaching outputs.

**3. Surveillance and Control:**
- **Risk:** Parents/therapists misuse coaching to control user, not empower
- **Mitigation:** User always controls data sharing; coaching is user-aligned, not parent-aligned

### Bias Mitigation

**Data Bias:**
- **Problem:** If training data skewed toward certain demographics (age, race, gender), models may underperform for others
- **Solution:** Stratified sampling (ensure diverse representation); disaggregated performance metrics (measure accuracy per demographic)

**Labeling Bias:**
- **Problem:** Therapist annotations may reflect therapist's biases (e.g., gendered expectations)
- **Solution:** Multiple annotators per sample; inter-rater reliability checks; autistic self-advocates in labeling team

**Algorithmic Bias:**
- **Problem:** Models may learn spurious correlations (e.g., "speaking quickly = escalation" may penalize fast talkers unfairly)
- **Solution:** Regularization; adversarial debiasing; fairness constraints in loss function

---

## Open ML Questions

1. **Should on-device models be user-specific (personalized models per user)?**
   - **Benefit:** Highly accurate, tailored to individual
   - **Challenge:** Model training on-device (power, compute), model update complexity
   - **V1 Decision:** Shared models with personalized thresholds; explore federated learning in V3

2. **How to handle low-confidence predictions?**
   - **Option A:** Hide low-confidence insights (miss learning opportunities)
   - **Option B:** Show with confidence score ("We're 55% sure...")
   - **Option C:** Ask user to clarify (active learning)
   - **V1 Decision:** Show medium confidence (>0.5) with caveats; ask for feedback

3. **Should we build adversarial robustness (prevent users from gaming models)?**
   - **Problem:** Users might deliberately trigger false positives to test system
   - **Solution:** Anomaly detection; flag users with suspiciously high error rates
   - **V1 Decision:** Not a priority (trust-based relationship with users); revisit if abuse detected

4. **How much model interpretability is required?**
   - **Regulatory:** FDA (if medical device) requires explainability
   - **User Trust:** Users more likely to trust if they understand "why"
   - **V1 Decision:** Log contributing features for every prediction (signals array); expose to users in UI

---

## Model Roadmap

### V1 (Months 0-6): Core Models
- Tier 1: Pacing, reciprocity, escalation (on-device)
- Tier 2: Confusion, repair (cloud)
- Tier 3: Modulate ELM, GPT-4 insights (licensed)

### V1.5 (Months 6-12): Personalization
- User-specific baselines (7-day learning period)
- Adaptive thresholds (based on user feedback)
- A/B testing framework deployed

### V2 (Months 12-24): Advanced Models
- Topic maintenance classifier (transformer-based)
- Theory of mind marker detector (literal interpretation, sarcasm)
- Multi-modal models (audio + physiological sensors)

### V3 (Months 24+): Generalization
- Transfer learning to non-autism populations (speech therapy, leadership coaching)
- Federated learning (train models without centralizing data)
- Real-time model updates (continual learning)

---

## Conclusion

Tizzy's ML architecture is designed to be hybrid (licensed + proprietary), modular (swappable components), and ethical (anti-ableist, user-controlled). The three-tier model structure ensures real-time responsiveness (Tier 1), deep understanding (Tier 2), and state-of-the-art NLU (Tier 3) while maintaining Tizzy's defensible moat: the autism-specific dataset and coaching models.

**Critical Success Factors:**
- **Dataset Quality:** Models are only as good as training data; ethical data collection is paramount
- **User Feedback Loop:** Active learning and user ratings drive continuous improvement
- **Clinical Validation:** Therapist agreement and goal achievement are North Star metrics, not just technical accuracy
- **Explainability:** Every coaching action must be traceable to features and model decisions (trust + debugging)

**Next Steps:**
1. Recruit 20-50 beta users for pilot dataset collection
2. Train initial Tier 2 models (confusion, repair) on existing autism conversation datasets (academic sources)
3. Integrate Modulate ELM API
4. Build A/B testing framework
5. Deploy production monitoring dashboards
