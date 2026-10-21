# Hardware Specification

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** V1 Target Specification

---

## Overview

Tizzy's hardware must balance always-wearable form factor requirements with robust audio capture capabilities, privacy controls, real-time haptic feedback, and all-day battery life. The V1 hardware is deliberately aggressive yet buildable, prioritizing the necklace form factor while maintaining R&D pathways for alternative designs.

---

## Form Factor Requirements

### Primary: Necklace Pendant

**Design Philosophy:**
- Discreet enough to wear under clothing without appearing overtly "assistive"
- Premium aesthetic that does not signal disability or medical device
- Durable enough for daily wear by children and adults
- Socially acceptable in school, work, and social environments

**Physical Specifications:**
- **Dimensions:** 30-40mm diameter × 8-12mm thickness (comparable to premium jewelry)
- **Weight:** ≤25g (must not create neck strain during all-day wear)
- **Material:** Medical-grade silicone or hypoallergenic metal housing
- **Water Resistance:** IP54 minimum (splash and sweat resistant)
- **Drop Resistance:** 1.5m onto hard surface
- **Cord:** Adjustable length 40-60cm, breakaway safety mechanism for children

**Aesthetics:**
- Multiple color/finish options (matte black, brushed metal, earth tones)
- Minimal branding (logo embossed, not printed)
- No visible LEDs on primary surface (indicator light placement on edge or rear)

### Secondary R&D Pathways

**Earring Form Factor:**
- Compelling for long-term roadmap due to superior audio positioning
- Challenges: battery size constraints, bilateral design complexity, loss risk
- Target for V2+ after necklace validation

**Watch Integration:**
- Leverages existing wearable acceptance
- Challenges: microphone positioning farther from mouth, wrist movement noise
- Partnership opportunity (Apple Watch, Galaxy Watch integration)

**Clip-On Alternatives:**
- Collar clip, lapel pin, or shirt button replacement
- Better audio capture when above clothing
- May appear more "assistive" but could be positioned as premium

---

## Audio Capture System

### Microphone Array

**Configuration:** Dual-microphone array (minimum)

**Rationale:**
- Directional audio pickup toward wearer's mouth
- Beamforming for noise reduction in multi-speaker environments
- Far-field voice activity detection
- Environmental noise cancellation

**Specifications:**
- **Microphone Type:** MEMS omnidirectional microphones with wide dynamic range
- **Frequency Response:** 100Hz - 8kHz minimum (conversational speech range)
- **SNR:** ≥64dB
- **Sensitivity:** -38dBV/Pa ±2dB
- **Acoustic Overload Point:** 120dB SPL minimum

**Under-Clothing Challenge:**
- Fabric muffling is a known risk when pendant worn under shirt
- Mitigation strategies:
  - Advanced signal processing for cloth-filtered audio restoration
  - Microphone placement optimized for collar-zone positioning
  - Optional "above clothing" wear mode with user education
  - Real-time audio quality monitoring with user alerts

**Environmental Adaptability:**
- Must function in:
  - Quiet rooms (libraries, therapy sessions)
  - Moderate noise (classrooms, cafeterias, offices)
  - High noise (playgrounds, events, public transit)
  - Outdoor environments (wind noise rejection critical)

### Voice Activity Detection (VAD)

**On-Device Processing:**
- Low-power VAD running continuously
- Wake-on-voice to activate full capture pipeline
- False positive rate <5% to conserve battery and storage

**Speaker Diarization Pre-Processing:**
- Distinguish wearer voice from other speakers
- Confidence scoring for separation quality
- Fallback to "multi-speaker mode" when separation uncertain

---

## On-Device Compute

### Processing Requirements

**Core Capabilities:**
- Voice activity detection and segmentation
- Acoustic feature extraction (real-time)
- Speaker diarization preprocessing
- Lightweight intent classification (on-device model)
- Audio compression and encryption
- Haptic pattern generation and triggering

**Processor Target:**
- ARM Cortex-M series (M7 or M33) with DSP extensions, OR
- Low-power RISC-V with audio acceleration
- Minimum: 100MHz clock, 512KB RAM, 2MB Flash

**Audio DSP Pipeline:**
- Sample rate: 16kHz (speech optimized)
- Bit depth: 16-bit minimum
- Circular buffer: 5-minute rolling window in RAM
- Real-time feature extraction: MFCC, pitch tracking, energy variance

**Machine Learning Accelerator (optional V1, required V2):**
- Lightweight neural network inference (TensorFlow Lite Micro or equivalent)
- On-device classification: "ask question," "slow down," "escalation detected"
- Latency budget: <500ms from audio event to haptic output

### Storage Architecture

**Circular Buffer Design:**
- **Purpose:** Enable "instant replay" without creating surveillance archive
- **Size:** 30-120 minutes of compressed audio (user configurable)
- **Overwrite Policy:** FIFO unless user explicitly marks segment for retention
- **Retention Trigger:** User button press, app "save conversation" action, or detected moment of interest

**Persistent Storage:**
- **Capacity:** 4-8GB eMMC or NAND flash
- **Use Cases:**
  - Explicitly saved conversation segments
  - Daily acoustic feature summaries (non-audio metadata)
  - Device firmware and ML models
  - User settings and personalization data

**Data Minimization by Default:**
- Raw audio is NOT retained unless user explicitly enables per-session
- Default output: acoustic features, timestamps, event markers, confidence scores
- Privacy-first architecture: local processing, cloud sync for summaries only

---

## Battery and Power Management

### Battery Life Targets

**Minimum:** 24 hours continuous use
**Ideal:** 48 hours continuous use
**Standby:** 7 days with periodic sync

**Usage Profile Assumptions:**
- 12 hours active conversation capture per day
- 4 hours of moderate conversation (50% VAD active)
- 2 hours of intense conversation (90% VAD active)
- Bluetooth sync 4x per day (15 minutes each)
- Haptic feedback 20-40 events per day

### Power Budget (Estimated)

| Component | Active Power | Duty Cycle | Average Power |
|-----------|-------------|------------|---------------|
| Dual MEMS Mics | 200µA | 100% | 200µA |
| VAD Processing | 2mA | 100% | 2mA |
| Audio DSP | 15mA | 50% | 7.5mA |
| MCU (full active) | 25mA | 30% | 7.5mA |
| Bluetooth LE | 10mA | 10% | 1mA |
| Haptic Motor | 100mA | <1% | 0.5mA |
| **Total Average** | | | **~18.7mA** |

**Battery Sizing:**
- For 24hr: ~450mAh minimum
- For 48hr: ~900mAh ideal
- **Target:** 500-600mAh lithium-polymer pouch cell

**Charging:**
- USB-C charging preferred (industry standard, fast charge capable)
- Magnetic pogo-pin alternative for sealed waterproof design
- Charge time: <2 hours to 80%, <3 hours to 100%
- Charge status: small edge-mounted LED (red/amber/green)

**Power Management Intelligence:**
- Adaptive VAD sensitivity based on environment
- Reduced processing during extended silence
- Battery level surfaced in app with "low battery coaching disabled" mode
- User-configurable "quiet hours" (auto-disable capture overnight)

---

## Haptic Feedback System

### Haptic Actuator

**Type:** Linear Resonant Actuator (LRA) or Eccentric Rotating Mass (ERM)

**LRA Preferred for V1:**
- Faster response time (<10ms start/stop)
- More precise pattern control
- Lower power consumption
- Sharper, more distinguishable vibrations

**Specifications:**
- Frequency range: 150-250Hz (optimal tactile perception)
- Amplitude control: 0-2G acceleration
- Latency: <50ms from trigger to perceptible vibration
- Audible noise: <30dB at 30cm (silent to bystanders)

### Haptic Language (V1 Patterns)

**Design Constraint:** Limit to 3 distinct patterns in V1 to avoid cognitive overload

**Pattern 1: Single Pulse (Pacing/Adjustment)**
- **Duration:** 200ms
- **Intensity:** Medium (1.2G)
- **Meaning:** "Adjust pace" or "Volume check" or "Breath pause"
- **Use Cases:**
  - Speaking too fast (detected via speech rate)
  - Speaking too loud (detected via intensity spike)
  - Extended monologue (turn length >60 seconds)

**Pattern 2: Double Pulse (Reciprocity Cue)**
- **Duration:** 150ms pulse, 100ms gap, 150ms pulse
- **Intensity:** Medium (1.2G)
- **Meaning:** "Ask a return question" or "Check understanding" or "Invite response"
- **Use Cases:**
  - Extended wearer speaking with no listener turns
  - Missed opportunity to ask clarifying question
  - One-sided conversation pattern detected

**Pattern 3: Long Pulse (Escalation/Overload Risk)**
- **Duration:** 500ms
- **Intensity:** Strong (1.8G)
- **Meaning:** "Escalation detected" or "Overload risk" or "Exit/reset opportunity"
- **Use Cases:**
  - Volume or intensity escalation detected
  - Overlapping speech sustained >5 seconds
  - Acoustic stress markers in wearer's voice
  - Conversation breakdown pattern detected

**Pattern Customization (Post-V1):**
- User and therapist can adjust intensity sensitivity
- Option to disable specific patterns if unhelpful
- Pattern expansion in V2: topic shift, positive reinforcement, confusion detected

**Wearability Consideration:**
- Haptics must be perceptible through clothing when pendant under shirt
- Intensity calibration during onboarding ("can you feel this?")
- Option to disable haptics entirely for "passive capture" mode

---

## User Controls

### Physical Controls

**Primary Button (Multi-Function):**
- **Single Press:** Mark moment ("that was confusing" flag for post-review)
- **Double Press:** Toggle mute on/off (hard mute, visual confirmation)
- **Long Press (3s):** Power off device
- **Emergency Triple Press:** Immediate full deletion of circular buffer (panic button)

**Button Placement:**
- Accessible through clothing (raised, tactile)
- Cannot be accidentally pressed during movement
- Must provide haptic or audio confirmation of press

**Hard Mute Requirement:**
- Physical cutoff of microphone power (not software-only)
- Visual indicator: small red LED visible on device edge
- Mute state persists across power cycles until user re-enables
- App displays mute status prominently

### Privacy Indicators

**Recording Status Indicator (Compliance Requirement):**
- **Problem:** Fully hidden recording creates legal and social risk
- **Solution:** Small edge-mounted LED visible when device not under clothing
- **LED Behavior:**
  - Green slow pulse: Capture enabled, no active conversation
  - Green solid: Active conversation capture
  - Red solid: Muted
  - Off: Powered down

**Social Acceptability Balance:**
- LED is "discreet, not covert" (meets consent standards)
- When pendant under clothing, LED may not be visible (acceptable for "self-capture" mode)
- Companion app shows recording status prominently for user confirmation

---

## Connectivity

### Bluetooth Low Energy (BLE 5.0+)

**Primary Use Cases:**
- Sync to smartphone app (iOS and Android)
- Real-time status monitoring (battery, recording state, mute status)
- Transfer acoustic feature summaries and event markers
- Receive coaching personalization updates
- Firmware over-the-air (OTA) updates

**Connection Model:**
- Paired device limit: 1 smartphone at a time
- Auto-reconnect when in range
- Offline mode: device continues capture and local processing; syncs when connection restored

**Data Sync Strategy:**
- Incremental sync every 2-4 hours or on-demand
- Transfer only: timestamps, event markers, acoustic features, session metadata
- Raw audio transfer ONLY when explicitly enabled and user-initiated
- Compression: acoustic features transferred as compact JSON (~10KB per conversation)

**Security:**
- BLE pairing with PIN or biometric confirmation
- Encrypted communication (AES-128 minimum)
- Device identity tied to user account (cannot be paired to different account without factory reset)

### Optional Wi-Fi (V2 Consideration)

**Deferred to V2 due to:**
- Battery drain risk (Wi-Fi significantly more power-hungry than BLE)
- Privacy risk (always-connected device creates larger attack surface)
- Limited added value in V1 (phone sync adequate for coaching use case)

**Future Use Case:**
- Direct cloud sync in environments without phone nearby
- Lower latency for real-time model updates
- Therapist dashboard live view (with explicit opt-in)

---

## Environmental Sensors (Optional/Future)

### Accelerometer/Gyroscope (V1.5+)
- Detect device orientation (worn correctly vs. upside down)
- Activity classification (sitting, walking, high movement = noisy environment)
- Fall detection (safety feature for younger users)

### Ambient Light Sensor (V2+)
- Infer environment context (indoors/outdoors, bright/dark)
- Correlate with conversation patterns (e.g., classroom lights vs. outdoor play)

### Temperature/Humidity Sensor (Research)
- Potential proxy for environment type
- Low priority for V1

---

## Manufacturing and Serviceability

### Design for Manufacturing (DFM)

**Assembly Complexity:**
- Minimize custom components (leverage off-the-shelf MEMS mics, BLE modules)
- Snap-fit or ultrasonic welding for housing (no exposed screws)
- Modular design: battery replaceable by service center

**Initial Production Volume:**
- V1 pilot: 500-2,000 units (beta cohort)
- V1.5 launch: 10,000-50,000 units
- Contract manufacturer in USA or partner with established wearable manufacturer

**Cost Targets:**
- Bill of materials (BOM): $40-60 for V1 at 10K volume
- Manufacturing + assembly: $15-25
- **Target COGS:** $60-85
- **Retail equivalent:** $150-250 (but subsidized for autism users)

### Serviceability and Longevity

**Battery Replacement:**
- User cannot replace (sealed for water resistance)
- Service center replacement program after 18-24 months
- Trade-in program for hardware upgrades

**Firmware Updates:**
- OTA via BLE
- Staged rollout (beta testers first, then general population)
- Rollback capability if update causes issues

**Warranty:**
- 1-year manufacturer defect warranty
- Extended warranty option for institutions (schools, clinics)
- Accidental damage protection plan (especially for children's use)

---

## Compliance and Certification

### Required Certifications (USA Market)

**FCC Part 15 (Radio Frequency Devices):**
- Required for Bluetooth transmission
- EMI/EMC testing to ensure no interference with other devices

**Safety Testing:**
- UL or ETL certification for battery and charging safety
- Choking hazard assessment (CPSC guidelines for children's products)
- Hypoallergenic material certification for skin contact

**Accessibility Standards:**
- Consider alignment with ADA assistive technology guidelines
- Haptic feedback must be perceivable by users with varying sensory profiles

### International Considerations (Future)

**CE Marking (Europe):**
- Required for EU market entry
- GDPR compliance for data handling (more stringent than COPPA)

**Medical Device Classification (Future):**
- V1 explicitly NOT a medical device (coaching tool, not diagnostic)
- If clinical claims desired (V3+), FDA Class II medical device pathway likely
- Separate regulatory track, clinical validation studies required

---

## Hardware Roadmap

### V1 (Months 0-6): Necklace MVP
- Dual-mic necklace pendant
- 24-hour battery life
- 3 haptic patterns
- BLE smartphone sync
- Hard mute button
- Circular buffer storage

### V1.5 (Months 6-12): Production Hardening
- 48-hour battery life
- Improved audio quality under clothing
- Water resistance upgrade to IP67
- Accelerometer for context awareness
- Manufacturing cost reduction

### V2 (Months 12-24): Form Factor Diversification
- Earring prototype validation
- Watch integration partnerships
- On-device ML acceleration
- Expanded haptic vocabulary
- Optional Wi-Fi connectivity

### V3+ (24+ months): Advanced Sensing
- Multimodal: audio + physiological sensors (heart rate, skin conductance for stress)
- Video-capable version for nonverbal cue detection (opt-in, high-privacy use cases)
- Clinical-grade hardware for FDA approval track

---

## Key Design Tradeoffs

| Tradeoff | V1 Decision | Rationale |
|----------|-------------|-----------|
| **Discreet vs. Auditable** | Discreet form factor, but visible indicator LED | Legitimacy requires some visible consent signal; discreet ≠ covert |
| **Battery Life vs. Size** | 24hr minimum, accept slightly thicker pendant | All-day use non-negotiable; users prefer slightly larger device over daily charging |
| **On-Device vs. Cloud Processing** | Hybrid: VAD + features on-device, deeper analysis cloud | Privacy + battery balance; edge processing for real-time, cloud for personalization |
| **Audio Quality vs. Under-Clothing** | Optimize for under-clothing, accept quality loss | Social acceptance > perfect audio; robust DSP compensates |
| **Custom Hardware vs. COTS** | Maximize off-the-shelf components | Time to market and cost; custom only where differentiated (audio processing firmware) |

---

## Open Hardware Questions (Requires Prototyping)

1. **Microphone Placement Optimization:**
   - Single front-facing vs. dual omnidirectional positioning
   - Acoustic modeling for fabric-filtered audio

2. **Haptic Perception Through Clothing:**
   - Minimum intensity required for reliable detection
   - User sensitivity variability (children vs. adults, sensory profiles)

3. **Durability Under Child Use:**
   - Drop test frequency realistic for 8-12 year olds
   - Cord breakaway force calibration (safety vs. annoyance)

4. **Thermal Management:**
   - Device temperature during extended audio processing
   - Skin contact safety limits

5. **Electromagnetic Interference:**
   - Performance near school electronics, smartphones, wireless networks
   - Potential interference with hearing aids or cochlear implants

---

## Reference Hardware Comparisons

| Device | Form Factor | Battery | Audio Capture | Haptics | Relevance to Tizzy |
|--------|-------------|---------|---------------|---------|---------------------|
| **Friend Pendant** | Necklace | 15hr | Always-on | None | Form factor precedent; trust failure case study |
| **Limitless Pendant** | Necklace | 100hr | Always-on with LED | None | Long battery life target; LED indicator precedent |
| **Humane AI Pin** | Clip-on | 4-9hr | Push-to-talk | Laser projection | Premium build but poor battery; trust issues |
| **Ray-Ban Meta** | Glasses | 4-6hr | On-demand | None | Mainstream acceptance of wearable audio capture |
| **Apple AirPods Pro** | Earbuds | 6hr (30hr case) | Conversation awareness | None | Miniaturization + audio quality benchmark |
| **Oura Ring** | Ring | 4-7 days | None | None | Discreet wearable, strong battery mgmt, subscription model |

**Key Takeaway:** Tizzy's hardware challenge is to achieve Friend/Limitless battery life and always-on capability, while maintaining AirPods-level audio quality, in a form factor with social legitimacy (Ray-Ban Meta precedent).

---

## Conclusion

The V1 hardware specification is deliberately aggressive but grounded in existing wearable technology. The core risk is audio quality under clothing; this MUST be validated in prototyping. The core opportunity is that no existing device combines always-on conversational audio capture with privacy-first architecture and autism-specific coaching. Hardware is the vessel; the moat is the software, dataset, and trust model.

**Next Steps:**
1. Prototype necklace hardware using development kits (Nordic nRF52840 + MEMS mics)
2. Audio quality testing: under clothing vs. exposed, various fabric types
3. Haptic perception study: minimum viable intensity, pattern distinguishability
4. Battery life profiling under realistic usage scenarios
5. Industrial design partnership for premium aesthetic and manufacturing feasibility
