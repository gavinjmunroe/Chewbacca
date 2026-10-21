# MVP Scope - Tizzy V1

**Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** Planning

---

## Executive Summary

The V1 ruthless feature set is designed to deliver a complete daily coaching loop without attempting to be "everything at once." The goal is to prove the core value proposition: **detect conversational patterns, coach in the moment, track improvement over time** - while building trust through transparent privacy controls.

If you try to ship everything, you ship nothing. The Humane AI Pin is the archetype of trying to be "the future" without delivering a clean daily loop. Tizzy V1 succeeds by being narrow, effective, and trusted.

---

## Core V1 Feature Set

### 1. Always-On Capture with Privacy First

**What it includes:**
- Continuous voice capture when device is active
- Hard mute button (physical, works through clothing)
- Three privacy modes:
  - **Self-only mode:** Captures only wearer's voice patterns for solo practice
  - **Consented conversation:** Full capture with bystander awareness
  - **No capture:** Hard mute, device dormant
- Circular buffer storage (last N hours on device, then overwritten)
- Local processing pipeline for feature extraction

**What it excludes from V1:**
- Video capture (audio-only in V1)
- Cloud storage of raw audio by default
- Automatic environment detection (manual mode switching in V1)
- Multi-device sync

**Success Criteria:**
- 24-hour battery life minimum with continuous capture
- <2 second latency from mute button press to confirmed mute state
- Device continues to function if phone disconnects (buffered sync)

---

### 2. In-the-Moment Haptic Coaching

**What it includes:**
- Three distinct haptic patterns:
  - **Single pulse:** Pacing or volume adjustment needed
  - **Double pulse:** Cue to ask a return question or clarify
  - **Long pulse:** Escalation risk or overload risk, cue to exit/reset
- User-configurable haptic intensity (off/subtle/medium/strong)
- Pattern learning guide in app
- Haptic coaching can be disabled during conversations

**What it excludes from V1:**
- Custom haptic patterns
- More than 3 core patterns (keep it simple to learn)
- Audio coaching (distracting and not discreet)
- Smartphone vibration fallback

**Success Criteria:**
- Haptic patterns distinguishable with 95%+ accuracy by users after 3 days
- Haptic latency <1 second from detected event to vibration
- No false positives that create anxiety (calibration via user feedback)

---

### 3. Post-Conversation Timeline Review

**What it includes:**
- Timeline view of conversation with moment markers
- Three types of markers:
  - **What went well** (top 2 positive moments)
  - **What to try next time** (top 2 improvement opportunities)
  - **Likely confusion moments** (system detected breakdown signals)
- Short text explanation for each marker (no jargon)
- One micro-goal generated for next day
- Optional clip pointers (only if retention explicitly enabled)
- Ability to mark moments as "helpful" or "not helpful" for model feedback

**What it excludes from V1:**
- Full transcript playback by default (privacy risk)
- Automated clip export or sharing to social media
- Conversation comparison across multiple sessions (V1 shows one at a time)
- Search across historical conversations

**Success Criteria:**
- Post-conversation summary available within 30 seconds of conversation end
- User comprehension of feedback >85% (measured via user surveys)
- At least one actionable insight per 5+ minute conversation

---

### 4. Daily Micro-Goal System

**What it includes:**
- One specific, actionable micro-goal per day based on patterns
- Examples:
  - "Today, try asking one return question in each conversation"
  - "Today, notice when you want to interrupt and pause for 2 seconds first"
  - "Today, try saying 'I'm confused' when you don't understand"
- Progress tracking: did user practice the goal?
- Gentle notification reminder mid-day
- Goal rotation based on highest-impact patterns

**What it excludes from V1:**
- Multiple goals per day (overwhelming)
- User-created custom goals (system-generated only in V1)
- Goal gamification or streaks (avoid addiction mechanics)

**Success Criteria:**
- 70%+ of users report attempting their daily goal
- Goals feel relevant and achievable (user survey >4/5 rating)
- Users can explain what they practiced

---

### 5. Weekly Progress Dashboard

**What it includes:**
- Trend view for 2-3 core coaching targets:
  - Topic maintenance (sustained turns per conversation)
  - Reciprocity (questions asked vs monologue time)
  - Repair attempts (self-correction, clarification)
- Simple visualizations (line graphs, before/after comparison)
- Celebration of progress, not shaming of struggles
- "This week vs last week" summary

**What it excludes from V1:**
- Comparison to population norms (just personal baseline)
- Detailed statistical analysis
- Export to PDF (therapist export is separate feature)
- Social sharing features

**Success Criteria:**
- Users can articulate their improvement in at least 1 area after 30 days
- Dashboard viewed at least weekly by 60%+ of active users
- Progress metrics correlate with user self-reported improvement

---

### 6. Optional Therapist Export

**What it includes:**
- Explicit opt-in per session or per week
- Export package includes:
  - Pattern summary (not raw audio by default)
  - Timeline with annotated moments
  - Progress trends
  - Optional selected clips (only if user enables)
- Secure sharing via email or link with expiration
- Audit trail showing what was shared and when

**What it excludes from V1:**
- Therapist dashboard (B2B portal is V2)
- Real-time therapist monitoring
- Automated insights for therapists (manual review in V1)
- Integration with EHR systems

**Success Criteria:**
- Therapists report the export saves 10+ minutes per session
- 80%+ of therapist recipients find export useful (survey)
- Zero unintended data leakage (security audit required)

---

## Coaching Taxonomy for V1

The system detects and coaches these core conversational skills:

### A. Reciprocity and Turn-Taking
- **Detects:** Interruptions, monologuing, delayed responses, lack of return questions
- **Coaches:** "Ask a follow-up question," "Let them finish," "They want to share too"

### B. Topic Management
- **Detects:** Abrupt topic shifts, losing thread, oversharing on one topic
- **Coaches:** "Wrap up this topic," "Check if they're still interested," "Ask about their day"

### C. Repair and Recovery
- **Detects:** Confusion markers (long pauses, "huh?", clarification requests)
- **Coaches:** "Rephrase that," "Ask if they understood," "It's okay to say you're confused"

### D. Prosody and Pacing
- **Detects:** Speaking too fast, too slow, too loud, too flat, intensity mismatches
- **Coaches:** "Slow down a bit," "Match their energy," "Take a breath"

### E. Escalation and Overload
- **Detects:** Rising intensity, overlapping speech spikes, stress markers in voice
- **Coaches:** "De-escalate," "Take a break," "You sound stressed, pause if needed"

**What is excluded from V1:**
- Theory of mind coaching (V2, requires more sophisticated modeling)
- Sarcasm and implied meaning detection (too high error rate in V1)
- Social calibration for politeness (requires cultural context we don't have yet)
- Sensory overload prediction (requires baseline data we don't have in first 30 days)

---

## Technical Architecture (V1 Constraints)

### On-Device Processing
- Voice activity detection
- Speaker diarization (wearer vs other)
- Acoustic feature extraction (pace, pitch, intensity, pauses)
- Lightweight classification for real-time haptic triggers
- Encryption before any data leaves device

### Cloud Processing (Minimized)
- Deeper analysis for post-conversation review
- Model updates and personalization
- Aggregate pattern analysis
- Secure sync of encrypted features (not raw audio by default)

### Data Flow
1. Raw audio captured → processed on-device → features extracted
2. Features encrypted → synced to cloud when connected
3. Raw audio in circular buffer → overwritten after N hours unless explicitly saved
4. Cloud analysis → insights sent back to device/app
5. User reviews insights → provides feedback → improves personalization

---

## Hardware Specifications (V1 Target)

### Form Factor
- **Primary:** Necklace pendant (can be worn under shirt)
- **Dimensions:** ~3cm diameter, <1cm thick
- **Weight:** <30 grams
- **Material:** Durable plastic or metal, hypoallergenic

### Core Components
- **Microphones:** Dual-mic setup for directionality and noise cancellation
- **Haptic motor:** High-quality vibration motor with 3+ distinguishable patterns
- **Battery:** 24-hour minimum runtime (48-hour stretch goal)
- **Storage:** Enough for 4-8 hours of circular buffer
- **Processor:** Sufficient for on-device VAD, diarization, feature extraction
- **Connectivity:** Bluetooth LE 5.0+ to smartphone
- **Button:** Physical button accessible through clothing for mute/mark

### Excluded from V1
- Wi-Fi connectivity (Bluetooth only)
- Camera/video (audio-only device)
- Display/screen (app-based UI only)
- GPS location tracking
- Always-on LED indicator (exploring subtle alternatives)

---

## Privacy and Trust Features (Non-Negotiable)

### User Controls
- **Privacy dashboard:** Shows what data exists, where it's stored, when it was accessed
- **Hard delete:** User can permanently delete any session
- **Consent receipts:** Every capture session tagged with consent mode
- **Quiet hours:** Auto-mute during configured times (sleep, private time)
- **Emergency mute:** Physical button overrides all software settings

### Bystander Protection
- **Consent mechanism:** System prompts for bystander consent in consented mode
- **Minimal bystander storage:** Focus on wearer behavior, not others' speech
- **No clip virality:** Sharing restricted to therapist export only

### Transparency
- **Audit log:** User can see every time data was accessed, synced, or shared
- **Processing visibility:** User can see what analysis happens where (device vs cloud)
- **No third-party data sales:** Ever. This is a trust commitment.

---

## Success Metrics for V1

### Product Usage
- **Daily active usage:** 80%+ of users wear device at least 5 days/week
- **Haptic acceptance:** 70%+ of users keep haptics enabled after 2 weeks
- **Review engagement:** 60%+ of users view post-conversation insights same-day

### Outcome Metrics (30-Day Proof)
- **Skill improvement:** 70%+ of users show measurable improvement in at least 1-2 coaching targets
- **User confidence:** Self-reported social confidence increases by average of 1.5+ points on 7-point scale
- **Conversational outcomes:** Reduction in user-reported "social crashes" or misunderstandings

### Trust Metrics
- **Privacy concerns:** <10% of users express concern about privacy after onboarding
- **Bystander comfort:** <5% of reported interactions involve bystander discomfort
- **Continued use:** 60%+ retention at 90 days

### Business Validation
- **Therapist value:** 80%+ of therapists who see export report it's useful
- **Word of mouth:** 40%+ of users recommend to someone else in first 90 days
- **Subscription conversion:** 50%+ of trial users convert to paying subscription

---

## What V1 Proves

If V1 is successful, we will have proven:

1. **The daily loop works:** Capture → haptic coaching → review → progress tracking creates measurable value
2. **Trust is achievable:** Transparent privacy controls and consent mechanisms make users comfortable
3. **Hardware is viable:** Wearable form factor is socially acceptable and technically robust
4. **Autism wedge is real:** Autistic users see specific, meaningful improvements in target skills
5. **Business model works:** People will pay for subscription after experiencing value
6. **Foundation for scale:** Dataset begins to accumulate ethically, creating moat for V2+

---

## V2 and Beyond (Explicitly Out of Scope)

These features are important but not required to prove core value:

- **Multi-device support** (watch, earrings, glasses integration)
- **Video/facial expression analysis**
- **Theory of mind and sarcasm coaching**
- **Therapist dashboard/portal** (B2B platform)
- **School integration and classroom mode**
- **Advanced social calibration** (cultural context, politeness variation)
- **Sensory overload prediction** (requires personalized baseline)
- **Group conversation dynamics** (3+ people)
- **Real-time transcript display**
- **Conversation search and historical analysis**
- **API for third-party integrations**
- **Wearable indicator alternatives** (exploring options)

---

## Implementation Priorities

### Must-Have for V1 (Gating Launch)
- [ ] Core capture pipeline with privacy modes
- [ ] Haptic coaching (3 patterns)
- [ ] Post-conversation review with insights
- [ ] Daily micro-goal system
- [ ] Privacy dashboard and controls
- [ ] Therapist export (basic)
- [ ] 24-hour battery life
- [ ] Stable Bluetooth connectivity

### Nice-to-Have for V1 (Improves Experience)
- [ ] Weekly progress trends
- [ ] Haptic pattern customization (intensity)
- [ ] Quiet hours auto-mute
- [ ] User feedback on insights ("helpful/not helpful")

### V1.5 Fast-Follows (Ship Within 90 Days of Launch)
- [ ] Improved personalization (baseline calibration)
- [ ] Expanded coaching taxonomy (theory of mind basics)
- [ ] Better audio quality under clothing
- [ ] Extended battery life (48+ hours)

---

## Risk Mitigation

### Technical Risks
- **Audio quality under clothing:** Extensive testing with multiple mic placements; fallback to clip-on mode
- **Battery life:** Conservative power management; clear battery expectations
- **Bluetooth connectivity:** Robust reconnection logic; offline buffering

### Product Risks
- **Haptic confusion:** Clear onboarding tutorial; user testing with target users
- **Coaching accuracy:** Uncertainty handling; "we're not sure" feedback when confidence is low
- **Privacy concerns:** Over-communicate privacy controls; make privacy dashboard prominent

### Market Risks
- **Bystander discomfort:** Clear consent mechanism; exploring discreet indicator options
- **Regulatory changes:** Legal counsel review; staying ahead of COPPA, recording laws
- **Competitive pressure:** Focus on autism wedge where we have unique positioning

---

## Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| Audio-only (no video) in V1 | Reduces privacy risk, simpler hardware, faster to ship | Feb 2026 |
| Three haptic patterns only | More patterns = harder to learn; 3 is enough for V1 proof | Feb 2026 |
| No clip sharing to social | Prevents virality concerns; maintains assistive tech positioning | Feb 2026 |
| Therapist export is opt-in | User control is non-negotiable; explicit consent required | Feb 2026 |
| No real-time transcript | Transcript encourages over-analysis; insights are more valuable | Feb 2026 |
| Adult users first (18+) | Simpler consent, faster iteration, proves value before minors | Feb 2026 |

---

## Summary

**V1 is ruthlessly focused on proving one thing:** Tizzy can detect conversational patterns that matter, coach them effectively in real-time and post-conversation, and show measurable improvement over 30 days - while earning user trust through radical transparency.

Everything else is V2.

If V1 succeeds, we have a foundation to expand coaching taxonomy, improve accuracy, add therapist tools, scale to schools, and eventually become the default platform for conversational growth across all domains.

If V1 fails, it will be because we either (a) didn't deliver the daily loop effectively, (b) lost user trust through poor privacy design, or (c) hardware wasn't socially acceptable. All of these risks are addressed in this scope.

**The ruthless question:** Does this V1 scope prove enough value to justify continued investment? Yes. It delivers the complete coaching loop, builds the dataset moat, and validates the autism wedge - without trying to be "everything at once."
