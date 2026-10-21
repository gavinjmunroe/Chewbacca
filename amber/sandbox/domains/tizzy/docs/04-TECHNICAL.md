# Tizzy — Technical Architecture

## Hardware Specification (V1 Target)

### Form Factor
- Pendant: disc-shaped, approximately 38mm diameter, 8–10mm depth
- Material: matte anodized aluminum shell, soft silicone back
- Attachment: braided cord (included) or magnetic clip (accessory)
- Weight target: under 22g
- Color: single SKU in deep slate

### Compute
- Primary MCU: Nordic Semiconductor nRF5340 or equivalent (dual-core ARM Cortex-M33)
- ML inference accelerator: Syntiant NDP120 or Ambiq Apollo series (ultra-low power neural inference)
- RAM: 512KB–1MB SRAM (sufficient for feature extraction models at target size)
- Flash: 4MB for firmware, model weights, and 12-hour circular feature buffer

### Audio
- Dual MEMS microphones (stereo capture for speaker separation and directional audio)
- Always-on wake threshold: hardware-level voice activity detection, pre-neural
- Processing: on-device feature extraction pipeline (see Software Architecture)
- Hard mute: physical relay breaks microphone circuit — no software state can override

### Haptics
- Precision LRA (Linear Resonant Actuator) for distinct pattern playback
- Three pre-defined vibration patterns (see Product doc: Haptic Language)
- Latency target: < 50ms from trigger to haptic onset
- Pattern resolution: 10ms amplitude steps

### Battery and Power
- Target: 24–48 hour continuous runtime (active capture + BLE sync) on a single charge
- Charging: USB-C magnetic puck (no exposed port)
- Low-power mode: 72-hour standby
- Power budget: always-on wake detection ~400µA, active inference ~4–8mA, haptic pulse ~120mA peak (30ms duration)

### Connectivity
- Bluetooth Low Energy 5.3 (BLE) to paired iPhone
- No WiFi in V1 — BLE only, to eliminate any cloud sync path at the hardware level
- BLE advertising: silent unless actively pairing

### Indicator
- Single RGB LED, visible through a frosted aperture on the pendant face
- Amber: session active (always on during capture)
- Green: BLE connected, idle
- Off: hard muted or powered down
- Red: error state

---

## Three-Layer Software Architecture

### Layer 1: Capture and Feature Pipeline (On-Device, Pendant)

**Input:** Raw audio, 16kHz mono (user-side mic) + 16kHz mono (ambient/bystander mic, used for speaker separation only, discarded after)

**Stage 1: Voice Activity Detection**
Hardware-level VAD triggers the neural pipeline only when speech is present. Idle current draw during silence is under 500µA. Prevents the inference chip from running on background noise.

**Stage 2: Speaker Diarization (Lightweight)**
Two-speaker separation using the dual-mic signal and a compact on-device model. Tags each detected utterance as "user" or "other." The "other" stream is used only for turn-timing computation — no features from other speakers are stored.

**Stage 3: Feature Extraction**
For each user utterance, extract:
- Duration (ms)
- Onset latency from prior utterance end (pause length)
- In-turn pause count and total pause duration
- Speech rate estimate (syllable-level energy envelope)
- Pitch mean and variance (if model budget allows)
- Overlap flag (user speech onset while other speaker still active)
- Topic shift signal (cosine distance of phoneme-level embedding against prior 60s window — lightweight on-device approximation)

**Output:** Feature vector per utterance, plus session-level aggregates. Stored in circular buffer. No audio stored. No audio transmitted.

**Stage 4: Real-Time Coaching Inference**
A small classifier (target: < 200KB model, INT8 quantized) runs against the live feature stream with a 400–800ms sliding window. Outputs: probability scores for each coaching taxonomy dimension (reciprocity, topic management, repair, prosody, overload). When score exceeds calibrated threshold for an active coaching target, trigger haptic output.

---

### Layer 2: Understanding Layer (iPhone App)

**Input:** Feature vectors synced from pendant via BLE after session end (or on demand).

**Processing:**
- Session segmentation: group feature vectors into conversation sessions using silence gap heuristic (> 90 seconds of near-silence = session boundary)
- Turn construction: merge consecutive same-speaker utterances into turns
- Metric computation: turn duration distribution, overlap rate, topic shift frequency, pause distribution
- Annotation: attach haptic event flags to timeline positions
- Coaching card generation: rule-based + lightweight LLM call (on-device, iOS Neural Engine) to generate natural-language coaching sentences

**Output:** Session object (see Data Schema below), stored in local SQLite database on device.

**Privacy note:** The understanding layer runs entirely on the iPhone. No data is sent to Tizzy servers in V1. The LLM call for coaching sentence generation uses Apple's on-device inference stack — no network request.

---

### Layer 3: Coaching and Personalization Layer (iPhone App)

**Input:** Historical session objects, user-configured coaching targets, user feedback signals.

**Processes:**
- Trend computation: rolling 7-day and 30-day averages for all tracked metrics
- Focus selection: identify the coaching dimension with the highest coaching event rate and lowest recent improvement velocity → surface as "this week's focus"
- Calibration updates: if the user gives feedback that a coaching cue was unhelpful or wrong, adjust the sensitivity threshold for that pattern. Thresholds are stored per-user locally.
- Onboarding calibration: first three sessions run in observation-only mode (no haptics). Baselines are established. Coaching targets are set collaboratively during the onboarding review call (for subscribed users) or via guided in-app flow.

**Output:** Weekly trend summary, coaching focus recommendation, calibrated thresholds pushed back to pendant at next BLE sync.

---

## Conversation Output Schema

### Session Level
```json
{
  "session_id": "uuid",
  "started_at": "ISO8601",
  "ended_at": "ISO8601",
  "duration_ms": 1234567,
  "turn_count": 42,
  "overlap_count": 7,
  "topic_shift_count": 5,
  "haptic_events": [ ... ],
  "metrics": {
    "avg_turn_duration_ms": 18400,
    "avg_pause_before_turn_ms": 620,
    "speech_rate_avg": 142,
    "speech_rate_variance": 0.18,
    "user_talk_ratio": 0.54
  }
}
```

### Turn Level
```json
{
  "turn_id": "uuid",
  "session_id": "uuid",
  "speaker": "user",
  "onset_ms": 12400,
  "offset_ms": 30820,
  "duration_ms": 18420,
  "pause_before_ms": 580,
  "overlapped_onset": false,
  "in_turn_pause_count": 2,
  "speech_rate_estimate": 148,
  "topic_shift_flag": false
}
```

### Moment Flags
```json
{
  "flag_id": "uuid",
  "session_id": "uuid",
  "turn_id": "uuid",
  "timestamp_ms": 23100,
  "flag_type": "reciprocity_monologue",
  "haptic_delivered": true,
  "haptic_pattern": "B",
  "coaching_dimension": "reciprocity",
  "confidence": 0.87
}
```

### Post-Session Summary
```json
{
  "session_id": "uuid",
  "coaching_sentence": "You held the floor for over two minutes early on. Next time, try checking in after about 90 seconds.",
  "primary_flag_type": "reciprocity_monologue",
  "flag_count_by_dimension": {
    "reciprocity": 4,
    "topic_management": 2,
    "prosody": 1
  },
  "best_moment": {
    "turn_id": "uuid",
    "note": "Clean handoff at 14:22 — you paused and let Mei take the floor naturally."
  }
}
```

---

## Vendor Relationship Strategy

### Modulate ELM
Modulate builds voice AI infrastructure including speaker characterization and voice feature extraction. Their ELM (Expressive Language Model) stack is a strong candidate for powering Tizzy's on-device prosody and speech rate features. Relationship approach: research partnership first, not vendor contract. Collaborate on the autistic speech profile dataset problem (autistic speech patterns are systematically underrepresented in voice AI training data). The dataset contribution is Tizzy's leverage.

### Apple Neural Engine
All on-device inference on iPhone runs via Core ML / ANE. This is a committed architectural choice, not a contingency. The Apple ecosystem provides privacy guarantees that are structurally enforced (App Store review, on-device processing APIs, no side-channel data exfiltration) and is the right platform for a trust-first product.

### Nordic Semiconductor / Ambiq
Primary MCU vendors for the pendant compute layer. Both have strong developer ecosystems for ultra-low-power BLE embedded applications. Ambiq has existing traction in health wearables (Apollo4 used in several medical-grade devices). Nordic has better community tooling (Zephyr RTOS support). Decision pending prototype benchmarks.

---

## Dataset Strategy and Ethical Moat

### The Problem
Every voice AI model in conversation analysis is trained primarily on neurotypical speech patterns. Autistic speech — with its characteristic prosody differences, topic structures, and pause distributions — is systematically misclassified by these models. A coaching tool built on a neurotypical model will give autistic users wrong feedback. This is not a minor accuracy issue; it is a fundamental alignment failure.

### Tizzy's Approach
1. **Build the first consented autistic adult conversational speech corpus.** Partner with SLPs, autism researchers, and autistic-led organizations to collect labeled conversational data with explicit, compensated consent.
2. **Never use bystander audio for training.** Only the user's own speech features, with explicit opt-in consent and a per-session data contribution toggle.
3. **Publish the dataset.** Making it available to researchers builds trust, builds the field, and builds Tizzy's reputation as a serious scientific actor — not just a consumer app.
4. **Model the user, not "autism."** Long-term, the coaching model personalizes to the individual, not to a diagnostic category. The category is a starting point for the prior; the individual's own data overrides it.

### The Moat
A dataset of consented autistic adult conversational speech is extremely difficult to replicate. It requires trust (autistic communities are appropriately skeptical of research that exploits them), an established product (to have enough users to opt in), and time. Six months of honest operation with a privacy-first product will produce training data that a well-funded competitor cannot acquire on a similar timeline without cutting the same ethical corners that make autistic communities skeptical of AI products in the first place.
